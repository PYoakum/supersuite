import { log } from "../logger";

export interface WSClientOptions {
  url: string;
  reconnectDelay: number;
  maxReconnectDelay: number;
  maxReconnectAttempts: number;
  onConnected: (clientId: string) => void;
  onMessage: (type: string, payload: unknown) => void;
  onDisconnected: () => void;
  onFallback: () => void;
}

export class WSClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentDelay: number;
  private opts: WSClientOptions;
  private closed = false;
  private attempts = 0;
  private _connected = false;

  constructor(opts: WSClientOptions) {
    this.opts = opts;
    this.currentDelay = opts.reconnectDelay;
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    if (this.closed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    log.info(`Connecting to ${this.opts.url}`);
    this.ws = new WebSocket(this.opts.url);

    this.ws.addEventListener("open", () => {
      this.currentDelay = this.opts.reconnectDelay;
      this.attempts = 0;
      this._connected = true;
      log.info("WebSocket connected");
    });

    this.ws.addEventListener("message", (evt) => {
      try {
        const envelope = JSON.parse(String(evt.data));
        if (envelope.type === "connection:status") {
          this.opts.onConnected(envelope.payload?.clientId || "");
        } else {
          this.opts.onMessage(envelope.type, envelope.payload);
        }
      } catch {
        log.warn("Received malformed WebSocket message");
      }
    });

    this.ws.addEventListener("close", () => {
      this._connected = false;
      log.info("WebSocket disconnected");
      this.opts.onDisconnected();
      this.scheduleReconnect();
    });

    this.ws.addEventListener("error", () => {
      log.error("WebSocket error");
    });
  }

  send(type: string, payload: unknown): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) this.ws.close();
  }

  /** Reset attempt counter (call when manually re-promoting to WS) */
  resetAttempts(): void {
    this.closed = false;
    this.attempts = 0;
    this.currentDelay = this.opts.reconnectDelay;
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;

    this.attempts++;
    if (this.attempts > this.opts.maxReconnectAttempts) {
      log.warn(`WebSocket failed after ${this.attempts - 1} attempts — switching to HTTP fallback`);
      this.opts.onFallback();
      return;
    }

    log.info(`Reconnecting in ${this.currentDelay}ms (attempt ${this.attempts}/${this.opts.maxReconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.currentDelay = Math.min(this.currentDelay * 1.5, this.opts.maxReconnectDelay);
      this.connect();
    }, this.currentDelay);
  }
}
