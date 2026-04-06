import { getDb } from './connection.js';
import { canonicalize, contentHash } from '@noted/shared';

/**
 * List versions for a document, newest first.
 * @param {string} documentId
 * @param {object} [opts]
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @returns {Promise<{ versions: object[], total: number }>}
 */
export async function listVersions(documentId, opts = {}) {
  const sql = getDb();
  const limit = opts.limit || 50;
  const offset = opts.offset || 0;

  const versions = await sql`
    SELECT
      v.id,
      v.document_id,
      v.base_version_id,
      v.content_hash,
      v.created_at,
      v.created_by_user_id,
      v.summary,
      u.display_name AS created_by_name,
      length(v.content_markdown) AS content_length
    FROM document_versions v
    LEFT JOIN users u ON u.id = v.created_by_user_id
    WHERE v.document_id = ${documentId}
    ORDER BY v.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [{ count }] = await sql`
    SELECT count(*)::int AS count
    FROM document_versions
    WHERE document_id = ${documentId}
  `;

  return { versions, total: count };
}

/**
 * Fetch a specific version by ID.
 * @param {string} versionId
 * @param {string} documentId - for authorization scoping
 * @returns {Promise<object|null>}
 */
export async function getVersion(versionId, documentId) {
  const sql = getDb();
  const rows = await sql`
    SELECT
      v.id,
      v.document_id,
      v.base_version_id,
      v.content_markdown,
      v.content_hash,
      v.created_at,
      v.created_by_user_id,
      v.summary,
      u.display_name AS created_by_name
    FROM document_versions v
    LEFT JOIN users u ON u.id = v.created_by_user_id
    WHERE v.id = ${versionId}
      AND v.document_id = ${documentId}
    LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Restore a document to a previous version.
 * This creates a NEW version with the old version's content,
 * rather than moving the pointer backwards.
 *
 * @param {string} documentId
 * @param {string} sourceVersionId - the version to restore from
 * @param {string} userId - who is performing the restore
 * @returns {Promise<object>} the newly created version
 */
export async function restoreVersion(documentId, sourceVersionId, userId) {
  const sql = getDb();

  return sql.begin(async (tx) => {
    // Fetch the source version content
    const [source] = await tx`
      SELECT id, content_markdown, content_hash
      FROM document_versions
      WHERE id = ${sourceVersionId} AND document_id = ${documentId}
    `;

    if (!source) {
      throw new Error('Source version not found');
    }

    // Get the current version for this document
    const [doc] = await tx`
      SELECT current_version_id FROM documents WHERE id = ${documentId}
    `;

    // Canonicalize (should already be canonical, but ensure consistency)
    const canonical = canonicalize(source.content_markdown);
    const hash = contentHash(canonical);

    // Check if current version already has this exact content
    const [currentVersion] = await tx`
      SELECT content_hash FROM document_versions WHERE id = ${doc.current_version_id}
    `;

    if (currentVersion && currentVersion.content_hash === hash) {
      // No actual change — return current version id
      return {
        id: doc.current_version_id,
        content_hash: hash,
        changed: false,
      };
    }

    // Create a new version with the restored content
    const [newVersion] = await tx`
      INSERT INTO document_versions (
        document_id, base_version_id, content_markdown, content_hash,
        created_by_user_id, summary
      )
      VALUES (
        ${documentId},
        ${doc.current_version_id},
        ${canonical},
        ${hash},
        ${userId},
        ${`Restored from version ${sourceVersionId.slice(0, 8)}`}
      )
      RETURNING id, content_hash
    `;

    // Update document pointer
    await tx`
      UPDATE documents
      SET current_version_id = ${newVersion.id}, updated_at = now()
      WHERE id = ${documentId}
    `;

    return { ...newVersion, changed: true };
  });
}
