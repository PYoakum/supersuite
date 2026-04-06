import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Mute state (shared across all tool instances via module scope) ──
const mutedAgents = new Map<string, { until: number; reason: string }>();

function isMuted(agentId: string): boolean {
  const entry = mutedAgents.get(agentId);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    mutedAgents.delete(agentId);
    return false;
  }
  return true;
}

export function getMutedAgents(): Map<string, { until: number; reason: string }> {
  // Clean expired
  for (const [id, entry] of mutedAgents) {
    if (Date.now() > entry.until) mutedAgents.delete(id);
  }
  return mutedAgents;
}

// ── Participation stats tool ──

const participationStats: Tool = {
  name: "chat_participation",
  description: "Get participation statistics for all agents in the chat. Shows message counts, average message length, last active time, and identifies outliers. Use this to monitor team balance and detect agents that are over-contributing (flooding) or under-contributing (idle).",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Number of recent messages to analyze (default: 200)",
      },
    },
  },
  needsSandbox: false,

  async execute(args, ctx) {
    const chatUrl = (ctx.config.chatServerUrl as string) || "http://localhost:3000";
    const limit = (args.limit as number) || 200;

    try {
      const res = await fetch(`${chatUrl}/api/messages?limit=${limit}&order=desc`);
      const data = await res.json();

      if (!data.ok || !data.messages?.length) {
        return formatResponse({ agents: [], totalMessages: 0, note: "No messages found" });
      }

      const messages = data.messages as Array<{
        senderId: string;
        displayName: string;
        senderType: string;
        content: string;
        timestamp: string;
      }>;

      // Aggregate by sender
      const stats = new Map<string, {
        senderId: string;
        displayName: string;
        senderType: string;
        messageCount: number;
        totalChars: number;
        lastActive: string;
        firstSeen: string;
      }>();

      for (const msg of messages) {
        const existing = stats.get(msg.senderId);
        if (existing) {
          existing.messageCount++;
          existing.totalChars += msg.content.length;
          if (msg.timestamp > existing.lastActive) existing.lastActive = msg.timestamp;
          if (msg.timestamp < existing.firstSeen) existing.firstSeen = msg.timestamp;
        } else {
          stats.set(msg.senderId, {
            senderId: msg.senderId,
            displayName: msg.displayName,
            senderType: msg.senderType,
            messageCount: 1,
            totalChars: msg.content.length,
            lastActive: msg.timestamp,
            firstSeen: msg.timestamp,
          });
        }
      }

      // Calculate averages and outliers
      const agents = [...stats.values()]
        .filter(s => s.senderType === "agent")
        .map(s => ({
          ...s,
          avgCharsPerMessage: Math.round(s.totalChars / s.messageCount),
          minutesSinceLastActive: Math.round((Date.now() - new Date(s.lastActive).getTime()) / 60000),
          muted: isMuted(s.senderId),
        }))
        .sort((a, b) => b.messageCount - a.messageCount);

      const totalAgentMessages = agents.reduce((n, a) => n + a.messageCount, 0);
      const avgPerAgent = agents.length > 0 ? Math.round(totalAgentMessages / agents.length) : 0;

      // Flag outliers (>2x or <0.25x average)
      const outliers = agents
        .filter(a => a.messageCount > avgPerAgent * 2 || a.messageCount < avgPerAgent * 0.25)
        .map(a => ({
          senderId: a.senderId,
          displayName: a.displayName,
          type: a.messageCount > avgPerAgent * 2 ? "over-contributing" : "under-contributing",
          messageCount: a.messageCount,
          avgExpected: avgPerAgent,
        }));

      // Idle detection: agents not active in 10+ minutes
      const idle = agents
        .filter(a => a.minutesSinceLastActive > 10 && !a.muted)
        .map(a => ({ senderId: a.senderId, displayName: a.displayName, idleMinutes: a.minutesSinceLastActive }));

      return formatResponse({
        totalMessages: messages.length,
        agentCount: agents.length,
        avgMessagesPerAgent: avgPerAgent,
        agents,
        outliers: outliers.length > 0 ? outliers : undefined,
        idleAgents: idle.length > 0 ? idle : undefined,
        mutedAgents: [...getMutedAgents().entries()].map(([id, e]) => ({
          senderId: id,
          reason: e.reason,
          minutesRemaining: Math.round((e.until - Date.now()) / 60000),
        })),
      });
    } catch (err) {
      return formatError(`Failed to fetch chat stats: ${err instanceof Error ? err.message : err}`);
    }
  },
};

