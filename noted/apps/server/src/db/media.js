import { getDb } from './connection.js';

/**
 * Create a media record.
 * @param {object} data
 * @returns {Promise<object>}
 */
export async function createMedia(data) {
  const sql = getDb();
  const [row] = await sql`
    INSERT INTO media (owner_user_id, kind, storage_path, mime_type, byte_size, width, height, duration)
    VALUES (
      ${data.ownerUserId},
      ${data.kind},
      ${data.storagePath},
      ${data.mimeType},
      ${data.byteSize},
      ${data.width || null},
      ${data.height || null},
      ${data.duration || null}
    )
    RETURNING *
  `;
  return row;
}

/**
 * Fetch a media record by ID.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getMediaById(id) {
  const sql = getDb();
  const rows = await sql`SELECT * FROM media WHERE id = ${id} LIMIT 1`;
  return rows[0] || null;
}

/**
 * List media for a user, newest first.
 * @param {string} userId
 * @param {object} [opts]
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @param {string} [opts.kind] - filter by 'image' or 'video'
 * @returns {Promise<{ media: object[], total: number }>}
 */
export async function listMedia(userId, opts = {}) {
  const sql = getDb();
  const limit = Math.min(opts.limit || 50, 100);
  const offset = Math.max(opts.offset || 0, 0);

  const media = await sql`
    SELECT id, kind, storage_path, mime_type, byte_size, width, height, duration, created_at
    FROM media
    WHERE owner_user_id = ${userId}
    ${opts.kind ? sql`AND kind = ${opts.kind}` : sql``}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [{ count }] = await sql`
    SELECT count(*)::int AS count FROM media
    WHERE owner_user_id = ${userId}
    ${opts.kind ? sql`AND kind = ${opts.kind}` : sql``}
  `;

  return { media, total: count };
}

/**
 * Delete a media record by ID (does NOT delete the file).
 * @param {string} id
 * @param {string} userId - for authorization
 * @returns {Promise<object|null>} deleted row
 */
export async function deleteMedia(id, userId) {
  const sql = getDb();
  const rows = await sql`
    DELETE FROM media
    WHERE id = ${id} AND owner_user_id = ${userId}
    RETURNING *
  `;
  return rows[0] || null;
}
