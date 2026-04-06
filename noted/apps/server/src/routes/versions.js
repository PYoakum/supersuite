import { json, HttpError } from '../http.js';
import { requireAuth } from '../middleware/auth.js';
import { getDocumentBySlug } from '../db/documents.js';
import { listVersions, getVersion, restoreVersion } from '../db/versions.js';

/**
 * Register version history routes.
 * @param {import('../router.js').Router} router
 */
export function registerVersionRoutes(router) {

  // ─── GET /api/docs/:slug/versions — list versions ──────────────
  router.get('/api/docs/:slug/versions', async (req, res, config) => {
    requireAuth(req);
    const { slug } = req.params;

    const doc = await getDocumentBySlug(slug);
    if (!doc) throw new HttpError(404, 'Document not found');
    if (doc.owner_user_id !== req.user.id) throw new HttpError(403, 'Access denied');

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const { versions, total } = await listVersions(doc.id, { limit, offset });

    json(res, 200, {
      versions: versions.map(formatVersion),
      total,
      limit,
      offset,
      current_version_id: doc.current_version_id,
    });
  });

  // ─── GET /api/docs/:slug/versions/:versionId — fetch version ───
  router.get('/api/docs/:slug/versions/:versionId', async (req, res, config) => {
    requireAuth(req);
    const { slug, versionId } = req.params;

    const doc = await getDocumentBySlug(slug);
    if (!doc) throw new HttpError(404, 'Document not found');
    if (doc.owner_user_id !== req.user.id) throw new HttpError(403, 'Access denied');

    const version = await getVersion(versionId, doc.id);
    if (!version) throw new HttpError(404, 'Version not found');

    json(res, 200, {
      version: {
        ...formatVersion(version),
        content_markdown: version.content_markdown,
      },
    });
  });

  // ─── POST /api/docs/:slug/restore/:versionId — restore ─────────
  router.post('/api/docs/:slug/restore/:versionId', async (req, res, config) => {
    requireAuth(req);
    const { slug, versionId } = req.params;

    const doc = await getDocumentBySlug(slug);
    if (!doc) throw new HttpError(404, 'Document not found');
    if (doc.owner_user_id !== req.user.id) throw new HttpError(403, 'Access denied');

    const result = await restoreVersion(doc.id, versionId, req.user.id);

    json(res, 200, {
      version_id: result.id,
      content_hash: result.content_hash,
      changed: result.changed,
    });
  });
}

/**
 * Format a version row for API responses (without content).
 */
function formatVersion(v) {
  return {
    id: v.id,
    document_id: v.document_id,
    base_version_id: v.base_version_id,
    content_hash: v.content_hash,
    content_length: v.content_length,
    created_at: v.created_at,
    created_by_user_id: v.created_by_user_id,
    created_by_name: v.created_by_name,
    summary: v.summary,
  };
}
