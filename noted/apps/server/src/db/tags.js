import { getDb } from './connection.js';

/** Create or get a tag by name for a user. */
export async function getOrCreateTag(userId, name, color) {
  const sql = getDb();
  const normalized = name.trim().toLowerCase();
  if (!normalized) throw new Error('Tag name required');

  const existing = await sql`
    SELECT * FROM tags WHERE owner_user_id = ${userId} AND name = ${normalized} LIMIT 1
  `;
  if (existing[0]) return existing[0];

  const [row] = await sql`
    INSERT INTO tags (owner_user_id, name, color)
    VALUES (${userId}, ${normalized}, ${color || '#6b7280'})
    ON CONFLICT (owner_user_id, name) DO UPDATE SET name = EXCLUDED.name
    RETURNING *
  `;
  return row;
}

/** List all tags for a user, with document counts. */
export async function listTags(userId) {
  const sql = getDb();
  return sql`
    SELECT t.*, count(dt.document_id)::int AS doc_count
    FROM tags t
    LEFT JOIN document_tags dt ON dt.tag_id = t.id
    GROUP BY t.id
    HAVING t.owner_user_id = ${userId}
    ORDER BY t.name
  `;
}

/** Tag a document. */
export async function tagDocument(documentId, tagId) {
  const sql = getDb();
  await sql`
    INSERT INTO document_tags (document_id, tag_id)
    VALUES (${documentId}, ${tagId})
    ON CONFLICT DO NOTHING
  `;
}

/** Untag a document. */
export async function untagDocument(documentId, tagId) {
  const sql = getDb();
  await sql`DELETE FROM document_tags WHERE document_id = ${documentId} AND tag_id = ${tagId}`;
}

/** Get tags for a document. */
export async function getDocumentTags(documentId) {
  const sql = getDb();
  return sql`
    SELECT t.* FROM tags t
    JOIN document_tags dt ON dt.tag_id = t.id
    WHERE dt.document_id = ${documentId}
    ORDER BY t.name
  `;
}

/** Fetch tags for multiple documents in one query. Returns { [docId]: [tag, ...] }. */
export async function fetchTagsForDocs(docIds) {
  if (!docIds.length) return {};
  const sql = getDb();
  const rows = await sql`
    SELECT dt.document_id, t.id, t.name, t.color
    FROM document_tags dt
    JOIN tags t ON t.id = dt.tag_id
    WHERE dt.document_id = ANY(${docIds}::uuid[])
    ORDER BY t.name
  `;
  const map = {};
  for (const row of rows) {
    if (!map[row.document_id]) map[row.document_id] = [];
    map[row.document_id].push(row);
  }
  return map;
}

/** Set tags for a document (replace all). */
export async function setDocumentTags(userId, documentId, tagNames) {
  const sql = getDb();
  await sql.begin(async (tx) => {
    await tx`DELETE FROM document_tags WHERE document_id = ${documentId}`;
    for (const name of tagNames) {
      const normalized = name.trim().toLowerCase();
      if (!normalized) continue;
      // Ensure tag exists
      const [tag] = await tx`
        INSERT INTO tags (owner_user_id, name)
        VALUES (${userId}, ${normalized})
        ON CONFLICT (owner_user_id, name) DO UPDATE SET name = EXCLUDED.name
        RETURNING *
      `;
      await tx`
        INSERT INTO document_tags (document_id, tag_id) VALUES (${documentId}, ${tag.id})
        ON CONFLICT DO NOTHING
      `;
    }
  });
}

/** Delete a tag (cascades from document_tags). */
export async function deleteTag(tagId, userId) {
  const sql = getDb();
  const rows = await sql`DELETE FROM tags WHERE id = ${tagId} AND owner_user_id = ${userId} RETURNING *`;
  return rows[0] || null;
}

/** Rename a tag. */
export async function renameTag(tagId, userId, newName) {
  const sql = getDb();
  const normalized = newName.trim().toLowerCase();
  const rows = await sql`
    UPDATE tags SET name = ${normalized}
    WHERE id = ${tagId} AND owner_user_id = ${userId}
    RETURNING *
  `;
  return rows[0] || null;
}
