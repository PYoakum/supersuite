import { config } from "./config.js";

const encoder = new TextEncoder();

/** Parse request body based on content type */
export async function parseBody(req) {
  const ct = req.headers.get("content-type") || "";

  if (ct.includes("application/json")) {
    try {
      return await req.json();
    } catch {
      return {};
    }
  }

  if (ct.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    const body = {};
    for (const [key, value] of params) {
      // Handle multiple values for same key
      if (body[key] !== undefined) {
        if (Array.isArray(body[key])) {
          body[key].push(value);
        } else {
          body[key] = [body[key], value];
        }
      } else {
        body[key] = value;
      }
    }
    return body;
  }

  return {};
}

/** Parse cookies from request */
export function parseCookies(req) {
  const header = req.headers.get("cookie") || "";
  const cookies = {};
  for (const pair of header.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name) {
      cookies[name.trim()] = decodeURIComponent(rest.join("=").trim());
    }
  }
  return cookies;
}

/** Set cookie header value */
export function setCookie(name, value, options = {}) {
  const {
    httpOnly = true,
    secure = !config.isDev,
    sameSite = "Lax",
    path = "/",
    maxAge = 86400 * 7, // 7 days default
  } = options;

  let cookie = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (httpOnly) cookie += "; HttpOnly";
  if (secure) cookie += "; Secure";
  if (maxAge) cookie += `; Max-Age=${maxAge}`;
  return cookie;
}

/** Clear cookie */
export function clearCookie(name, path = "/") {
  return `${name}=; Path=${path}; Max-Age=0`;
}

/** Simple HMAC signing for session data */
export async function sign(value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(config.appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  const sigHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${value}.${sigHex}`;
}

/** Verify signed value */
export async function unsign(signed) {
  if (!signed || !signed.includes(".")) return null;
  const lastDot = signed.lastIndexOf(".");
  const value = signed.substring(0, lastDot);
  const expected = await sign(value);
  if (expected === signed) return value;
  return null;
}

/** Generate a CSRF token */
export function generateCsrfToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
