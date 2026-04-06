import sql from "../lib/db.js";
import { parseCookies, setCookie, clearCookie, sign, unsign, generateCsrfToken } from "../lib/request.js";

const SESSION_COOKIE = "sid";

/**
 * Session middleware: attaches ctx.state.user and ctx.state.csrfToken.
 * Sessions are stored as signed account IDs in cookies.
 */
export async function sessionMiddleware(ctx) {
  const cookies = parseCookies(ctx.req);
  const signed = cookies[SESSION_COOKIE];

  ctx.state.user = null;
  ctx.state.csrfToken = cookies._csrf || generateCsrfToken();

  if (signed) {
    const accountId = await unsign(signed);
    if (accountId) {
      const rows = await sql`
        SELECT id, email, role, is_active FROM accounts WHERE id = ${accountId} AND is_active = true
      `;
      if (rows.length > 0) {
        ctx.state.user = rows[0];
      }
    }
  }

  return undefined; // continue to next middleware/handler
}

/** Create a session for a user (after login) */
export async function createSession(accountId) {
  const signedId = await sign(String(accountId));
  return setCookie(SESSION_COOKIE, signedId, { maxAge: 86400 * 7 });
}

/** Destroy session */
export function destroySession() {
  return clearCookie(SESSION_COOKIE);
}

/** Require authentication middleware */
export function requireAuth(ctx) {
  if (!ctx.state.user) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/login" },
    });
  }
  return undefined;
}

/** Require specific role(s) */
export function requireRole(...roles) {
  return (ctx) => {
    if (!ctx.state.user) {
      return new Response(null, { status: 302, headers: { Location: "/login" } });
    }
    if (!roles.includes(ctx.state.user.role)) {
      return new Response("Forbidden", { status: 403 });
    }
    return undefined;
  };
}

/** CSRF validation middleware for state-changing requests */
export function csrfProtection(ctx) {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(ctx.method)) {
    // Check body or header for CSRF token
    const bodyToken = ctx.state.body?._csrf;
    const headerToken = ctx.req.headers.get("x-csrf-token");
    const token = bodyToken || headerToken;
    const expected = parseCookies(ctx.req)._csrf || ctx.state.csrfToken;

    if (!token || token !== expected) {
      return new Response("CSRF token mismatch", { status: 403 });
    }
  }
  return undefined;
}
