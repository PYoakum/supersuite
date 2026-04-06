import { json, parseBody, HttpError } from '../http.js';
import { requireAuth } from '../middleware/auth.js';
import { getDocumentBySlug } from '../db/documents.js';
import { getDb } from '../db/connection.js';
import { canonicalize, contentHash } from '@noted/shared';
import { updateDocumentLinks } from '../db/links.js';

/**
 * Register the save route.
 * Full version history logic comes in Milestone 4;
 * this implements the core save semantics now.
 * @param {import('../router.js').Router} router
 */
export function registerSaveRoute(router) {

  // ─── POST /api/docs/:slug/save ────────────────────────────────
  router.post('/api/docs/:slug/save', async (req, res, config) => {
    requireAuth(req);
    const { slug } = req.params;

    const doc = await getDocumentBySlug(slug);
    if (!doc) throw new HttpError(404, 'Document not found');
    if (doc.owner_user_id !== req.user.id) throw new HttpError(403, 'Access denied');

    const body = await parseBody(req);
    const { base_version_id, content_markdown } = body;

    if (typeof content_markdown !== 'string') {
      throw new HttpError(400, 'content_markdown is required');
    }

    // Optimistic concurrency check
    if (base_version_id && base_version_id !== doc.current_version_id) {
      throw new HttpError(409, 'Document has been modified. Please reload.');
    }

    // Canonicalize and hash
    const canonical = canonicalize(content_markdown);
    const hash = contentHash(canonical);

    // No change check
    if (hash === doc.content_hash) {
      json(res, 200, {
        changed: false,
        version_id: doc.current_version_id,
        content_hash: hash,
      });
      return;
    }

    // Create new version
    const sql = getDb();
    const result = await sql.begin(async (tx) => {
      const [version] = await tx`
        INSERT INTO document_versions (document_id, base_version_id, content_markdown, content_hash, created_by_user_id)
        VALUES (
          ${doc.id},
          ${doc.current_version_id},
          ${canonical},
          ${hash},
          ${req.user.id}
        )
        RETURNING id, content_hash
      `;

      await tx`
        UPDATE documents
        SET current_version_id = ${version.id}, updated_at = now()
        WHERE id = ${doc.id}
      `;

      return version;
    });

    json(res, 200, {
      changed: true,
      version_id: result.id,
      content_hash: result.content_hash,
    });

    // Extract wiki-links for backlink graph (async, non-blocking)
    updateDocumentLinks(doc.id, canonical).catch(err =>
      console.error('[save] Link extraction error:', err.message)
    );
  });
}
