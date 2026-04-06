import { json, parseBody, HttpError, setCookie } from '../http.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { createSession, destroySession } from '../auth/sessions.js';
import { findUserByEmail, createUser, updateUser } from '../db/users.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit, getClientIp } from '../middleware/ratelimit.js';

/**
 * Register all auth routes on the router.
 * @param {import('../router.js').Router} router
 */
export function registerAuthRoutes(router) {

  // ─── POST /api/auth/signup ──────────────────────────────────────
  router.post('/api/auth/signup', async (req, res, config) => {
    rateLimit(`signup:${getClientIp(req)}`, 5, HttpError);

    if (!config.features.open_registration) {
      throw new HttpError(403, 'Registration is disabled');
    }

    const body = await parseBody(req);
    const { email, password, displayName } = body;

    // Validate inputs
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new HttpError(400, 'Valid email is required');
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      throw new HttpError(400, 'Password must be at least 8 characters');
    }

    // Check for existing user
    const existing = await findUserByEmail(email);
    if (existing) {
      throw new HttpError(409, 'Email already registered');
    }

    // Create user
    const passwordHash = await hashPassword(password);
    const user = await createUser({ email, passwordHash, displayName });

    // Auto-login: create session
    const { token } = await createSession(user.id, {
      maxAgeSeconds: config.auth.session_max_age,
      userAgent: req.headers['user-agent'],
      ip: req.socket.remoteAddress,
    });

    setSessionCookie(res, config, token);

    json(res, 201, {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role_default,
      },
    });
  });

  // ─── POST /api/auth/login ───────────────────────────────────────
  router.post('/api/auth/login', async (req, res, config) => {
    rateLimit(`login:${getClientIp(req)}`, 10, HttpError);

    const body = await parseBody(req);
    const { email, password } = body;

    if (!email || !password) {
      throw new HttpError(400, 'Email and password are required');
    }

    const user = await findUserByEmail(email);
    if (!user) {
      throw new HttpError(401, 'Invalid email or password');
    }

    const valid = await verifyPassword(user.password_hash, password);
    if (!valid) {
      throw new HttpError(401, 'Invalid email or password');
    }

    const { token } = await createSession(user.id, {
      maxAgeSeconds: config.auth.session_max_age,
      userAgent: req.headers['user-agent'],
      ip: req.socket.remoteAddress,
    });

    setSessionCookie(res, config, token);

    json(res, 200, {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role_default,
      },
    });
  });

  // ─── POST /api/auth/logout ──────────────────────────────────────
  router.post('/api/auth/logout', async (req, res, config) => {
    const token = req.cookies?.[config.auth.cookie_name];
    if (token) {
      await destroySession(token);
    }

    // Clear cookie
    setCookie(res, config.auth.cookie_name, '', {
      maxAge: 0,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    });

    json(res, 200, { ok: true });
  });

  // ─── GET /api/me ────────────────────────────────────────────────
  router.get('/api/me', async (req, res, config) => {
    requireAuth(req);

    json(res, 200, {
      user: {
        id: req.user.id,
        email: req.user.email,
        displayName: req.user.displayName,
        role: req.user.role,
      },
    });
  });

  // ─── PUT /api/me ────────────────────────────────────────────────
  router.put('/api/me', async (req, res, config) => {
    requireAuth(req);

    const body = await parseBody(req);
    const { displayName } = body;

    if (displayName !== undefined && (typeof displayName !== 'string' || displayName.length > 100)) {
      throw new HttpError(400, 'Display name must be a string under 100 characters');
    }

    const user = await updateUser(req.user.id, { displayName });

    json(res, 200, {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role_default,
      },
    });
  });
}

/**
 * Set the session cookie on a response.
 */
function setSessionCookie(res, config, token) {
  setCookie(res, config.auth.cookie_name, token, {
    maxAge: config.auth.session_max_age,
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  });
}
