import { taskService } from "../services/task-service";

const startTime = Date.now();

export function handleHealth(): Response {
  return Response.json({ ok: true, uptime: Math.floor((Date.now() - startTime) / 1000) });
}

export function handleStats(): Response {
  return Response.json({ ok: true, ...taskService.stats() });
}
