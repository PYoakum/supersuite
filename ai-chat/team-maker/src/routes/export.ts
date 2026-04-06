import { toMarkdown } from "../core/format";
import type { EvaluateResponse } from "../core/schema";

export async function handleExport(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, errors: ["Invalid JSON body"] }, { status: 400 });
  }

  const format = String(body.format || "markdown");
  const data = body.data as EvaluateResponse | undefined;

  if (!data || !data.tasks) {
    return Response.json(
      { ok: false, errors: ["data field must contain a valid evaluation response"] },
      { status: 400 }
    );
  }

  if (format === "json") {
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": "attachment; filename=team-plan.json",
      },
    });
  }

  if (format === "markdown") {
    const md = toMarkdown(data);
    return new Response(md, {
      headers: {
        "Content-Type": "text/markdown",
        "Content-Disposition": "attachment; filename=team-plan.md",
      },
    });
  }

  return Response.json({ ok: false, errors: [`Unsupported format: ${format}`] }, { status: 400 });
}
