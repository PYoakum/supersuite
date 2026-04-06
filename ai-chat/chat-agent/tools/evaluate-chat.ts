import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const chatServerUrl = ctx.config.chatServerUrl as string;
  if (!chatServerUrl) return formatError("chatServerUrl not configured");

  const windowMinutes = (args.window_minutes as number) || 30;
  const focus = (args.focus as string) || "all";

  // Fetch recent messages within the time window
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const params = new URLSearchParams();
  params.set("limit", "500");
  params.set("order", "asc");

  const res = await fetch(`${chatServerUrl}/api/messages?${params}`);
  const data = await res.json() as any;
  if (!data.ok) return formatError(`Fetch failed: ${data.errors?.join(", ") || "unknown"}`);

  const allMessages = (data.messages || []) as any[];
  const messages = allMessages.filter((m: any) => m.timestamp >= since);

  if (messages.length === 0) {
    return formatResponse({
      window_minutes: windowMinutes,
      message_count: 0,
      summary: "No messages in the evaluation window.",
    });
  }

  // Build participation stats
  const participation: Record<string, { count: number; type: string; role: string; lastActive: string }> = {};
  const taskMentions: string[] = [];
  const toolUsage: Record<string, number> = {};
  let humanMessages = 0;
  let agentMessages = 0;
  let systemMessages = 0;

  for (const m of messages) {
    const key = m.displayName || m.senderId;
    if (!participation[key]) {
      participation[key] = { count: 0, type: m.senderType, role: m.role || "", lastActive: "" };
    }
    participation[key].count++;
    participation[key].lastActive = m.timestamp;

    if (m.senderType === "human") humanMessages++;
    else if (m.senderType === "agent") agentMessages++;
    else systemMessages++;

    // Track task mentions
    const taskMatch = m.content.match(/\[TASK:\w+:\w+\]/g);
    if (taskMatch) taskMentions.push(...taskMatch);

    // Track tool usage
    if (m.contentFormat === "tool-use" && m.tags) {
      const toolName = m.tags.find((t: string) => t !== "tool-use");
      if (toolName) toolUsage[toolName] = (toolUsage[toolName] || 0) + 1;
    }
  }

  // Build recent conversation excerpt (last N messages, filtered by focus)
  let excerpt = messages;
  if (focus === "agents") excerpt = messages.filter((m: any) => m.senderType === "agent");
  else if (focus === "humans") excerpt = messages.filter((m: any) => m.senderType === "human");
  else if (focus === "tasks") excerpt = messages.filter((m: any) => /\[TASK:|task|deliverable|blocked|done/i.test(m.content));

  const recentExcerpt = excerpt.slice(-30).map((m: any) => {
    const ts = new Date(m.timestamp).toISOString().slice(11, 16);
    return `[${ts}] ${m.displayName}: ${m.content.slice(0, 300)}`;
  });

  // Identify silent agents (in participation but no recent messages)
  const participantNames = Object.keys(participation);
  const activeThreshold = new Date(Date.now() - 10 * 60_000).toISOString();
  const silentAgents = participantNames.filter(
    name => participation[name].type === "agent" && participation[name].lastActive < activeThreshold
  );

  return formatResponse({
    window_minutes: windowMinutes,
    focus,
    message_count: messages.length,
    breakdown: { human: humanMessages, agent: agentMessages, system: systemMessages },
    participation: Object.entries(participation)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, stats]) => ({
        name,
        messages: stats.count,
        type: stats.type,
        role: stats.role,
        last_active: stats.lastActive,
      })),
    silent_agents: silentAgents,
    task_updates: taskMentions,
    tool_usage: toolUsage,
    recent_excerpt: recentExcerpt,
  });
}

const evaluateChatTool: Tool = {
  name: "evaluate_chat",
  description:
    "Evaluate recent chat activity for team coordination. Returns participation stats, task update mentions, " +
    "tool usage, silent agents, and a recent conversation excerpt. Use this to assess team progress, " +
    "identify idle workers, and track task status. Intended for PM agents.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      window_minutes: {
        type: "number",
        description: "How far back to evaluate in minutes (default 30)",
      },
      focus: {
        type: "string",
        enum: ["all", "agents", "humans", "tasks"],
        description: "Filter excerpt: all messages, only agents, only humans, or task-related (default all)",
      },
    },
  },
  execute,
};

export default evaluateChatTool;
