import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

const REQUEST_TIMEOUT = 15_000;
const DEFAULT_URL = "http://localhost:3007";

const ACTIONS = [
  "list_folders", "list_messages", "get_message", "send", "mark_read",
  "move_message", "delete_message", "save_draft", "list_templates", "create_template",
] as const;
type Action = (typeof ACTIONS)[number];

async function req(baseUrl: string, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${baseUrl}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  const data = await res.json().catch(() => res.text());
  return { status: res.status, data };
}

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const integ = (ctx.config.integrations as any)?.p_mail || {};
  const baseUrl = integ.url || DEFAULT_URL;
  const action = args.action as Action | undefined;
  if (!action || !ACTIONS.includes(action)) return formatError(`Unknown action: ${action}. Available: ${ACTIONS.join(", ")}`);

  try {
    let r;
    switch (action) {
      case "list_folders": r = await req(baseUrl, "GET", "/api/folders"); break;
      case "list_messages": {
        const folder = encodeURIComponent(String(args.folder || "INBOX"));
        const p = new URLSearchParams();
        if (args.limit) p.set("limit", String(args.limit));
        if (args.page) p.set("page", String(args.page));
        r = await req(baseUrl, "GET", `/api/messages/${folder}?${p}`);
        break;
      }
      case "get_message":
        r = await req(baseUrl, "GET", `/api/message/${encodeURIComponent(String(args.folder || "INBOX"))}/${args.uid}`);
        break;
      case "send":
        r = await req(baseUrl, "POST", "/api/send", {
          to: args.to, cc: args.cc, bcc: args.bcc, subject: args.subject, body: args.body, replyTo: args.reply_to,
        });
        break;
      case "mark_read":
        r = await req(baseUrl, "POST", "/api/mark-read", { folder: args.folder || "INBOX", uids: args.uids });
        break;
      case "move_message":
        r = await req(baseUrl, "POST", "/api/move", { folder: args.folder, uids: args.uids, destination: args.destination });
        break;
      case "delete_message":
        r = await req(baseUrl, "POST", "/api/delete", { folder: args.folder || "INBOX", uids: args.uids });
        break;
      case "save_draft":
        r = await req(baseUrl, "POST", "/api/drafts", { to: args.to, subject: args.subject, body: args.body });
        break;
      case "list_templates": r = await req(baseUrl, "GET", "/api/templates"); break;
      case "create_template":
        r = await req(baseUrl, "POST", "/api/templates", { name: args.name, subject: args.subject, body: args.body });
        break;
    }
    return formatResponse(r!.data);
  } catch (err: any) {
    return formatError(err.message);
  }
}

const tool: Tool = {
  name: "p_mail",
  description: "Email client. List folders, read/send/move/delete messages, manage drafts and templates.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: [...ACTIONS], description: "Action to perform" },
      folder: { type: "string", description: "Mail folder (default: INBOX)" },
      uid: { type: "number", description: "Message UID" },
      uids: { type: "array", items: { type: "number" }, description: "Message UIDs" },
      to: { type: "string" }, cc: { type: "string" }, bcc: { type: "string" },
      subject: { type: "string" }, body: { type: "string" },
      reply_to: { type: "string" }, destination: { type: "string" },
      name: { type: "string", description: "Template name" },
      limit: { type: "number" }, page: { type: "number" },
    },
    required: ["action"],
  },
  execute,
};

export default tool;
