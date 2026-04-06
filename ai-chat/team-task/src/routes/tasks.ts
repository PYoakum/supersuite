import { taskService } from "../services/task-service";
import { validateCreate, validateUpdate } from "../utils/validate";
import type { TaskQuery } from "../models/task";

export async function handleCreateTask(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  const { errors, payload } = validateCreate(body);
  if (errors.length > 0) {
    return Response.json({ ok: false, errors }, { status: 400 });
  }

  const task = taskService.create(payload!);
  return Response.json({ ok: true, task }, { status: 201 });
}

export function handleGetTasks(req: Request): Response {
  const url = new URL(req.url);
  const query: TaskQuery = {
    status: (url.searchParams.get("status") as any) || undefined,
    priority: (url.searchParams.get("priority") as any) || undefined,
    assignee: url.searchParams.get("assignee") || undefined,
    group: url.searchParams.get("group") || undefined,
    tag: url.searchParams.get("tag") || undefined,
    q: url.searchParams.get("q") || undefined,
    limit: Number(url.searchParams.get("limit")) || undefined,
    offset: Number(url.searchParams.get("offset")) || undefined,
  };

  const result = taskService.list(query);
  return Response.json({ ok: true, ...result });
}

export function handleGetTask(id: string): Response {
  const task = taskService.getById(id);
  if (!task) return Response.json({ ok: false, errors: ["Task not found"] }, { status: 404 });
  return Response.json({ ok: true, task });
}

export async function handleUpdateTask(id: string, req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  const { errors, payload } = validateUpdate(body);
  if (errors.length > 0) {
    return Response.json({ ok: false, errors }, { status: 400 });
  }

  const task = taskService.update(id, payload!);
  if (!task) return Response.json({ ok: false, errors: ["Task not found"] }, { status: 404 });
  return Response.json({ ok: true, task });
}

export function handleDeleteTask(id: string): Response {
  const deleted = taskService.delete(id);
  if (!deleted) return Response.json({ ok: false, errors: ["Task not found"] }, { status: 404 });
  return Response.json({ ok: true });
}

export function handleExportTasks(): Response {
  const tasks = taskService.export();
  return new Response(JSON.stringify({ tasks }, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="tasks-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}

export function handleClearTasks(): Response {
  taskService.clear();
  return Response.json({ ok: true });
}

export async function handleNotifyTask(id: string): Promise<Response> {
  const result = await taskService.notify(id);
  if (!result.found) return Response.json({ ok: false, errors: ["Task not found"] }, { status: 404 });
  if (!result.sent) return Response.json({ ok: false, errors: [result.reason] }, { status: 502 });
  return Response.json({ ok: true });
}
