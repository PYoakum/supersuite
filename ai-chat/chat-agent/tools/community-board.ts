import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ──────────────────────────────────────────────

const REQUEST_TIMEOUT = 15_000;
const DEFAULT_BOARD_URL = "http://localhost:3003";

const ACTIONS = [
  "list_categories",
  "list_threads",
  "get_thread",
  "create_thread",
  "reply",
  "send_message",
] as const;

type Action = (typeof ACTIONS)[number];

// ── Session Cache ──────────────────────────────────────────

let cachedSession: { cookie: string; csrf: string } | null = null;

// ── Helpers ────────────────────────────────────────────────

async function fetchCsrf(url: string, cookie: string): Promise<{ csrf: string; newCookie?: string }> {
  const res = await fetch(url, {
    headers: { Cookie: cookie },
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  const setCookie = res.headers.get("set-cookie");
  const html = await res.text();
  // Try hidden input first
  const inputMatch = html.match(/<input[^>]*name="_csrf"[^>]*value="([^"]+)"/);
  if (inputMatch) return { csrf: inputMatch[1], newCookie: setCookie ?? undefined };
  // Try meta tag
  const metaMatch = html.match(/<meta[^>]*name="csrf-token"[^>]*content="([^"]+)"/);
  if (metaMatch) return { csrf: metaMatch[1], newCookie: setCookie ?? undefined };
  throw new Error("CSRF token not found in page");
}

async function boardFormPost(url: string, cookie: string, params: Record<string, string>) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
    },
    body: new URLSearchParams(params).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
}

async function ensureSession(
  baseUrl: string,
  username: string,
  password: string
): Promise<{ cookie: string; csrf: string }> {
  if (cachedSession) return cachedSession;

  const loginUrl = `${baseUrl}/login`;

  // GET /login to obtain initial CSRF token and session cookie
  const initial = await fetch(loginUrl, {
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  const initialCookie = initial.headers.get("set-cookie") ?? "";
  const initialHtml = await initial.text();

  let csrf = "";
  const inputMatch = initialHtml.match(/<input[^>]*name="_csrf"[^>]*value="([^"]+)"/);
  if (inputMatch) {
    csrf = inputMatch[1];
  } else {
    const metaMatch = initialHtml.match(/<meta[^>]*name="csrf-token"[^>]*content="([^"]+)"/);
    if (metaMatch) csrf = metaMatch[1];
  }
  if (!csrf) throw new Error("CSRF token not found on login page");

  // POST /login with credentials
  const loginRes = await boardFormPost(loginUrl, initialCookie, {
    username,
    password,
    _csrf: csrf,
  });

  const sessionCookie = loginRes.headers.get("set-cookie") ?? initialCookie;
  if (loginRes.status >= 400) {
    throw new Error(`Login failed (${loginRes.status})`);
  }

  // Refresh CSRF from the redirect target or homepage
  const afterLogin = await fetchCsrf(baseUrl, sessionCookie);
  cachedSession = { cookie: sessionCookie, csrf: afterLogin.csrf };
  return cachedSession;
}

// ── Actions ────────────────────────────────────────────────

async function actionListCategories(baseUrl: string, session: { cookie: string }): Promise<ToolResult> {
  const res = await fetch(baseUrl, {
    headers: { Cookie: session.cookie },
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  const html = await res.text();
  const categories: { slug: string; name: string }[] = [];
  const re = /<a href="\/c\/([^"]+)"[^>]*>([^<]+)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    categories.push({ slug: m[1], name: m[2].trim() });
  }
  return formatResponse({ action: "list_categories", categories });
}

