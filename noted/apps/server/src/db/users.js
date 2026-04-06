import { getDb } from '../db/connection.js';

/**
 * Find a user by email.
 * @param {string} email
 * @returns {Promise<object|null>}
 */
export async function findUserByEmail(email) {
  const sql = getDb();
  const rows = await sql`
    SELECT id, email, password_hash, display_name, role_default, created_at, updated_at
    FROM users
    WHERE email = ${email.toLowerCase().trim()}
    LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Find a user by ID.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function findUserById(id) {
  const sql = getDb();
  const rows = await sql`
    SELECT id, email, display_name, role_default, created_at, updated_at
    FROM users
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Create a new user.
 * @param {object} data
 * @param {string} data.email
 * @param {string} data.passwordHash
 * @param {string} [data.displayName]
 * @returns {Promise<object>} created user (without password_hash)
 */
export async function createUser(data) {
  const sql = getDb();
  const email = data.email.toLowerCase().trim();
  const displayName = data.displayName || email.split('@')[0];

  const [user] = await sql`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${email}, ${data.passwordHash}, ${displayName})
    RETURNING id, email, display_name, role_default, created_at
  `;
  return user;
}

/**
 * Update a user's profile fields.
 * @param {string} userId
 * @param {object} fields
 * @returns {Promise<object>} updated user
 */
export async function updateUser(userId, fields) {
  const sql = getDb();
  const [user] = await sql`
    UPDATE users
    SET
      display_name = COALESCE(${fields.displayName || null}, display_name),
      updated_at = now()
    WHERE id = ${userId}
    RETURNING id, email, display_name, role_default, updated_at
  `;
  return user;
}

/**
 * List all users (admin).
 * @returns {Promise<object[]>}
 */
export async function listUsers() {
  const sql = getDb();
  return sql`
    SELECT id, email, display_name, role_default, created_at
    FROM users
    ORDER BY created_at DESC
  `;
}
