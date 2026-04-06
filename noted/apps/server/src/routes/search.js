import { json, HttpError } from '../http.js';
import { requireAuth } from '../middleware/auth.js';
import { searchDocuments } from '../db/documents.js';

/**
 * Register search routes.
 * @param {import('../router.js').Router} router
 */
export function registerSearchRoutes(router) {

  // ─── GET /api/search?q=...&limit=...&offset=... ────────────────
  router.get('/api/search', async (req, res, config) => {
    requireAuth(req);

    const q = (req.query.q || '').trim();
    if (!q) {
      json(res, 200, { results: [], total: 0, query: '' });
      return;
    }
    if (q.length > 200) {
      throw new HttpError(400, 'Search query too long (200 char max)');
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const { results, total } = await searchDocuments(req.user.id, q, {
      limit,
      offset,
      includePublic: true,
    });

    json(res, 200, {
      results: results.map(r => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        is_public: r.is_public,
        snippet: r.snippet,
        rank: r.rank,
        updated_at: r.updated_at,
      })),
      total,
      query: q,
      limit,
      offset,
    });
  });
}
