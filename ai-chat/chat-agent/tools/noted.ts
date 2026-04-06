import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ──────────────────────────────────────────────

const REQUEST_TIMEOUT = 15_000;
const DEFAULT_NOTED_URL = "http://localhost:3001";

const ACTIONS = [
  "list_docs",
  "get_doc",
  "create_doc",
  "save_doc",
  "delete_doc",
  "search",
  "list_versions",
  "list_tags",
  "create_tag",
  "tag_doc",
  "list_folders",
  "create_folder",
  "move_doc",
] as const;

type Action = (typeof ACTIONS)[number];

// ── Session Cache ─────────────────────────────────────────

let cachedSession: { cookie: string } | null = null;

// ── Helpers ───────────────────────────────────────────────

async function notedLogin(baseUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error(`Login failed: ${res.status}`);
  cachedSession = { cookie };
  return cookie;
}

async function notedRequest(
  baseUrl: string,
  cookie: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const url = `${baseUrl.replace(/\/+$/, "")}${path}`;

  const headers: Record<string, string> = {
    "Accept": "application/json",
    "Cookie": cookie,
  };

  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  };

  if (body && !["GET", "HEAD"].includes(method)) {
    init.body = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }

  const resp = await fetch(url, init);
  const text = await resp.text();

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return { status: resp.status, data };
}

async function ensureCookie(
  baseUrl: string,
  email: string,
  password: string
): Promise<string> {
  if (cachedSession) return cachedSession.cookie;
  return notedLogin(baseUrl, email, password);
}

async function authedRequest(
  baseUrl: string,
  email: string,
  password: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  let cookie = await ensureCookie(baseUrl, email, password);
  let result = await notedRequest(baseUrl, cookie, method, path, body);

  // Re-login on 401
  if (result.status === 401) {
    cachedSession = null;
    cookie = await notedLogin(baseUrl, email, password);
    result = await notedRequest(baseUrl, cookie, method, path, body);
  }

  return result;
}

// ── Actions ───────────────────────────────────────────────

async function actionListDocs(baseUrl: string, email: string, password: string, args: Record<string, unknown>): Promise<ToolResult> {
  const params = new URLSearchParams();
  if (args.folder_id) params.set("folder", args.folder_id as string);
  if (args.tag_name) params.set("tag", args.tag_name as string);
  const qs = params.toString();
  const path = `/api/docs${qs ? `?${qs}` : ""}`;

  const result = await authedRequest(baseUrl, email, password, "GET", path);
  if (result.status !== 200) return formatError(`Failed to list docs (${result.status}): ${JSON.stringify(result.data)}`);
  return formatResponse({ action: "list_docs", docs: result.data });
}

async function actionGetDoc(baseUrl: string, email: string, password: string, args: Record<string, unknown>): Promise<ToolResult> {
  const slug = args.slug as string;
  if (!slug) return formatError("slug is required");

  const result = await authedRequest(baseUrl, email, password, "GET", `/api/docs/${slug}`);
  if (result.status !== 200) return formatError(`Failed to get doc (${result.status}): ${JSON.stringify(result.data)}`);
  return formatResponse({ action: "get_doc", doc: result.data });
}

async function actionCreateDoc(baseUrl: string, email: string, password: string, args: Record<string, unknown>): Promise<ToolResult> {
  const title = args.title as string;
  if (!title) return formatError("title is required");

  const result = await authedRequest(baseUrl, email, password, "POST", "/api/docs", { title });
  if (result.status !== 201 && result.status !== 200) {
    return formatError(`Failed to create doc (${result.status}): ${JSON.stringify(result.data)}`);
  }
  return formatResponse({ action: "create_doc", doc: result.data });
}

async function actionSaveDoc(baseUrl: string, email: string, password: string, args: Record<string, unknown>): Promise<ToolResult> {
  const slug = args.slug as string;
  if (!slug) return formatError("slug is required");
  const content = args.content as string;
  if (content === undefined) return formatError("content is required");

  const body: Record<string, unknown> = { content };
  if (args.base_version_id) body.baseVersionId = args.base_version_id;

  const result = await authedRequest(baseUrl, email, password, "POST", `/api/docs/${slug}/save`, body);
  if (result.status !== 200) return formatError(`Failed to save doc (${result.status}): ${JSON.stringify(result.data)}`);
  return formatResponse({ action: "save_doc", doc: result.data });
}

