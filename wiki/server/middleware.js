function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) cookies[key.trim()] = rest.join("=").trim();
  }
  return cookies;
}

async function deriveToken(password, salt) {
  const data = new TextEncoder().encode(password + ":" + salt);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(buf).toString("hex");
}

export async function resolveSession(req, config) {
  // If no password set, editing is open to everyone
  if (!config.auth.edit_password) return true;

  const cookieName = config.auth.cookie_name;
  const cookieHeader = req.headers.get("cookie");
  const cookies = parseCookies(cookieHeader);
  const token = cookies[cookieName];
  if (!token) return false;

  const expected = await deriveToken(config.auth.edit_password, config.auth.salt);
  return token === expected;
}

export async function createSessionToken(config) {
  return deriveToken(config.auth.edit_password, config.auth.salt);
}

export function sessionCookie(config, token, maxAge) {
  const parts = [
    `${config.auth.cookie_name}=${token}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${maxAge}`,
  ];
  return parts.join("; ");
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

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function requireAuth(loggedIn, returnTo) {
  if (!loggedIn) {
    return redirect(`/login?return=${encodeURIComponent(returnTo)}`);
  }
  return null;
}
