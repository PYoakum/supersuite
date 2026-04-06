import { verifyToken } from "../lib/auth.js";

export async function authenticateRequest(req, config, sql) {
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;

  const token = header.slice(7);
  try {
    const payload = await verifyToken(token, config.auth.jwt_secret);
    return payload;
  } catch {
    return null;
  }
}

export function requireAuth(user) {
  if (!user) {
    const err = new Error("Unauthorized");
    err.status = 401;
    err.expose = true;
    throw err;
  }
  return user;
}