async function actionDeleteDoc(baseUrl: string, email: string, password: string, args: Record<string, unknown>): Promise<ToolResult> {
  const slug = args.slug as string;
  if (!slug) return formatError("slug is required");

  const result = await authedRequest(baseUrl, email, password, "DELETE", `/api/docs/${slug}`);
  if (result.status !== 200 && result.status !== 204) {
    return formatError(`Failed to delete doc (${result.status}): ${JSON.stringify(result.data)}`);
  }
  return formatResponse({ action: "delete_doc", slug, deleted: true });
}

async function actionSearch(baseUrl: string, email: string, password: string, args: Record<string, unknown>): Promise<ToolResult> {
  const query = args.query as string;
  if (!query) return formatError("query is required");

  const params = new URLSearchParams({ q: query });
  if (args.limit) params.set("limit", String(args.limit));
  else params.set("limit", "20");

  const result = await authedRequest(baseUrl, email, password, "GET", `/api/search?${params.toString()}`);
  if (result.status !== 200) return formatError(`Failed to search (${result.status}): ${JSON.stringify(result.data)}`);
  return formatResponse({ action: "search", results: result.data });
}

async function actionListVersions(baseUrl: string, email: string, password: string, args: Record<string, unknown>): Promise<ToolResult> {
  const slug = args.slug as string;
  if (!slug) return formatError("slug is required");

  const params = new URLSearchParams();
  if (args.limit) params.set("limit", String(args.limit));
  else params.set("limit", "20");
  const qs = params.toString();

  const result = await authedRequest(baseUrl, email, password, "GET", `/api/docs/${slug}/versions?${qs}`);
  if (result.status !== 200) return formatError(`Failed to list versions (${result.status}): ${JSON.stringify(result.data)}`);
  return formatResponse({ action: "list_versions", versions: result.data });
}

async function actionListTags(baseUrl: string, email: string, password: string): Promise<ToolResult> {
  const result = await authedRequest(baseUrl, email, password, "GET", "/api/tags");
  if (result.status !== 200) return formatError(`Failed to list tags (${result.status}): ${JSON.stringify(result.data)}`);
  return formatResponse({ action: "list_tags", tags: result.data });
}

async function actionCreateTag(baseUrl: string, email: string, password: string, args: Record<string, unknown>): Promise<ToolResult> {
  const name = args.name as string;
  if (!name) return formatError("name is required");

  const body: Record<string, unknown> = { name };
  if (args.color) body.color = args.color;

  const result = await authedRequest(baseUrl, email, password, "POST", "/api/tags", body);
  if (result.status !== 201 && result.status !== 200) {
    return formatError(`Failed to create tag (${result.status}): ${JSON.stringify(result.data)}`);
  }
  return formatResponse({ action: "create_tag", tag: result.data });
}

async function actionTagDoc(baseUrl: string, email: string, password: string, args: Record<string, unknown>): Promise<ToolResult> {
  const slug = args.slug as string;
  if (!slug) return formatError("slug is required");
  const tagIds = args.tag_ids as string[];
  if (!tagIds || !Array.isArray(tagIds)) return formatError("tag_ids (string array) is required");

  const result = await authedRequest(baseUrl, email, password, "PUT", `/api/docs/${slug}/tags`, { tagIds });
  if (result.status !== 200) return formatError(`Failed to tag doc (${result.status}): ${JSON.stringify(result.data)}`);
  return formatResponse({ action: "tag_doc", slug, tagIds });
}

async function actionListFolders(baseUrl: string, email: string, password: string): Promise<ToolResult> {
  const result = await authedRequest(baseUrl, email, password, "GET", "/api/folders");
  if (result.status !== 200) return formatError(`Failed to list folders (${result.status}): ${JSON.stringify(result.data)}`);
  return formatResponse({ action: "list_folders", folders: result.data });
}

async function actionCreateFolder(baseUrl: string, email: string, password: string, args: Record<string, unknown>): Promise<ToolResult> {
  const name = args.name as string;
  if (!name) return formatError("name is required");

  const body: Record<string, unknown> = { name };
  if (args.parent_id) body.parentId = args.parent_id;

  const result = await authedRequest(baseUrl, email, password, "POST", "/api/folders", body);
  if (result.status !== 201 && result.status !== 200) {
    return formatError(`Failed to create folder (${result.status}): ${JSON.stringify(result.data)}`);
  }
  return formatResponse({ action: "create_folder", folder: result.data });
}

