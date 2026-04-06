import type { AgentConfig } from "../config/schema";
import { log } from "../logger";

export type WebhookEvent = "error" | "limit_reached" | "session_end";

export class WebhookNotifier {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async notify(event: WebhookEvent, details: Record<string, unknown>): Promise<void> {
    const { webhooks, identity } = this.config;
    if (!webhooks.url) return;

    if (event === "error" && !webhooks.on_error) return;
    if (event === "limit_reached" && !webhooks.on_limit_reached) return;
    if (event === "session_end" && !webhooks.on_session_end) return;

    const payload = {
      event,
      agent_id: identity.sender_id,
      timestamp: new Date().toISOString(),
      details,
    };

    try {
      await fetch(webhooks.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      log.debug(`Webhook sent: ${event}`);
    } catch (err) {
      log.warn(`Webhook delivery failed: ${err}`);
    }
  }
}
