import { taskService } from "../services/task-service";
import { validateImport } from "../utils/validate";

export async function handleImport(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  const { errors, tasks } = validateImport(body);

  if (errors.length > 0) {
    return Response.json({ ok: false, errors }, { status: 400 });
  }

  if (tasks.length === 0) {
    return Response.json({ ok: false, errors: ["No valid tasks to import"] }, { status: 400 });
  }

  const created = taskService.import(tasks);
  return Response.json({ ok: true, imported: created.length, tasks: created }, { status: 201 });
}
