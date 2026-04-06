import { validateSession } from '../auth/sessions.js';
import { HttpError } from '../http.js';

/**
 * Attach the authenticated user to the request (if any).
 * Does NOT reject unauthenticated requests — use requireAuth() for that.
 *
 * @param {import('http').IncomingMessage} req
 * @param {object} config
 */
export async function loadUser(req, config) {
  req.user = null;
  const cookieName = config.auth.cookie_name;
  const token = req.cookies?.[cookieName];

  if (!token) return;

  try {
    const user = await validateSession(token);
    if (user) {
      req.user = user;
    }
  } catch {
    // DB error — treat as unauthenticated
  }
}

/**
 * Require an authenticated user on the request.
 * Throws 401 if not authenticated.
 *
 * @param {import('http').IncomingMessage} req
 */
export function requireAuth(req) {
  if (!req.user) {
    throw new HttpError(401, 'Authentication required');
  }
}

/**
 * Require the user to have a specific role.
 * Throws 403 if role doesn't match.
 *
 * @param {import('http').IncomingMessage} req
 * @param {string} role
 */
export function requireRole(req, role) {
  requireAuth(req);
  if (req.user.role !== role) {
    throw new HttpError(403, 'Insufficient permissions');
  }
}
