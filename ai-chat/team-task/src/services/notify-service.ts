import { config } from "../config";
import type { Task } from "../models/task";

export type NotifyResult = { sent: true } | { sent: false; reason: string };

class NotifyService {
  isConfigured(): boolean {
    return !!config.chatUrl;
  }

  async notifyTaskChange(task: Task, action: string): Promise<NotifyResult> {
    if (!config.chatUrl) return { sent: false, reason: "CHAT_URL is not configured" };

    const statusIcon: Record<string, string> = {
      todo: "[TODO]",
      "in-progress": "[IN PROGRESS]",
      blocked: "[BLOCKED]",
      done: "[DONE]",
      cancelled: "[CANCELLED]",
    };

    const icon = statusIcon[task.status] || `[${task.status.toUpperCase()}]`;
    let content = `${icon} Task "${task.title}" (${task.id}) — ${action}`;

    if (task.assignee) content += `\nAssignee: ${task.assignee}`;
    if (task.group) content += `\nGroup: ${task.group}`;
    if (task.dependencies.length > 0) content += `\nDependencies: ${task.dependencies.join(", ")}`;
    if (task.tags.length > 0) content += `\nTags: ${task.tags.map((t) => `#${t}`).join(" ")}`;

    return this.send(content, ["task-update", task.status, ...task.tags]);
  }

  async notifyImport(count: number): Promise<NotifyResult> {
    if (!config.chatUrl) return { sent: false, reason: "CHAT_URL is not configured" };
    return this.send(`Imported ${count} task${count === 1 ? "" : "s"}`, ["task-import"]);
  }

  async send(content: string, tags: string[]): Promise<NotifyResult> {
    try {
      const res = await fetch(`${config.chatUrl}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderType: "agent",
          senderId: config.chatSenderId,
          displayName: config.chatDisplayName,
          role: "task-management",
          content,
          tags,
          channel: config.chatChannel,
        }),
      });
      if (!res.ok) return { sent: false, reason: `ai-chat responded ${res.status}` };
      return { sent: true };
    } catch (err: any) {
      return { sent: false, reason: `Could not reach ${config.chatUrl} — ${err?.message || "connection failed"}` };
    }
  }
}

export const notifyService = new NotifyService();
