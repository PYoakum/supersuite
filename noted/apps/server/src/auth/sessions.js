import { randomBytes, createHash } from 'node:crypto';
import { getDb } from '../db/connection.js';

/**
 * Generate a cryptographically random session token.
 * Returns both the raw token (sent to client) and its SHA-256 hash (stored in DB).
 * @returns {{ token: string, tokenHash: string }}
 */
function generateToken() {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

/**
 * Create a new session for a user.
 * @param {string} userId
 * @param {object} opts
 * @param {number} opts.maxAgeSeconds - session lifetime
 * @param {string} [opts.userAgent]
 * @param {string} [opts.ip]
 * @returns {Promise<{ token: string, session: object }>}
 */
export async function createSession(userId, opts) {
  const sql = getDb();
  const { token, tokenHash } = generateToken();

  const expiresAt = new Date(Date.now() + opts.maxAgeSeconds * 1000);

  const [session] = await sql`
    INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip)
    VALUES (${userId}, ${tokenHash}, ${expiresAt}, ${opts.userAgent || null}, ${opts.ip || null})
    RETURNING id, user_id, created_at, expires_at
  `;

  return { token, session };
}

/**
 * Validate a session token and return the associated user.
 * Updates last_seen_at on valid sessions.
 * @param {string} token - raw token from cookie
 * @returns {Promise<object|null>} user row or null if invalid/expired
 */
export async function validateSession(token) {
  if (!token) return null;

  const sql = getDb();
  const tokenHash = createHash('sha256').update(token).digest('hex');

  const rows = await sql`
    SELECT
      s.id AS session_id,
      s.expires_at,
      u.id,
      u.email,
      u.display_name,
      u.role_default
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash}
      AND s.expires_at > now()
    LIMIT 1
  `;

  if (rows.length === 0) return null;

  const row = rows[0];

  // Update last_seen_at (fire and forget)
  sql`
    UPDATE sessions SET last_seen_at = now() WHERE id = ${row.session_id}
  `.catch(() => {});

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role_default,
    sessionId: row.session_id,
  };
}

/**
 * Destroy a session by its raw token.
 * @param {string} token
 */
export async function destroySession(token) {
  if (!token) return;
  const sql = getDb();
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
}

/**
 * Destroy all sessions for a user.
 * @param {string} userId
 */
export async function destroyAllSessions(userId) {
  const sql = getDb();
  await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
}

/**
 * Clean up expired sessions (maintenance).
 * @returns {Promise<number>} number of deleted rows
 */
export async function cleanExpiredSessions() {
  const sql = getDb();
  const result = await sql`
    DELETE FROM sessions WHERE expires_at < now()
  `;
  return result.count;
}
