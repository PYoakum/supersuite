import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ──────────────────────────────────────────────

const REQUEST_TIMEOUT = 15_000;
const DEFAULT_WIKI_URL = "http://localhost:3002";

const ACTIONS = [
  "get_page",
  "create_page",
  "edit_page",
  "search",
  "list_pages",
] as const;

type Action = (typeof ACTIONS)[number];

// ── Session Cache ─────────────────────────────────────────

let cachedSession: { cookie: string } | null = null;

// ── Helpers ───────────────────────────────────────────────

async function wikiLogin(baseUrl: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password }).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error(`Login failed: ${res.status}`);
  cachedSession = { cookie };
  return cookie;
}

async function wikiFormPost(
  url: string,
  cookie: string,
  params: Record<string, string>
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": cookie,
    },
    body: new URLSearchParams(params).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
}

async function wikiGet(
  url: string,
  cookie: string
): Promise<{ status: number; html: string }> {
  const resp = await fetch(url, {
    method: "GET",
    headers: { "Cookie": cookie },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  const html = await resp.text();
  return { status: resp.status, html };
}

async function ensureCookie(baseUrl: string, password: string): Promise<string> {
  if (cachedSession) return cachedSession.cookie;
  return wikiLogin(baseUrl, password);
}

async function authedGet(
  baseUrl: string,
  password: string,
  path: string
): Promise<{ status: number; html: string }> {
  let cookie = await ensureCookie(baseUrl, password);
  const url = `${baseUrl.replace(/\/+$/, "")}${path}`;
  let result = await wikiGet(url, cookie);

  // Re-login on 401 or redirect to login
  if (result.status === 401 || result.status === 302) {
    cachedSession = null;
    cookie = await wikiLogin(baseUrl, password);
    result = await wikiGet(url, cookie);
  }

  return result;
}

async function authedPost(
  baseUrl: string,
  password: string,
  path: string,
  params: Record<string, string>
): Promise<{ status: number; html: string }> {
  let cookie = await ensureCookie(baseUrl, password);
  const url = `${baseUrl.replace(/\/+$/, "")}${path}`;
  let resp = await wikiFormPost(url, cookie, params);

  // Re-login on 401 or redirect to login
  if (resp.status === 401 || resp.status === 302) {
    cachedSession = null;
    cookie = await wikiLogin(baseUrl, password);
    resp = await wikiFormPost(url, cookie, params);
  }

  const html = await resp.text();
  return { status: resp.status, html };
}

// ── HTML Parsing ──────────────────────────────────────────

function parseTextareaContent(html: string): string | null {
  const match = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/);
  return match ? match[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"') : null;
}

function parseSearchResults(html: string): Array<{ slug: string; title: string }> {
  const results: Array<{ slug: string; title: string }> = [];
  const regex = /<a href="\/wiki\/([^"]+)"[^>]*>([^<]+)<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    results.push({ slug: match[1], title: match[2] });
  }
  return results;
}

function parsePageList(html: string): Array<{ slug: string; title: string }> {
  const pages: Array<{ slug: string; title: string }> = [];
  const regex = /<a href="\/wiki\/([^"]+)"[^>]*>([^<]+)<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    pages.push({ slug: match[1], title: match[2] });
  }
  return pages;
}

// ── Actions ───────────────────────────────────────────────

async function actionGetPage(baseUrl: string, password: string, args: Record<string, unknown>): Promise<ToolResult> {
  const slug = args.slug as string;
  if (!slug) return formatError("slug is required");

  const result = await authedGet(baseUrl, password, `/wiki/${slug}/edit`);
  if (result.status !== 200) return formatError(`Failed to get page (${result.status})`);

  const content = parseTextareaContent(result.html);
  if (content === null) return formatError("Could not parse page content from response");
  return formatResponse({ action: "get_page", slug, content });
}

async function actionCreatePage(baseUrl: string, password: string, args: Record<string, unknown>): Promise<ToolResult> {
  const title = args.title as string;
  if (!title) return formatError("title is required");
  const body = args.body as string;
  if (body === undefined) return formatError("body is required");

  const result = await authedPost(baseUrl, password, "/new", { title, body });
  // A redirect (301/302) typically means success for form submissions
  if (result.status !== 200 && result.status !== 301 && result.status !== 302) {
    return formatError(`Failed to create page (${result.status})`);
  }
  return formatResponse({ action: "create_page", title, created: true });
}

async function actionEditPage(baseUrl: string, password: string, args: Record<string, unknown>): Promise<ToolResult> {
  const slug = args.slug as string;
  if (!slug) return formatError("slug is required");
  const body = args.body as string;
  if (body === undefined) return formatError("body is required");

  const result = await authedPost(baseUrl, password, `/wiki/${slug}/edit`, { body });
  if (result.status !== 200 && result.status !== 301 && result.status !== 302) {
    return formatError(`Failed to edit page (${result.status})`);
  }
  return formatResponse({ action: "edit_page", slug, updated: true });
}

async function actionSearch(baseUrl: string, password: string, args: Record<string, unknown>): Promise<ToolResult> {
  const query = args.query as string;
  if (!query) return formatError("query is required");

  const params = new URLSearchParams({ q: query });
  const result = await authedGet(baseUrl, password, `/search?${params.toString()}`);
  if (result.status !== 200) return formatError(`Failed to search (${result.status})`);

  const results = parseSearchResults(result.html);
  return formatResponse({ action: "search", query, results });
}

async function actionListPages(baseUrl: string, password: string): Promise<ToolResult> {
  const result = await authedGet(baseUrl, password, "/pages");
  if (result.status !== 200) return formatError(`Failed to list pages (${result.status})`);

  const pages = parsePageList(result.html);
  return formatResponse({ action: "list_pages", pages });
}

// ── Execute Dispatcher ────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const action = args.action as Action | undefined;
  if (!action) return formatError(`action is required. Available: ${ACTIONS.join(", ")}`);
  if (!ACTIONS.includes(action)) return formatError(`Unknown action: ${action}. Available: ${ACTIONS.join(", ")}`);

  const config = (ctx.config.integrations as any)?.wiki ?? {};
  const baseUrl = (config.url as string) || DEFAULT_WIKI_URL;
  const password = process.env[config.password_env || "WIKI_PASSWORD"] || "";

  try {
    if (!password) {
      return formatError("Wiki password required. Set the env var referenced by integrations.wiki.password_env in config (default: WIKI_PASSWORD).");
    }

    switch (action) {
      case "get_page":    return actionGetPage(baseUrl, password, args);
      case "create_page": return actionCreatePage(baseUrl, password, args);
      case "edit_page":   return actionEditPage(baseUrl, password, args);
      case "search":      return actionSearch(baseUrl, password, args);
      case "list_pages":  return actionListPages(baseUrl, password);
      default:            return formatError(`Unhandled action: ${action}`);
    }
  } catch (err) {
    return formatError(`Wiki error: ${(err as Error).message}`);
  }
}

// ── Tool Definition ───────────────────────────────────────

const wikiTool: Tool = {
  name: "wiki",
  description:
    "Read and edit pages in the flat-file wiki via its HTML form-based interface. " +
    "Actions: get_page, create_page, edit_page, search, list_pages.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [...ACTIONS],
        description: "Wiki action to perform",
      },
      slug: { type: "string", description: "Page slug (get_page, edit_page)" },
      title: { type: "string", description: "Page title (create_page)" },
      body: { type: "string", description: "Markdown content (create_page, edit_page)" },
      query: { type: "string", description: "Search query (search)" },
    },
    required: ["action"],
  },
  execute,
};

export default wikiTool;
