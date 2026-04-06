import type { AgentConfig } from "../config/schema";

export class RateLimiter {
  private lastSendTime = 0;
  private sendTimestamps: number[] = [];
  private minDelay: number;
  private maxPerMinute: number;

  constructor(config: AgentConfig) {
    this.minDelay = config.limits.rate.min_delay_ms;
    this.maxPerMinute = config.limits.rate.max_per_minute;
  }

  canSend(): boolean {
    const now = Date.now();
    if (now - this.lastSendTime < this.minDelay) return false;

    const windowStart = now - 60_000;
    this.sendTimestamps = this.sendTimestamps.filter(t => t > windowStart);
    return this.sendTimestamps.length < this.maxPerMinute;
  }

  timeUntilReady(): number {
    const now = Date.now();
    const delayCooldown = Math.max(0, this.minDelay - (now - this.lastSendTime));

    const windowStart = now - 60_000;
    this.sendTimestamps = this.sendTimestamps.filter(t => t > windowStart);
    let windowCooldown = 0;
    if (this.sendTimestamps.length >= this.maxPerMinute) {
      windowCooldown = this.sendTimestamps[0] + 60_000 - now;
    }

    return Math.max(delayCooldown, windowCooldown);
  }

  recordSend(): void {
    const now = Date.now();
    this.lastSendTime = now;
    this.sendTimestamps.push(now);
  }
}