async function actionMoveDoc(baseUrl: string, email: string, password: string, args: Record<string, unknown>): Promise<ToolResult> {
  const slug = args.slug as string;
  if (!slug) return formatError("slug is required");
  const folderId = args.folder_id as string;
  if (!folderId) return formatError("folder_id is required");

  const result = await authedRequest(baseUrl, email, password, "PUT", `/api/docs/${slug}/folder`, { folderId });
  if (result.status !== 200) return formatError(`Failed to move doc (${result.status}): ${JSON.stringify(result.data)}`);
  return formatResponse({ action: "move_doc", slug, folderId });
}

// ── Execute Dispatcher ────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const action = args.action as Action | undefined;
  if (!action) return formatError(`action is required. Available: ${ACTIONS.join(", ")}`);
  if (!ACTIONS.includes(action)) return formatError(`Unknown action: ${action}. Available: ${ACTIONS.join(", ")}`);

  const config = (ctx.config.integrations as any)?.noted ?? {};
  const baseUrl = (config.url as string) || DEFAULT_NOTED_URL;
  const email = (config.username as string) || "";
  const password = process.env[config.password_env || "NOTED_PASSWORD"] || "";

  try {
    if (!email || !password) {
      return formatError("Noted credentials required. Set integrations.noted.username and password_env in config.");
    }

    switch (action) {
      case "list_docs":       return actionListDocs(baseUrl, email, password, args);
      case "get_doc":         return actionGetDoc(baseUrl, email, password, args);
      case "create_doc":      return actionCreateDoc(baseUrl, email, password, args);
      case "save_doc":        return actionSaveDoc(baseUrl, email, password, args);
      case "delete_doc":      return actionDeleteDoc(baseUrl, email, password, args);
      case "search":          return actionSearch(baseUrl, email, password, args);
      case "list_versions":   return actionListVersions(baseUrl, email, password, args);
      case "list_tags":       return actionListTags(baseUrl, email, password);
      case "create_tag":      return actionCreateTag(baseUrl, email, password, args);
      case "tag_doc":         return actionTagDoc(baseUrl, email, password, args);
      case "list_folders":    return actionListFolders(baseUrl, email, password);
      case "create_folder":   return actionCreateFolder(baseUrl, email, password, args);
      case "move_doc":        return actionMoveDoc(baseUrl, email, password, args);
      default:                return formatError(`Unhandled action: ${action}`);
    }
  } catch (err) {
    return formatError(`Noted API error: ${(err as Error).message}`);
  }
}

// ── Tool Definition ───────────────────────────────────────

const notedTool: Tool = {
  name: "noted",
  description:
    "Manage notes, tags, and folders in the Noted app via its REST API. " +
    "Actions: list_docs, get_doc, create_doc, save_doc, delete_doc, search, " +
    "list_versions, list_tags, create_tag, tag_doc, list_folders, create_folder, move_doc.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [...ACTIONS],
        description: "Noted action to perform",
      },
      slug: { type: "string", description: "Document slug (get_doc, save_doc, delete_doc, tag_doc, move_doc, list_versions)" },
      title: { type: "string", description: "Document title (create_doc)" },
      content: { type: "string", description: "Document content (save_doc)" },
      query: { type: "string", description: "Search query (search)" },
      tag_name: { type: "string", description: "Tag name filter (list_docs)" },
      tag_ids: {
        type: "array",
        items: { type: "string" },
        description: "Tag IDs to assign (tag_doc)",
      },
      folder_id: { type: "string", description: "Folder ID (list_docs, move_doc)" },
      name: { type: "string", description: "Name for tag or folder (create_tag, create_folder)" },
      color: { type: "string", description: "Tag color hex (create_tag)" },
      parent_id: { type: "string", description: "Parent folder ID (create_folder)" },
      base_version_id: { type: "string", description: "Base version ID for concurrency (save_doc)" },
      limit: { type: "number", description: "Max results to return (search, list_versions)" },
    },
    required: ["action"],
  },
  execute,
};

export default notedTool;
