import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Helpers ────────────────────────────────────────────────────

function getTeamMakerUrl(ctx: ToolContext): string {
  return (ctx.config.teamMakerUrl as string) || "http://localhost:3200";
}

function getChatUrl(ctx: ToolContext): string {
  return (ctx.config.chatServerUrl as string) || "http://localhost:3000";
}

// ── recruit_agent ──────────────────────────────────────────────

async function executeRecruit(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const name = args.name as string | undefined;
  const role = args.role as string | undefined;
  const focus = args.focus as string | undefined;
  const preambleType = (args.preamble_type as string) || "worker";
  const provider = args.provider as string | undefined;
  const model = args.model as string | undefined;
  const tools = args.tools as string[] | undefined;
  const skills = args.skills as string[] | undefined;

  if (!name) return formatError("name is required");
  if (!role) return formatError("role is required (e.g. 'lyricist', 'developer', 'researcher')");
  if (!focus) return formatError("focus is required (describe what this agent should work on)");

  const tmUrl = getTeamMakerUrl(ctx);

  // Pre-flight: check team size
  try {
    const agentsRes = await fetch(`${tmUrl}/api/agents`);
    const agentsData = await agentsRes.json() as any;
    const running = (agentsData.agents || []).filter((a: any) => a.running);
    if (running.length >= 8) {
      return formatError(`Team size cap reached (${running.length} agents running). Dismiss agents before recruiting.`);
    }
  } catch (err) {
    return formatError(`Cannot reach team-maker at ${tmUrl}: ${err}`);
  }

  // Pre-flight: check project token budget
  try {
    const statsRes = await fetch(`${tmUrl}/api/agents/stats`);
    const statsData = await statsRes.json() as any;
    if (statsData.budgetRemaining !== undefined && statsData.budgetRemaining <= 0) {
      return formatError(`Project token budget exhausted. Cannot recruit new agents.`);
    }
  } catch {}

  // Recruit
  const res = await fetch(`${tmUrl}/api/agents/recruit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, role, focus, preambleType, provider, model, tools, skills }),
  });

  const data = await res.json() as any;
  if (!data.ok) {
    return formatError(`Recruit failed: ${data.errors?.join(", ") || "unknown"}`);
  }

  return formatResponse({
    recruited: true,
    roleId: data.roleId,
    displayName: data.displayName || name,
    pid: data.pid,
    alreadyRunning: data.alreadyRunning || false,
  });
}

// ── dismiss_agent ──────────────────────────────────────────────

async function executeDismiss(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const agentId = args.agent_id as string | undefined;
  const reason = (args.reason as string) || "Work completed";

  if (!agentId) return formatError("agent_id is required");

  const tmUrl = getTeamMakerUrl(ctx);
  const chatUrl = getChatUrl(ctx);
  const pmId = ctx.config.agentId as string;
  const pmName = ctx.config.agentName as string;

  // Fetch agent's messages from chat
  let messageCount = 0;
  let messagesSummary = "";
  try {
    const searchRes = await fetch(`${chatUrl}/api/search?senderId=${encodeURIComponent(agentId)}&limit=200`);
    const searchData = await searchRes.json() as any;
    const messages = searchData.results || [];
    messageCount = messages.length;
    if (messages.length > 0) {
      const first = messages[0];
      const last = messages[messages.length - 1];
      messagesSummary = `${messages.length} messages from ${first.timestamp?.slice(11, 16) || "?"} to ${last.timestamp?.slice(11, 16) || "?"}`;
    }
  } catch {}

  // Fetch agent's token stats
  let tokenInfo = { inputTokens: 0, outputTokens: 0 };
  try {
    const statsRes = await fetch(`${tmUrl}/api/agents/stats`);
    const statsData = await statsRes.json() as any;
    tokenInfo = statsData.stats?.[agentId] || tokenInfo;
  } catch {}

  // Compile work summary
  const summary = [
    `AGENT DISMISSED: ${agentId}`,
    `Reason: ${reason}`,
    `Messages: ${messagesSummary || "none recorded"}`,
    `Tokens: ${tokenInfo.inputTokens.toLocaleString()} input, ${tokenInfo.outputTokens.toLocaleString()} output`,
    `Dismissed by: ${pmName}`,
  ].join("\n");

  // Post summary to chat
  try {
    await fetch(`${chatUrl}/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderType: "system",
        senderId: pmId,
        displayName: pmName,
        content: summary,
        tags: ["dismissal", agentId],
        channel: "general",
      }),
    });
  } catch {}

  // Stop the agent
  try {
    await fetch(`${tmUrl}/api/agents/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: agentId }),
    });
  } catch (err) {
    return formatError(`Failed to stop agent: ${err}`);
  }

  return formatResponse({
    dismissed: true,
    agentId,
    reason,
    messages: messageCount,
    tokens: tokenInfo,
    summary,
  });
}

// ── team_status ────────────────────────────────────────────────

async function executeTeamStatus(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const tmUrl = getTeamMakerUrl(ctx);

  let agents: any[] = [];
  try {
    const res = await fetch(`${tmUrl}/api/agents`);
    const data = await res.json() as any;
    agents = data.agents || [];
  } catch (err) {
    return formatError(`Cannot reach team-maker: ${err}`);
  }

  let stats: any = {};
  let totals = { inputTokens: 0, outputTokens: 0 };
  let projectBudget = 0;
  let budgetRemaining = 0;
  try {
    const res = await fetch(`${tmUrl}/api/agents/stats`);
    const data = await res.json() as any;
    stats = data.stats || {};
    totals = data.totals || totals;
    projectBudget = data.projectBudget || 0;
    budgetRemaining = data.budgetRemaining || 0;
  } catch {}

  const team = agents.map((a: any) => ({
    roleId: a.roleId,
    pid: a.pid,
    running: a.running,
    tokens: stats[a.roleId?.toLowerCase()] || stats[a.roleId] || { inputTokens: 0, outputTokens: 0 },
  }));

  return formatResponse({
    teamSize: agents.length,
    agents: team,
    totals,
    projectBudget,
    budgetRemaining,
    budgetUsedPct: projectBudget > 0 ? Math.round(((totals.inputTokens + totals.outputTokens) / projectBudget) * 100) : 0,
  });
}

// ── update_task_tokens ─────────────────────────────────────────

async function executeUpdateTaskTokens(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const taskId = args.task_id as string | undefined;
  const tokensUsed = args.tokens_used as number | undefined;
  const tokenBudget = args.token_budget as number | undefined;

  if (!taskId) return formatError("task_id is required");
  if (tokensUsed === undefined || tokensUsed < 0) return formatError("tokens_used must be a non-negative number");

  const taskUrl = (ctx.config.taskServerUrl as string) || "http://localhost:3001";

  const payload: Record<string, unknown> = { tokensUsed };
  if (tokenBudget !== undefined) payload.tokenBudget = tokenBudget;

  const res = await fetch(`${taskUrl}/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json() as any;
  if (!data.ok) {
    return formatError(`Failed to update task: ${data.errors?.join(", ") || "not found"}`);
  }

  const task = data.task;
  const overBudget = task.tokenBudget > 0 && task.tokensUsed > task.tokenBudget;

  return formatResponse({
    updated: true,
    taskId: task.id,
    tokensUsed: task.tokensUsed,
    tokenBudget: task.tokenBudget,
    overBudget,
    warning: overBudget ? `Task exceeded token budget (${task.tokensUsed.toLocaleString()} / ${task.tokenBudget.toLocaleString()})` : null,
  });
}

// ── Tool Definitions ───────────────────────────────────────────

const recruitAgentTool: Tool = {
  name: "recruit_agent",
  description:
    "Create and launch a new AI agent to join the team. Specify their name, role, and focus area. " +
    "The agent will be spawned as a chat-agent process and announced in the chat. " +
    "Check team_status first to verify team size cap hasn't been reached.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Display name for the agent (e.g. 'Maya', 'DevBot')" },
      role: { type: "string", description: "Role description (e.g. 'frontend developer', 'researcher')" },
      focus: { type: "string", description: "What this agent should work on — injected into their system prompt" },
      preamble_type: { type: "string", enum: ["worker", "pm"], description: "Agent type (default: worker)" },
      provider: { type: "string", description: "LLM provider (default: anthropic)" },
      model: { type: "string", description: "LLM model (default: claude-sonnet-4-20250514)" },
      tools: { type: "array", items: { type: "string" }, description: "Tool allowlist (default: role-appropriate tools)" },
      skills: { type: "array", items: { type: "string" }, description: "Skill filenames to assign (e.g. ['aos-core.md'])" },
    },
    required: ["name", "role", "focus"],
  },
  execute: executeRecruit,
};

