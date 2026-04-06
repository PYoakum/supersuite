import { findSessionByTokenHash } from "../db/sessions.js";

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) cookies[key.trim()] = rest.join("=").trim();
  }
  return cookies;
}

async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(buf).toString("hex");
}

export async function resolveSession(req, config, sql) {
  const cookieName = config.session.cookie_name;
  const cookieHeader = req.headers.get("cookie");
  const cookies = parseCookies(cookieHeader);
  const token = cookies[cookieName];
  if (!token) return null;

  const tokenHash = await hashToken(token);
  const result = await findSessionByTokenHash(sql, tokenHash);
  if (!result) return null;

  // Attach raw token for CSRF derivation
  result.user._sessionToken = token;
  return result.user;
}

export async function csrfProtect(req, user) {
  if (!user) return null; // No session means no CSRF to check (login/register handle separately)

  let body;
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    body = await req.clone().formData();
  } else {
    return "Unsupported content type";
  }

  const csrfToken = body.get("_csrf");
  if (!csrfToken) return "Missing CSRF token";

  const expected = await deriveCsrfToken(user._sessionToken);
  if (csrfToken !== expected) return "Invalid CSRF token";
  return null;
}

export async function deriveCsrfToken(sessionToken) {
  const data = new TextEncoder().encode(sessionToken + ":csrf-salt");
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(buf).toString("hex");
}

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export function validateImages(files, config) {
  const maxImages = config.uploads?.max_images_per_post ?? 5;
  const maxSize = (config.uploads?.max_file_size_mb ?? 5) * 1024 * 1024;

  if (files.length > maxImages) {
    return `Too many images. Maximum ${maxImages} allowed.`;
  }
  for (const f of files) {
    if (!ALLOWED_MIME_TYPES.has(f.type)) {
      return `File "${f.name}" has unsupported type. Allowed: JPEG, PNG, GIF, WebP.`;
    }
    if (f.size > maxSize) {
      return `File "${f.name}" exceeds the ${config.uploads?.max_file_size_mb ?? 5}MB limit.`;
    }
  }
  return null;
}

export function redirect(location, headers = {}) {
  return new Response(null, {
    status: 302,
    headers: { Location: location, ...headers },
  });
}

export function html(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...extraHeaders },
  });
}

export function layoutExtras(ctx) {
  return { csrfToken: ctx.csrfToken, bannerHtml: ctx.bannerHtml, unreadCount: ctx.unreadCount };
}

export function sessionCookie(config, token, maxAge) {
  const parts = [
    `${config.session.cookie_name}=${token}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=${config.session.same_site}`,
    `Max-Age=${maxAge}`,
  ];
  if (config.session.secure) parts.push("Secure");
  return parts.join("; ");
}
