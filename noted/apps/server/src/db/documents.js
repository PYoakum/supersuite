import { getDb } from './connection.js';
import { slugify, uniqueSlug, canonicalize, contentHash } from '@noted/shared';

/**
 * Check if a slug is already taken (by document or redirect).
 * @param {string} slug
 * @param {string} [excludeDocId] - exclude this document from the check
 * @returns {Promise<boolean>}
 */
export async function slugExists(slug, excludeDocId) {
  const sql = getDb();

  const [docRow] = await sql`
    SELECT 1 FROM documents
    WHERE slug = ${slug}
    ${excludeDocId ? sql`AND id != ${excludeDocId}` : sql``}
    LIMIT 1
  `;
  if (docRow) return true;

  const [redirectRow] = await sql`
    SELECT 1 FROM document_redirects WHERE old_slug = ${slug} LIMIT 1
  `;
  return !!redirectRow;
}

/**
 * Create a new document with an initial empty version.
 * @param {object} data
 * @param {string} data.title
 * @param {string} data.ownerUserId
 * @param {boolean} [data.isPublic]
 * @returns {Promise<object>} created document
 */
export async function createDocument(data) {
  const sql = getDb();
  const slug = await uniqueSlug(data.title || 'untitled', (s) => slugExists(s));

  // Use a transaction to create doc + initial version atomically
  const doc = await sql.begin(async (tx) => {
    const [document] = await tx`
      INSERT INTO documents (owner_user_id, title, slug, is_public)
      VALUES (${data.ownerUserId}, ${data.title || 'Untitled'}, ${slug}, ${data.isPublic || false})
      RETURNING *
    `;

    // Create initial empty version
    const initialContent = '';
    const canonical = canonicalize(initialContent);
    const hash = contentHash(canonical);

    const [version] = await tx`
      INSERT INTO document_versions (document_id, content_markdown, content_hash, created_by_user_id)
      VALUES (${document.id}, ${canonical}, ${hash}, ${data.ownerUserId})
      RETURNING id
    `;

    // Link document to its initial version
    await tx`
      UPDATE documents
      SET current_version_id = ${version.id}
      WHERE id = ${document.id}
    `;

    document.current_version_id = version.id;
    return document;
  });

  return doc;
}

/**
 * List documents for a user (owned documents).
 * @param {string} userId
 * @returns {Promise<object[]>}
 */
export async function listDocuments(userId, opts = {}) {
  const sql = getDb();
  return sql`
    SELECT id, title, slug, is_public, folder_id, created_at, updated_at
    FROM documents
    WHERE owner_user_id = ${userId}
    ${opts.folderId !== undefined ? (opts.folderId ? sql`AND folder_id = ${opts.folderId}` : sql`AND folder_id IS NULL`) : sql``}
    ${opts.tag ? sql`AND id IN (SELECT dt.document_id FROM document_tags dt JOIN tags t ON t.id = dt.tag_id WHERE t.name = ${opts.tag} AND t.owner_user_id = ${userId})` : sql``}
    ORDER BY updated_at DESC
  `;
}

/**
 * Fetch a document by slug, including current version content.
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getDocumentBySlug(slug) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      d.id, d.owner_user_id, d.title, d.slug, d.is_public, d.folder_id,
      d.current_version_id, d.created_at, d.updated_at, d.published_at,
      v.content_markdown, v.content_hash, v.created_at AS version_created_at
    FROM documents d
    LEFT JOIN document_versions v ON v.id = d.current_version_id
    WHERE d.slug = ${slug}
    LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Fetch a document by ID.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getDocumentById(id) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      d.id, d.owner_user_id, d.title, d.slug, d.is_public,
      d.current_version_id, d.created_at, d.updated_at,
      v.content_markdown, v.content_hash
    FROM documents d
    LEFT JOIN document_versions v ON v.id = d.current_version_id
    WHERE d.id = ${id}
    LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Update document metadata (title, is_public).
 * Handles slug change + redirect creation when title changes.
 * @param {string} docId
 * @param {object} fields
 * @param {string} [fields.title]
 * @param {boolean} [fields.isPublic]
 * @param {boolean} autoRedirects - from config
 * @returns {Promise<object>} updated document
 */
