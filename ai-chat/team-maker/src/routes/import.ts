import { setLastResult } from "./roles";
import type { EvaluateResponse } from "../core/schema";
import { generatePMRoles } from "../core/pm-generator";

export async function handleImport(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, errors: ["Invalid JSON body"] }, { status: 400 });
  }

  // Accept either raw result or wrapped in { data: ... }
  const data = (body.data || body) as Partial<EvaluateResponse>;

  if (!data.tasks || !Array.isArray(data.tasks) || data.tasks.length === 0) {
    return Response.json(
      { ok: false, errors: ["Missing or empty tasks array — not a valid evaluation result"] },
      { status: 400 },
    );
  }

  if (!data.assignments || !Array.isArray(data.assignments)) {
    return Response.json(
      { ok: false, errors: ["Missing assignments array"] },
      { status: 400 },
    );
  }

  if (!data.prompts || !Array.isArray(data.prompts)) {
    return Response.json(
      { ok: false, errors: ["Missing prompts array"] },
      { status: 400 },
    );
  }

  let result: EvaluateResponse = {
    summary: String(data.summary || ""),
    tasks: data.tasks,
    assignments: data.assignments,
    prompts: data.prompts,
    coverageReport: data.coverageReport || { coveredTaskIds: [], uncoveredTaskIds: [], notes: [] },
    ambiguities: data.ambiguities || [],
    usage: data.usage,
  };

  // Auto-generate PM roles if none exist in the imported data
  const hasPMs = result.assignments.some((a) => a.roleKind === "pm");
  if (!hasPMs) {
    result = generatePMRoles(result);
  }

  setLastResult(result);

  return Response.json({
    ok: true,
    imported: {
      tasks: result.tasks.length,
      assignments: result.assignments.length,
      prompts: result.prompts.length,
    },
  });
}