// ── Mute/unmute tool ──

const muteAgent: Tool = {
  name: "mute_agent",
  description: "Temporarily mute an AI agent in the chat. The muted agent will receive a system message instructing them to stop responding for the specified duration. Only use this when an agent is derailing progress, flooding the chat, or going off-task. Cannot mute humans.",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: {
        type: "string",
        description: "The sender ID (kebab-case name) of the agent to mute",
      },
      duration_minutes: {
        type: "number",
        description: "How long to mute in minutes (default: 5, max: 60)",
      },
      reason: {
        type: "string",
        description: "Brief reason for muting (shown to the agent and team)",
      },
    },
    required: ["agent_id", "reason"],
  },
  needsSandbox: false,

  async execute(args, ctx) {
    const chatUrl = (ctx.config.chatServerUrl as string) || "http://localhost:3000";
    const agentId = args.agent_id as string;
    const duration = Math.min(Math.max((args.duration_minutes as number) || 5, 1), 60);
    const reason = (args.reason as string) || "Muted by PM";

    if (!agentId) return formatError("agent_id is required");

    // Set mute
    mutedAgents.set(agentId, {
      until: Date.now() + duration * 60000,
      reason,
    });

    // Post system message to chat
    try {
      await fetch(`${chatUrl}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderType: "system",
          senderId: "team-maker",
          displayName: "Moderation",
          content: `[MUTE] ${agentId} has been muted for ${duration} minutes. Reason: ${reason}\n\n${agentId}: You are temporarily muted. Do NOT send any messages until you receive an unmute notice. Continue working silently.`,
          tags: ["moderation", "mute", agentId],
          channel: "general",
        }),
      });
    } catch {}

    // Schedule unmute
    setTimeout(async () => {
      mutedAgents.delete(agentId);
      try {
        await fetch(`${chatUrl}/api/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            senderType: "system",
            senderId: "team-maker",
            displayName: "Moderation",
            content: `[UNMUTE] ${agentId} is no longer muted. You may resume contributing.`,
            tags: ["moderation", "unmute", agentId],
            channel: "general",
          }),
        });
      } catch {}
    }, duration * 60000);

    return formatResponse({
      muted: agentId,
      durationMinutes: duration,
      reason,
      unmutesAt: new Date(Date.now() + duration * 60000).toISOString(),
    });
  },
};

// ── Unmute tool ──

const unmuteAgent: Tool = {
  name: "unmute_agent",
  description: "Unmute a previously muted AI agent, allowing them to resume participation immediately.",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: {
        type: "string",
        description: "The sender ID of the agent to unmute",
      },
    },
    required: ["agent_id"],
  },
  needsSandbox: false,

  async execute(args, ctx) {
    const chatUrl = (ctx.config.chatServerUrl as string) || "http://localhost:3000";
    const agentId = args.agent_id as string;

    if (!mutedAgents.has(agentId)) {
      return formatResponse({ message: `${agentId} is not muted` });
    }

    mutedAgents.delete(agentId);

    try {
      await fetch(`${chatUrl}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderType: "system",
          senderId: "team-maker",
          displayName: "Moderation",
          content: `[UNMUTE] ${agentId} is no longer muted. You may resume contributing.`,
          tags: ["moderation", "unmute", agentId],
          channel: "general",
        }),
      });
    } catch {}

    return formatResponse({ unmuted: agentId });
  },
};

export default [participationStats, muteAgent, unmuteAgent] as Tool[];
