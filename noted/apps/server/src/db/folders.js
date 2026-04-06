import { getDb } from './connection.js';

/** Create a folder. */
export async function createFolder(userId, name, parentId = null) {
  const sql = getDb();
  const [row] = await sql`
    INSERT INTO folders (owner_user_id, name, parent_id)
    VALUES (${userId}, ${name.trim()}, ${parentId})
    RETURNING *
  `;
  return row;
}

/** List folders for a user (flat, with parent references). */
export async function listFolders(userId) {
  const sql = getDb();
  return sql`
    SELECT f.*,
      (SELECT count(*)::int FROM documents WHERE folder_id = f.id) AS doc_count
    FROM folders f
    WHERE f.owner_user_id = ${userId}
    ORDER BY f.sort_order, f.name
  `;
}

/** Rename a folder. */
export async function renameFolder(folderId, userId, newName) {
  const sql = getDb();
  const rows = await sql`
    UPDATE folders SET name = ${newName.trim()}
    WHERE id = ${folderId} AND owner_user_id = ${userId}
    RETURNING *
  `;
  return rows[0] || null;
}

/** Delete a folder (documents get folder_id = NULL). */
export async function deleteFolder(folderId, userId) {
  const sql = getDb();
  const rows = await sql`
    DELETE FROM folders WHERE id = ${folderId} AND owner_user_id = ${userId}
    RETURNING *
  `;
  return rows[0] || null;
}

/** Move a document into a folder (or null to unfolder). */
export async function moveDocumentToFolder(docId, folderId) {
  const sql = getDb();
  await sql`UPDATE documents SET folder_id = ${folderId} WHERE id = ${docId}`;
}

/** Get folder by ID. */
export async function getFolderById(folderId) {
  const sql = getDb();
  const rows = await sql`SELECT * FROM folders WHERE id = ${folderId} LIMIT 1`;
  return rows[0] || null;
}
