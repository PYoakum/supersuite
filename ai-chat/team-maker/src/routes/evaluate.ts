import type { EvaluateRequest } from "../core/schema";
import { evaluate, evaluateStream } from "../core/evaluator";
import { setLastResult } from "./roles";

export async function handleEvaluate(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, errors: ["Invalid JSON body"] }, { status: 400 });
  }

  const errors = validateRequest(body);
  if (errors.length > 0) {
    return Response.json({ ok: false, errors }, { status: 400 });
  }

  const request: EvaluateRequest = {
    plan: String(body.plan),
    format: (body.format as EvaluateRequest["format"]) || "markdown",
    aiAgentCount: Number(body.aiAgentCount),
    humanCount: Number(body.humanCount),
    model: body.model ? String(body.model) : undefined,
    provider: body.provider ? String(body.provider) as EvaluateRequest["provider"] : undefined,
    promptStyle: (body.promptStyle as EvaluateRequest["promptStyle"]) || "concise",
    allocationStrategy: (body.allocationStrategy as EvaluateRequest["allocationStrategy"]) || "balanced",
    includeRisks: body.includeRisks !== false,
    includeDependencies: body.includeDependencies !== false,
  };

  const wantsStream = body.stream === true;

  if (wantsStream) {
    return new Response(evaluateStream(request), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  try {
    const result = await evaluate(request);
    setLastResult(result.response);
    return Response.json({
      ok: true,
      ...result.response,
      validation: result.validation,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Evaluation failed";
    return Response.json({ ok: false, errors: [message] }, { status: 500 });
  }
}

function validateRequest(body: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!body.plan || typeof body.plan !== "string" || body.plan.trim().length === 0) {
    errors.push("plan is required and must be a non-empty string");
  }
  if (body.aiAgentCount === undefined || Number(body.aiAgentCount) < 0) {
    errors.push("aiAgentCount must be a non-negative number");
  }
  if (body.humanCount === undefined || Number(body.humanCount) < 0) {
    errors.push("humanCount must be a non-negative number");
  }
  if (Number(body.aiAgentCount) + Number(body.humanCount) < 1) {
    errors.push("Must request at least 1 total role (aiAgentCount + humanCount)");
  }
  if (body.plan && typeof body.plan === "string" && body.plan.length > 100_000) {
    errors.push("Plan exceeds maximum length of 100,000 characters");
  }

  return errors;
}
