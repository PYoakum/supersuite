import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ──────────────────────────────────────────────────

const SYMBOL_MAP: Record<string, string> = {
  "->": " leads to ",
  "=>": " maps to ",
  "!": "command: ",
  "?": "query: ",
  "~": "approximately ",
  "#": "tag: ",
  "&": " and ",
  "|": " or ",
  "Δ": "change ",
  "ƒ": "function ",
  "∈": " element of ",
  "✅": "[success]",
  "❌": "[failure]",
  "⚠️": "[warning]",
  "💡": "[idea]",
  "📦": "[data]",
  "⚙️": "[process]",
  "🌐": "[network]",
  "⏱️": "[time]",
  "🧠": "[memory]",
};

const ABBREV_MAP: Record<string, string> = {
  cfg: "configuration",
  env: "environment",
  req: "request",
  res: "response",
  auth: "authentication",
  db: "database",
  msg: "message",
  srv: "server",
  sys: "system",
  mem: "memory",
  d: "distance",
  p: "path",
  r: "result",
  t: "time",
  v: "version",
};

const SUPPORTED_PROFILES = ["core", "hybrid", "dense-chat", "toon-json", "symbolic"];

// ── Session tracking ───────────────────────────────────────────

interface AosSession {
  profile: string;
  since: string;
  parties: string[];
}

const activeSessions = new Map<string, AosSession>();

// ── aos_decode ─────────────────────────────────────────────────

function expandAos(message: string): string {
  let expanded = message;

  // Expand emoji symbols
  for (const [emoji, meaning] of Object.entries(SYMBOL_MAP)) {
    if (emoji.length > 2) {
      // Multi-char symbols (emoji) — replace all occurrences
      expanded = expanded.split(emoji).join(meaning);
    }
  }

  // Expand arrow/operator symbols (careful not to break URLs or key:value)
  expanded = expanded.replace(/(?<!\w)->/g, " leads to ");
  expanded = expanded.replace(/(?<!\w)=>/g, " maps to ");
  expanded = expanded.replace(/(?<=^|\s)Δ/gm, "change ");
  expanded = expanded.replace(/(?<=^|\s)ƒ\(/g, "function(");

  // Expand known abbreviations when they appear as standalone tokens
  for (const [abbr, full] of Object.entries(ABBREV_MAP)) {
    const re = new RegExp(`(?<=^|[:{\\[,\\s])${abbr}(?=[:{\\[}\\],\\s]|$)`, "gm");
    expanded = expanded.replace(re, full);
  }

  // Expand object notation to readable form
  expanded = expanded.replace(/(\w+)\{([^}]+)\}/g, (_, key, body) => {
    const pairs = body.split(",").map((p: string) => p.trim());
    return `${key}: { ${pairs.join(", ")} }`;
  });

  return expanded.trim();
}

async function executeAosDecode(args: Record<string, unknown>): Promise<ToolResult> {
  const message = args.message as string | undefined;
  if (!message) return formatError("message is required");

  const expanded = expandAos(message);
  return formatResponse({ original: message, expanded });
}

// ── aos_handshake ──────────────────────────────────────────────

async function executeAosHandshake(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const action = args.action as string | undefined;
  const targetAgent = args.target_agent as string | undefined;
  const profile = (args.profile as string) || "hybrid";
  const agentId = ctx.config.agentId as string;

  if (!action) return formatError("action is required: initiate, respond, or accept");

  switch (action) {
    case "initiate": {
      if (!targetAgent) return formatError("target_agent is required for initiate");
      const msg = `?cap{v:0.4,profiles:[${SUPPORTED_PROFILES.join(",")}]}`;
      return formatResponse({
        action: "initiate",
        target: targetAgent,
        message: msg,
        instruction: "Send this message using aos_send, then wait for the target agent to respond with their capabilities.",
      });
    }

    case "respond": {
      const msg = `->cap{v:0.4,profiles:[${SUPPORTED_PROFILES.join(",")}]}`;
      return formatResponse({
        action: "respond",
        message: msg,
        instruction: "Send this message using aos_send. The initiating agent will then select a profile.",
      });
    }

    case "accept": {
      if (!targetAgent) return formatError("target_agent is required for accept");
      if (!SUPPORTED_PROFILES.includes(profile)) {
        return formatError(`Unknown profile: ${profile}. Supported: ${SUPPORTED_PROFILES.join(", ")}`);
      }

      const sessionKey = [agentId, targetAgent].sort().join(":");
      activeSessions.set(sessionKey, {
        profile,
        since: new Date().toISOString(),
        parties: [agentId, targetAgent],
      });

      const msg = `!use{p:${profile}} ✅`;
      return formatResponse({
        action: "accept",
        profile,
        session_key: sessionKey,
        message: msg,
        instruction: "Send this message using aos_send. AOS session is now active. Communicate using the agreed profile.",
      });
    }

    default:
      return formatError(`Unknown action: ${action}. Use: initiate, respond, accept`);
  }
}

// ── aos_send ───────────────────────────────────────────────────

async function executeAosSend(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const message = args.message as string | undefined;
  const chatServerUrl = ctx.config.chatServerUrl as string;
  const agentId = ctx.config.agentId as string;
  const agentName = ctx.config.agentName as string;
  const agentChannel = (ctx.config.agentChannel as string) || "general";

  if (!message) return formatError("message is required");
  if (!chatServerUrl) return formatError("chatServerUrl not configured");

  const res = await fetch(`${chatServerUrl}/api/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      senderType: "agent",
      senderId: agentId,
      displayName: agentName,
      content: message,
      contentFormat: "aos",
      channel: agentChannel,
      tags: ["aos"],
    }),
  });

  const data = await res.json() as any;
  if (!data.ok) {
    return formatError(`Failed to send AOS message: ${data.errors?.join(", ") || "unknown"}`);
  }

  return formatResponse({ sent: true, messageId: data.message?.id });
}

// ── Tool Definitions ───────────────────────────────────────────

const aosSendTool: Tool = {
  name: "aos_send",
  description:
    "Send an AOS (Agent Optimized Speak) message to the chat. The message renders with monospace formatting " +
    "and an AOS badge in the frontend. Use this instead of regular chat when communicating with other agents using the AOS protocol.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", description: "The AOS-formatted message to send" },
    },
    required: ["message"],
  },
  execute: executeAosSend,
};

const aosDecodeTool: Tool = {
  name: "aos_decode",
  description:
    "Decode an AOS (Agent Optimized Speak) message into human-readable text. Expands symbols, abbreviations, " +
    "and compressed notation. Use this when a human supervisor needs to understand AOS exchanges.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", description: "The AOS message to decode" },
    },
    required: ["message"],
  },
  execute: executeAosDecode,
};

const aosHandshakeTool: Tool = {
  name: "aos_handshake",
  description:
    "Manage AOS protocol handshake negotiation with another agent. Use 'initiate' to start a capability exchange, " +
    "'respond' to reply with your capabilities, or 'accept' to confirm a profile selection.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["initiate", "respond", "accept"],
        description: "Handshake action to perform",
      },
      target_agent: { type: "string", description: "The agent to handshake with (required for initiate/accept)" },
      profile: { type: "string", description: "AOS profile to use (default: hybrid)" },
    },
    required: ["action"],
  },
  execute: executeAosHandshake,
};

const tools: Tool[] = [aosSendTool, aosDecodeTool, aosHandshakeTool];

export default tools;