const dismissAgentTool: Tool = {
  name: "dismiss_agent",
  description:
    "Stop a running agent and post a work summary to the chat. The summary includes messages sent, " +
    "tokens consumed, and key activities. Always update task tokens after dismissal.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "The agent's sender_id (e.g. 'lyric', 'devbot')" },
      reason: { type: "string", description: "Why the agent is being dismissed (default: 'Work completed')" },
    },
    required: ["agent_id"],
  },
  execute: executeDismiss,
};

const teamStatusTool: Tool = {
  name: "team_status",
  description:
    "Get current team composition, token usage per agent, and project budget status. " +
    "Use this before recruiting to check team size, and periodically to monitor token spend.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {},
  },
  execute: executeTeamStatus,
};

const updateTaskTokensTool: Tool = {
  name: "update_task_tokens",
  description:
    "Record token usage against a task. Tokens are additive — each call adds to the running total. " +
    "Optionally set a token budget for the task. Returns a warning if the task exceeds its budget.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "The task ID to update" },
      tokens_used: { type: "number", description: "Number of tokens to add to this task's total" },
      token_budget: { type: "number", description: "Set or update the token budget for this task" },
    },
    required: ["task_id", "tokens_used"],
  },
  execute: executeUpdateTaskTokens,
};

const tools: Tool[] = [recruitAgentTool, dismissAgentTool, teamStatusTool, updateTaskTokensTool];

export default tools;
