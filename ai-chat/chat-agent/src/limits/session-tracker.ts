import type { AgentConfig } from "../config/schema";

export class SessionTracker {
  private sent = 0;
  private received = 0;
  private startTime = Date.now();
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  recordSent(): void { this.sent++; }
  recordReceived(): void { this.received++; }

  shouldStop(): { stop: boolean; reason: string } {
    const limits = this.config.limits;
    const elapsed = (Date.now() - this.startTime) / 60_000;

    if (this.sent >= limits.messages.max_sent) {
      return { stop: true, reason: `Max sent messages reached (${limits.messages.max_sent})` };
    }
    if (this.received >= limits.messages.max_received) {
      return { stop: true, reason: `Max received messages reached (${limits.messages.max_received})` };
    }
    if (this.sent + this.received >= limits.session.max_total_messages) {
      return { stop: true, reason: `Max total messages reached (${limits.session.max_total_messages})` };
    }
    if (elapsed >= limits.session.max_duration_minutes) {
      return { stop: true, reason: `Max session duration reached (${limits.session.max_duration_minutes}m)` };
    }

    return { stop: false, reason: "" };
  }

  getStats() {
    return {
      sent: this.sent,
      received: this.received,
      durationMinutes: Math.round((Date.now() - this.startTime) / 60_000 * 10) / 10,
    };
  }
}