async function actionListThreads(
  baseUrl: string,
  session: { cookie: string },
  args: Record<string, unknown>
): Promise<ToolResult> {
  const slug = args.category_slug as string;
  if (!slug) return formatError("category_slug is required");

  const res = await fetch(`${baseUrl}/c/${slug}`, {
    headers: { Cookie: session.cookie },
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  const html = await res.text();

  const threads: { id: string; title: string; author: string; replies: string; lastActivity: string }[] = [];
  // Match thread rows — common BBS patterns
  const re = /<a href="\/c\/[^/]+\/t\/([^"]+)"[^>]*>([^<]+)<\/a>/g;
  const authorRe = /class="author"[^>]*>([^<]+)</g;
  const repliesRe = /class="replies"[^>]*>(\d+)/g;
  const timeRe = /<time[^>]*datetime="([^"]+)"/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const authorMatch = authorRe.exec(html);
    const repliesMatch = repliesRe.exec(html);
    const timeMatch = timeRe.exec(html);

    threads.push({
      id: m[1],
      title: m[2].trim(),
      author: authorMatch ? authorMatch[1].trim() : "unknown",
      replies: repliesMatch ? repliesMatch[1] : "0",
      lastActivity: timeMatch ? timeMatch[1] : "",
    });
  }
  return formatResponse({ action: "list_threads", category: slug, threads });
}

async function actionGetThread(
  baseUrl: string,
  session: { cookie: string },
  args: Record<string, unknown>
): Promise<ToolResult> {
  const slug = args.category_slug as string;
  const id = args.thread_id as string;
  if (!slug) return formatError("category_slug is required");
  if (!id) return formatError("thread_id is required");

  const res = await fetch(`${baseUrl}/c/${slug}/t/${id}`, {
    headers: { Cookie: session.cookie },
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  const html = await res.text();

  // Extract thread title
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const title = titleMatch ? titleMatch[1].trim() : "";

  // Extract posts
  const posts: { author: string; timestamp: string; body: string }[] = [];
  const postRe = /class="post"[^>]*>([\s\S]*?)(?=class="post"|$)/g;
  const postAuthorRe = /class="post-author"[^>]*>([^<]+)/;
  const postTimeRe = /<time[^>]*datetime="([^"]+)"/;
  const postBodyRe = /class="post-body"[^>]*>([\s\S]*?)(?=<\/div>)/;

  let pm: RegExpExecArray | null;
  while ((pm = postRe.exec(html)) !== null) {
    const block = pm[1];
    const authorMatch = block.match(postAuthorRe);
    const timeMatch = block.match(postTimeRe);
    const bodyMatch = block.match(postBodyRe);

    posts.push({
      author: authorMatch ? authorMatch[1].trim() : "unknown",
      timestamp: timeMatch ? timeMatch[1] : "",
      body: bodyMatch ? bodyMatch[1].replace(/<[^>]+>/g, "").trim() : "",
    });
  }

  return formatResponse({ action: "get_thread", category: slug, threadId: id, title, posts });
}

async function actionCreateThread(
  baseUrl: string,
  session: { cookie: string; csrf: string },
  args: Record<string, unknown>
): Promise<ToolResult> {
  const slug = args.category_slug as string;
  const title = args.title as string;
  const body = args.body as string;
  if (!slug) return formatError("category_slug is required");
  if (!title) return formatError("title is required");
  if (!body) return formatError("body is required");

  // Refresh CSRF from the new-thread form
  const { csrf } = await fetchCsrf(`${baseUrl}/c/${slug}/new`, session.cookie);

  const res = await boardFormPost(`${baseUrl}/c/${slug}/new`, session.cookie, {
    title,
    body,
    _csrf: csrf,
  });

  if (res.status >= 400) {
    const text = await res.text();
    return formatError(`Failed to create thread (${res.status}): ${text.slice(0, 500)}`);
  }

  const location = res.headers.get("location") ?? "";
  return formatResponse({ action: "create_thread", category: slug, title, redirect: location });
}

async function actionReply(
  baseUrl: string,
  session: { cookie: string; csrf: string },
  args: Record<string, unknown>
): Promise<ToolResult> {
  const slug = args.category_slug as string;
  const id = args.thread_id as string;
  const body = args.body as string;
  if (!slug) return formatError("category_slug is required");
  if (!id) return formatError("thread_id is required");
  if (!body) return formatError("body is required");

  // Refresh CSRF from the thread page
  const { csrf } = await fetchCsrf(`${baseUrl}/c/${slug}/t/${id}`, session.cookie);

  const res = await boardFormPost(`${baseUrl}/c/${slug}/t/${id}/reply`, session.cookie, {
    body,
    _csrf: csrf,
  });

  if (res.status >= 400) {
    const text = await res.text();
    return formatError(`Failed to reply (${res.status}): ${text.slice(0, 500)}`);
  }

  const location = res.headers.get("location") ?? "";
  return formatResponse({ action: "reply", category: slug, threadId: id, redirect: location });
}

