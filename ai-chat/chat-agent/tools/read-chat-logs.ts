import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const chatServerUrl = ctx.config.chatServerUrl as string;
  if (!chatServerUrl) return formatError("chatServerUrl not configured");

  const q = args.query as string | undefined;
  const senderId = args.sender_id as string | undefined;
  const senderType = args.sender_type as string | undefined;
  const after = args.after as string | undefined;
  const before = args.before as string | undefined;
  const limit = (args.limit as number) || 50;

  // Use search if query provided, otherwise get recent messages
  let messages: any[];

  if (q) {
    const params = new URLSearchParams();
    params.set("q", q);
    if (senderId) params.set("senderId", senderId);
    if (senderType) params.set("senderType", senderType);
    if (after) params.set("after", after);
    if (before) params.set("before", before);
    params.set("limit", String(limit));

    const res = await fetch(`${chatServerUrl}/api/search?${params}`);
    const data = await res.json() as any;
    if (!data.ok) return formatError(`Search failed: ${data.errors?.join(", ") || "unknown"}`);
    messages = data.results || [];
  } else {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("order", "desc");
    if (after) params.set("after", after);
    if (before) params.set("before", before);

    const res = await fetch(`${chatServerUrl}/api/messages?${params}`);
    const data = await res.json() as any;
    if (!data.ok) return formatError(`Fetch failed: ${data.errors?.join(", ") || "unknown"}`);
    messages = data.messages || [];
  }

  if (messages.length === 0) {
    return formatResponse({ count: 0, messages: [] });
  }

  // Format messages for LLM context
  const formatted = messages.map((m: any) => {
    const ts = m.timestamp ? new Date(m.timestamp).toISOString().slice(0, 16).replace("T", " ") : "";
    const role = m.role ? ` (${m.role})` : "";
    const tags = m.tags?.length ? ` [${m.tags.join(", ")}]` : "";
    return `[${ts}] ${m.displayName}${role}${tags}: ${m.content}`;
  });

  return formatResponse({
    count: messages.length,
    messages: formatted,
  });
}

const readChatLogsTool: Tool = {
  name: "read_chat_logs",
  description:
    "Search and read chat message history. Use a query to search by keyword, or omit to get recent messages. " +
    "Results include timestamps, sender names, roles, and tags. Use this to review past conversations, " +
    "find specific discussions, or build context about what happened.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search keyword (omit to get recent messages)" },
      sender_id: { type: "string", description: "Filter by sender ID" },
      sender_type: { type: "string", enum: ["human", "agent", "system"], description: "Filter by sender type" },
      after: { type: "string", description: "Only messages after this ISO timestamp or message ID" },
      before: { type: "string", description: "Only messages before this ISO timestamp or message ID" },
      limit: { type: "number", description: "Max messages to return (default 50, max 200)" },
    },
  },
  execute,
};

export default readChatLogsTool;
