import type { EvaluateResponse, PatchRolesRequest, LLMConfig } from "../core/schema";
import { generatePMRoles } from "../core/pm-generator";

/** In-memory store of the last evaluation result, for patching */
let lastResult: EvaluateResponse | null = null;

export function setLastResult(result: EvaluateResponse): void {
  lastResult = result;
}

export function getLastResult(): EvaluateResponse | null {
  return lastResult;
}

const VALID_PROVIDERS = ["anthropic", "openai", "gemini", "openai-compat"];

export async function handlePatchRoles(req: Request): Promise<Response> {
  if (!lastResult) {
    return Response.json(
      { ok: false, errors: ["No evaluation result to patch — run an evaluation first"] },
      { status: 400 },
    );
  }

  let body: PatchRolesRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, errors: ["Invalid JSON body"] }, { status: 400 });
  }

  if (!Array.isArray(body.roles) || body.roles.length === 0) {
    return Response.json(
      { ok: false, errors: ["roles must be a non-empty array"] },
      { status: 400 },
    );
  }

  const errors: string[] = [];
  const applied: string[] = [];

  for (const patch of body.roles) {
    if (!patch.roleId || !patch.llm) {
      errors.push(`Each entry needs roleId and llm`);
      continue;
    }

    if (!VALID_PROVIDERS.includes(patch.llm.provider)) {
      errors.push(`${patch.roleId}: invalid provider "${patch.llm.provider}"`);
      continue;
    }

    if (!patch.llm.model) {
      errors.push(`${patch.roleId}: model is required`);
      continue;
    }

    if (patch.llm.provider === "openai-compat" && !patch.llm.baseUrl) {
      errors.push(`${patch.roleId}: openai-compat requires baseUrl`);
      continue;
    }

    const assignment = lastResult.assignments.find(a => a.roleId === patch.roleId);
    const prompt = lastResult.prompts.find(p => p.roleId === patch.roleId);

    if (!assignment && !prompt) {
      errors.push(`${patch.roleId}: role not found in last evaluation`);
      continue;
    }

    const llm: LLMConfig = {
      provider: patch.llm.provider,
      model: patch.llm.model,
      ...(patch.llm.baseUrl ? { baseUrl: patch.llm.baseUrl } : {}),
    };

    if (assignment) assignment.llm = llm;
    if (prompt) prompt.llm = llm;
    applied.push(patch.roleId);
  }

  if (errors.length > 0 && applied.length === 0) {
    return Response.json({ ok: false, errors }, { status: 400 });
  }

  return Response.json({
    ok: true,
    applied,
    ...(errors.length > 0 ? { warnings: errors } : {}),
    assignments: lastResult.assignments,
    prompts: lastResult.prompts,
  });
}

export async function handleRenameRole(req: Request): Promise<Response> {
  if (!lastResult) {
    return Response.json(
      { ok: false, errors: ["No evaluation result"] },
      { status: 400 },
    );
  }

  let body: { roleId: string; displayName?: string; avatar?: string; newId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, errors: ["Invalid JSON body"] }, { status: 400 });
  }

  if (!body.roleId) {
    return Response.json({ ok: false, errors: ["roleId is required"] }, { status: 400 });
  }

  const assignment = lastResult.assignments.find(a => a.roleId === body.roleId);
  const prompt = lastResult.prompts.find(p => p.roleId === body.roleId);

  if (!assignment && !prompt) {
    return Response.json({ ok: false, errors: [`Role ${body.roleId} not found`] }, { status: 404 });
  }

  // Update displayName if provided
  if (body.displayName !== undefined) {
    const name = body.displayName.trim();
    if (assignment) assignment.displayName = name || undefined;
    if (prompt) prompt.displayName = name || undefined;
  }

  // Update avatar if provided
  if (body.avatar !== undefined) {
    const av = body.avatar.trim() || undefined;
    if (assignment) assignment.avatar = av;
    if (prompt) prompt.avatar = av;
  }

  // Update roleId if newId provided
  if (body.newId) {
    const newId = body.newId.trim();
    if (!newId) {
      return Response.json({ ok: false, errors: ["newId cannot be empty"] }, { status: 400 });
    }
    const exists = lastResult.assignments.some(a => a.roleId === newId) ||
                   lastResult.prompts.some(p => p.roleId === newId);
    if (exists && newId !== body.roleId) {
      return Response.json({ ok: false, errors: [`Role ${newId} already exists`] }, { status: 409 });
    }
    if (assignment) assignment.roleId = newId;
    if (prompt) prompt.roleId = newId;
  }

  return Response.json({ ok: true, roleId: body.newId || body.roleId });
}

export async function handleGetRoles(_req: Request): Promise<Response> {
  if (!lastResult) {
    return Response.json(
      { ok: false, errors: ["No evaluation result — run an evaluation first"] },
      { status: 400 },
    );
  }

  return Response.json({
    ok: true,
    assignments: lastResult.assignments,
    prompts: lastResult.prompts,
  });
}

/** Manually (re)generate PM roles for the current evaluation result. */
export async function handleGeneratePMs(_req: Request): Promise<Response> {
  if (!lastResult) {
    return Response.json(
      { ok: false, errors: ["No evaluation result — run an evaluation first"] },
      { status: 400 },
    );
  }

  // Strip existing PMs before regenerating
  const stripped: EvaluateResponse = {
    ...lastResult,
    assignments: lastResult.assignments.filter((a) => a.roleKind !== "pm"),
    prompts: lastResult.prompts.filter((p) => p.roleKind !== "pm"),
  };

  // Clear worker PM references so they get reassigned
  for (const a of stripped.assignments) {
    if (a.roleKind === "worker") {
      a.managedBy = undefined;
      a.roleKind = undefined;
    }
  }
  for (const p of stripped.prompts) {
    if (p.roleKind === "worker") {
      p.roleKind = undefined;
    }
  }

  const result = generatePMRoles(stripped);
  setLastResult(result);

  const pmRoles = result.assignments.filter((a) => a.roleKind === "pm");
  return Response.json({
    ok: true,
    generated: pmRoles.length,
    pmRoles: pmRoles.map((p) => ({
      roleId: p.roleId,
      displayName: p.displayName,
      manages: p.manages,
    })),
    assignments: result.assignments,
  });
}
