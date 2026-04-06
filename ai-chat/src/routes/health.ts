import { storageService } from "../services/storage-service";
import { wsService } from "../services/websocket-service";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function handleHealth(): Response {
  return json({ ok: true, uptime: process.uptime() });
}

export function handleStats(): Response {
  const stats = storageService.getStats();
  return json({
    ok: true,
    ...stats,
    connectedClients: wsService.getClientCount(),
  });
}
