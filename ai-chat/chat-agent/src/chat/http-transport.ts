import { log } from "../logger";
import type { ChatMessage } from "./history";

export interface HttpTransportOptions {
  apiUrl: string;
  pollIntervalMs: number;
  onMessage: (type: string, payload: unknown) => void;
}

export class HttpTransport {
  private opts: HttpTransportOptions;
  private polling = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastSeenId: string | null = null;

  constructor(opts: HttpTransportOptions) {
    this.opts = opts;
  }

  start(): void {
    if (this.polling) return;
    this.polling = true;
    log.info(`HTTP fallback active — polling every ${this.opts.pollIntervalMs}ms`);
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.opts.pollIntervalMs);
  }

  stop(): void {
    this.polling = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async send(type: string, payload: unknown): Promise<boolean> {
    if (type !== "message:create") {
      log.warn(`HTTP transport only supports message:create, got ${type}`);
      return false;
    }

    try {
      const res = await fetch(`${this.opts.apiUrl}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        log.error(`HTTP send failed (${res.status}): ${text}`);
        return false;
      }
      return true;
    } catch (err) {
      log.error(`HTTP send error: ${err}`);
      return false;
    }
  }

  private async poll(): Promise<void> {
    if (!this.polling) return;

    try {
      const params = new URLSearchParams({ order: "asc", limit: "50" });
      if (this.lastSeenId) {
        params.set("after", this.lastSeenId);
      }

      const res = await fetch(`${this.opts.apiUrl}/api/messages?${params}`);
      if (!res.ok) return;

      const data = await res.json();
      const messages: ChatMessage[] = data.messages || data;

      for (const msg of messages) {
        this.lastSeenId = msg.id;
        this.opts.onMessage("message:created", msg);
      }
    } catch {
      // Silent — next poll will retry
    }
  }

  /** Seed the cursor so we don't replay old messages when starting polling */
  seedLastId(id: string): void {
    this.lastSeenId = id;
  }
}