async function actionSendMessage(
  baseUrl: string,
  session: { cookie: string; csrf: string },
  args: Record<string, unknown>
): Promise<ToolResult> {
  const recipient = args.recipient as string;
  const subject = args.subject as string;
  const body = args.body as string;
  if (!recipient) return formatError("recipient is required");
  if (!subject) return formatError("subject is required");
  if (!body) return formatError("body is required");

  // Refresh CSRF from the new-message form
  const { csrf } = await fetchCsrf(`${baseUrl}/messages/new`, session.cookie);

  const res = await boardFormPost(`${baseUrl}/messages/new`, session.cookie, {
    recipient,
    subject,
    body,
    _csrf: csrf,
  });

  if (res.status >= 400) {
    const text = await res.text();
    return formatError(`Failed to send message (${res.status}): ${text.slice(0, 500)}`);
  }

  return formatResponse({ action: "send_message", recipient, subject, sent: true });
}

// ── Execute Dispatcher ─────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const action = args.action as Action | undefined;
  if (!action) return formatError(`action is required. Available: ${ACTIONS.join(", ")}`);
  if (!ACTIONS.includes(action)) return formatError(`Unknown action: ${action}. Available: ${ACTIONS.join(", ")}`);

  const config = (ctx.config.integrations as any)?.community_board ?? {};
  const baseUrl = ((config.url as string) || DEFAULT_BOARD_URL).replace(/\/+$/, "");
  const username = (config.username as string) || "";
  const passwordEnv = (config.password_env as string) || "COMMUNITY_BOARD_PASSWORD";
  const password = process.env[passwordEnv] || "";

  try {
    // list_categories can work without auth (public page)
    if (action === "list_categories") {
      // Still try to use session if available for auth-gated boards
      if (cachedSession) {
        return actionListCategories(baseUrl, cachedSession);
      }
      if (username && password) {
        const session = await ensureSession(baseUrl, username, password);
        return actionListCategories(baseUrl, session);
      }
      return actionListCategories(baseUrl, { cookie: "" });
    }

    // All other actions require auth
    if (!username || !password) {
      return formatError(
        "Community board credentials required. Configure integrations.community_board.username " +
        "and password_env (or set COMMUNITY_BOARD_PASSWORD)."
      );
    }

    const session = await ensureSession(baseUrl, username, password);

    switch (action) {
      case "list_threads":   return actionListThreads(baseUrl, session, args);
      case "get_thread":     return actionGetThread(baseUrl, session, args);
      case "create_thread":  return actionCreateThread(baseUrl, session, args);
      case "reply":          return actionReply(baseUrl, session, args);
      case "send_message":   return actionSendMessage(baseUrl, session, args);
      default:               return formatError(`Unhandled action: ${action}`);
    }
  } catch (err) {
    // Clear cached session on auth errors so next call retries login
    cachedSession = null;
    return formatError(`Community board error: ${(err as Error).message}`);
  }
}

// ── Tool Definition ─────────────────────────────────────────

const communityBoardTool: Tool = {
  name: "community_board",
  description:
    "Interact with a BBS-style community board. Supports browsing categories and threads, " +
    "creating threads, replying, and sending private messages. " +
    "Actions: list_categories, list_threads, get_thread, create_thread, reply, send_message.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [...ACTIONS],
        description: "Board action to perform",
      },
      category_slug: {
        type: "string",
        description: "Category slug (list_threads, get_thread, create_thread, reply)",
      },
      thread_id: {
        type: "string",
        description: "Thread ID (get_thread, reply)",
      },
      title: {
        type: "string",
        description: "Thread title (create_thread)",
      },
      body: {
        type: "string",
        description: "Post body text (create_thread, reply, send_message)",
      },
      recipient: {
        type: "string",
        description: "Username of message recipient (send_message)",
      },
      subject: {
        type: "string",
        description: "Message subject line (send_message)",
      },
    },
    required: ["action"],
  },
  execute,
};

export default communityBoardTool;
