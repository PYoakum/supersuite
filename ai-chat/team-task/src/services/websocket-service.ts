import type { ServerWebSocket } from "bun";

export interface WSData {
  clientId: string;
}

class WebSocketService {
  private clients: Map<string, ServerWebSocket<WSData>> = new Map();

  add(ws: ServerWebSocket<WSData>): void {
    this.clients.set(ws.data.clientId, ws);
  }

  remove(ws: ServerWebSocket<WSData>): void {
    this.clients.delete(ws.data.clientId);
  }

  broadcast(type: string, payload: unknown): void {
    const msg = JSON.stringify({ type, payload });
    for (const ws of this.clients.values()) {
      ws.send(msg);
    }
  }

  sendTo(clientId: string, type: string, payload: unknown): void {
    const ws = this.clients.get(clientId);
    if (ws) ws.send(JSON.stringify({ type, payload }));
  }

  connectedCount(): number {
    return this.clients.size;
  }
}

export const wsService = new WebSocketService();