export async function updateDocument(docId, fields, autoRedirects = true) {
  const sql = getDb();

  return sql.begin(async (tx) => {
    // Get current document
    const [current] = await tx`
      SELECT id, title, slug, is_public FROM documents WHERE id = ${docId}
    `;
    if (!current) throw new Error('Document not found');

    let newSlug = current.slug;
    let titleChanged = false;

    // Handle title change -> slug change
    if (fields.title !== undefined && fields.title !== current.title) {
      titleChanged = true;
      const candidateSlug = await uniqueSlug(fields.title, (s) => slugExists(s, docId));

      if (candidateSlug !== current.slug) {
        newSlug = candidateSlug;

        // Create redirect from old slug to new slug
        if (autoRedirects) {
          await tx`
            INSERT INTO document_redirects (document_id, old_slug, new_slug)
            VALUES (${docId}, ${current.slug}, ${newSlug})
            ON CONFLICT (old_slug) DO UPDATE SET new_slug = ${newSlug}
          `;
        }
      }
    }

    const newTitle = fields.title !== undefined ? fields.title : current.title;
    const newPublic = fields.isPublic !== undefined ? fields.isPublic : current.is_public;

    const [updated] = await tx`
      UPDATE documents
      SET
        title = ${newTitle},
        slug = ${newSlug},
        is_public = ${newPublic},
        updated_at = now()
      WHERE id = ${docId}
      RETURNING *
    `;

    return updated;
  });
}

/**
 * Delete a document and all its versions/redirects.
 * @param {string} docId
 */
export async function deleteDocument(docId) {
  const sql = getDb();
  // Cascade handles versions, redirects via FK ON DELETE CASCADE
  // But we need to null out current_version_id first to avoid FK constraint
  await sql.begin(async (tx) => {
    await tx`UPDATE documents SET current_version_id = NULL WHERE id = ${docId}`;
    await tx`DELETE FROM document_versions WHERE document_id = ${docId}`;
    await tx`DELETE FROM document_redirects WHERE document_id = ${docId}`;
    await tx`DELETE FROM documents WHERE id = ${docId}`;
  });
}

/**
 * Search documents by title and content.
 * Uses Postgres full-text search with ranking.
 *
 * @param {string} userId - owner filter
 * @param {string} query - search query
 * @param {object} [opts]
 * @param {number} [opts.limit=20]
 * @param {number} [opts.offset=0]
 * @param {boolean} [opts.includePublic=false] - also search public docs from other users
 * @returns {Promise<{ results: object[], total: number }>}
 */
export async function searchDocuments(userId, query, opts = {}) {
  const sql = getDb();
  const limit = Math.min(opts.limit || 20, 50);
  const offset = Math.max(opts.offset || 0, 0);

  if (!query || !query.trim()) {
    return { results: [], total: 0 };
  }

  // Build tsquery from input — handle plain text search
  const tsQuery = query.trim().split(/\s+/).filter(Boolean).join(' & ');

  const results = await sql`
    SELECT
      d.id, d.title, d.slug, d.is_public,
      d.created_at, d.updated_at,
      ts_rank(d.search_tsv, to_tsquery('english', ${tsQuery})) AS rank,
      ts_headline('english', coalesce(dv.content_markdown, ''), to_tsquery('english', ${tsQuery}),
        'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=30, MinWords=10'
      ) AS snippet
    FROM documents d
    LEFT JOIN document_versions dv ON d.current_version_id = dv.id
    WHERE d.search_tsv @@ to_tsquery('english', ${tsQuery})
      AND (d.owner_user_id = ${userId} ${opts.includePublic ? sql`OR d.is_public = true` : sql``})
    ORDER BY rank DESC, d.updated_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [{ count }] = await sql`
    SELECT count(*)::int AS count
    FROM documents d
    WHERE d.search_tsv @@ to_tsquery('english', ${tsQuery})
      AND (d.owner_user_id = ${userId} ${opts.includePublic ? sql`OR d.is_public = true` : sql``})
  `;

  return { results, total: count };
}
