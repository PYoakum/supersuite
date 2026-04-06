import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

const REQUEST_TIMEOUT = 15_000;
const DEFAULT_URL = "http://localhost:3009";

const ACTIONS = [
  "list_contacts", "get_contact", "create_contact", "update_contact",
  "list_donations", "create_donation", "list_memberships", "create_membership", "dashboard",
] as const;
type Action = (typeof ACTIONS)[number];

let cachedSession: { cookie: string; csrf: string } | null = null;

async function fetchCsrf(url: string, cookie: string): Promise<{ csrf: string; newCookie?: string }> {
  const res = await fetch(url, {
    headers: { Cookie: cookie }, redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  const html = await res.text();
  const inputMatch = html.match(/<input[^>]*name=["']_csrf["'][^>]*value=["']([^"']+)["']/);
  if (inputMatch) return { csrf: inputMatch[1] };
  const metaMatch = html.match(/<meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/);
  if (metaMatch) return { csrf: metaMatch[1] };
  // Try reverse order (value before name)
  const revMatch = html.match(/<input[^>]*value=["']([^"']+)["'][^>]*name=["']_csrf["']/);
  if (revMatch) return { csrf: revMatch[1] };
  throw new Error("CSRF token not found in page");
}

async function formPost(url: string, cookie: string, params: Record<string, string>) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: new URLSearchParams(params).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
}

async function ensureSession(baseUrl: string, username: string, password: string): Promise<{ cookie: string; csrf: string }> {
  if (cachedSession) return cachedSession;

  // Get login page for CSRF
  const loginPage = await fetch(`${baseUrl}/login`, { redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
  const loginHtml = await loginPage.text();
  const csrfMatch = loginHtml.match(/<input[^>]*name=["']_csrf["'][^>]*value=["']([^"']+)["']/)
    || loginHtml.match(/<input[^>]*value=["']([^"']+)["'][^>]*name=["']_csrf["']/);
  const csrf = csrfMatch?.[1] || "";
  const initCookie = loginPage.headers.get("set-cookie")?.split(";")[0] || "";

  // Login
  const loginRes = await formPost(`${baseUrl}/login`, initCookie, { username, password, _csrf: csrf });
  const sessionCookie = loginRes.headers.get("set-cookie")?.split(";")[0] || initCookie;

  // Get a fresh CSRF from dashboard
  const { csrf: freshCsrf } = await fetchCsrf(`${baseUrl}/dashboard`, sessionCookie);

  cachedSession = { cookie: sessionCookie, csrf: freshCsrf };
  return cachedSession;
}

async function getHtml(baseUrl: string, path: string, cookie: string): Promise<string> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Cookie: cookie }, redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (res.status === 302 || res.status === 301) {
    cachedSession = null;
    throw new Error("Session expired — retry after re-login");
  }
  return res.text();
}

function parseTableRows(html: string, pattern: RegExp): string[][] {
  const rows: string[][] = [];
  let match;
  while ((match = pattern.exec(html)) !== null) {
    rows.push(match.slice(1));
  }
  return rows;
}

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const integ = (ctx.config.integrations as any)?.yolodex || {};
  const baseUrl = integ.url || DEFAULT_URL;
  const action = args.action as Action | undefined;
  if (!action || !ACTIONS.includes(action)) return formatError(`Unknown action: ${action}. Available: ${ACTIONS.join(", ")}`);

  const username = integ.username || "";
  const pwdEnv = integ.password_env || "YOLODEX_PASSWORD";
  const password = process.env[pwdEnv] || "";

  try {
    const session = await ensureSession(baseUrl, username, password);

    switch (action) {
      case "list_contacts": {
        const html = await getHtml(baseUrl, "/contacts", session.cookie);
        const contacts = parseTableRows(html, /<a[^>]*href=["']\/contacts\/([^"']+)["'][^>]*>([^<]*)<\/a>/g);
        return formatResponse({ count: contacts.length, contacts: contacts.map(([id, name]) => ({ id, name })) });
      }
      case "get_contact": {
        const html = await getHtml(baseUrl, `/contacts/${args.contact_id}`, session.cookie);
        return formatResponse({ id: args.contact_id, html_excerpt: html.slice(0, 2000) });
      }
      case "create_contact": {
        const { csrf } = await fetchCsrf(`${baseUrl}/contacts/new`, session.cookie);
        const params: Record<string, string> = { _csrf: csrf };
        for (const k of ["first_name", "last_name", "email", "phone", "address"]) {
          if ((args as any)[k]) params[k] = String((args as any)[k]);
        }
        const res = await formPost(`${baseUrl}/contacts`, session.cookie, params);
        return formatResponse({ created: res.status === 302 || res.status === 201, redirect: res.headers.get("location") });
      }
      case "update_contact": {
        const { csrf } = await fetchCsrf(`${baseUrl}/contacts/${args.contact_id}/edit`, session.cookie);
        const params: Record<string, string> = { _csrf: csrf };
        for (const k of ["first_name", "last_name", "email", "phone", "address"]) {
          if ((args as any)[k]) params[k] = String((args as any)[k]);
        }
        const res = await formPost(`${baseUrl}/contacts/${args.contact_id}`, session.cookie, params);
        return formatResponse({ updated: res.status === 302 || res.status === 200 });
      }
      case "list_donations": {
        const html = await getHtml(baseUrl, "/donations", session.cookie);
        return formatResponse({ html_excerpt: html.slice(0, 3000) });
      }
      case "create_donation": {
        const { csrf } = await fetchCsrf(`${baseUrl}/donations/new`, session.cookie);
        const params: Record<string, string> = { _csrf: csrf, contact_id: String(args.contact_id), amount: String(args.amount), date: String(args.date) };
        if (args.method) params.method = String(args.method);
        if (args.notes) params.notes = String(args.notes);
        const res = await formPost(`${baseUrl}/donations`, session.cookie, params);
        return formatResponse({ created: res.status === 302 || res.status === 201 });
      }
      case "list_memberships": {
        const html = await getHtml(baseUrl, "/memberships", session.cookie);
        return formatResponse({ html_excerpt: html.slice(0, 3000) });
      }
      case "create_membership": {
        const { csrf } = await fetchCsrf(`${baseUrl}/memberships/new`, session.cookie);
        const params: Record<string, string> = {
          _csrf: csrf, contact_id: String(args.contact_id),
          type: String(args.membership_type), start_date: String(args.start_date),
        };
        if (args.end_date) params.end_date = String(args.end_date);
        const res = await formPost(`${baseUrl}/memberships`, session.cookie, params);
        return formatResponse({ created: res.status === 302 || res.status === 201 });
      }
      case "dashboard": {
        const html = await getHtml(baseUrl, "/dashboard", session.cookie);
        return formatResponse({ html_excerpt: html.slice(0, 3000) });
      }
    }
    return formatError("Unhandled action");
  } catch (err: any) {
    if (err.message.includes("Session expired")) {
      cachedSession = null;
    }
    return formatError(err.message);
  }
}

const tool: Tool = {
  name: "yolodex",
  description: "Nonprofit CRM. Manage contacts, donations, memberships. View dashboard stats.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: [...ACTIONS], description: "Action to perform" },
      contact_id: { type: "string" }, first_name: { type: "string" }, last_name: { type: "string" },
      email: { type: "string" }, phone: { type: "string" }, address: { type: "string" },
      amount: { type: "number" }, date: { type: "string", description: "YYYY-MM-DD" },
      method: { type: "string" }, notes: { type: "string" },
      membership_type: { type: "string" }, start_date: { type: "string" }, end_date: { type: "string" },
    },
    required: ["action"],
  },
  execute,
};

export default tool;
