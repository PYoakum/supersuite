import type { ServerWebSocket } from "bun";
import type { ChatMessage } from "../models/message";

export interface WSData {
  id: string;
  connectedAt: number;
}

class WebSocketService {
  private clients: Set<ServerWebSocket<WSData>> = new Set();

  addClient(ws: ServerWebSocket<WSData>): void {
    this.clients.add(ws);
    console.log(`[ws] Client connected (${this.clients.size} total)`);
  }

  removeClient(ws: ServerWebSocket<WSData>): void {
    this.clients.delete(ws);
    console.log(`[ws] Client disconnected (${this.clients.size} total)`);
  }

  broadcast(type: string, payload: unknown): void {
    const envelope = JSON.stringify({ type, payload });
    for (const client of this.clients) {
      try {
        client.send(envelope);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  broadcastMessage(message: ChatMessage): void {
    this.broadcast("message:created", message);
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

export const wsService = new WebSocketService();
