import { json, parseBody, HttpError } from '../http.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createDocument,
  listDocuments,
  getDocumentBySlug,
  updateDocument,
  deleteDocument,
} from '../db/documents.js';
import { resolveRedirect } from '../db/redirects.js';
import { getDocumentTags, fetchTagsForDocs } from '../db/tags.js';
import { getBacklinks } from '../db/links.js';
import { parser } from '@noted/shared';

/**
 * Register all document routes on the router.
 * @param {import('../router.js').Router} router
 */
export function registerDocumentRoutes(router) {

  // ─── POST /api/docs — create document ─────────────────────────
  router.post('/api/docs', async (req, res, config) => {
    requireAuth(req);

    const body = await parseBody(req);
    const title = body.title?.trim() || 'Untitled';

    if (title.length > 500) {
      throw new HttpError(400, 'Title must be under 500 characters');
    }

    const doc = await createDocument({
      title,
      ownerUserId: req.user.id,
      isPublic: body.isPublic || false,
    });

    json(res, 201, {
      document: formatDoc(doc),
    });
  });

  // ─── GET /api/docs — list user's documents ────────────────────
  router.get('/api/docs', async (req, res, config) => {
    requireAuth(req);

    const opts = {};
    if (req.query.folder === 'none') opts.folderId = null;
    else if (req.query.folder) opts.folderId = req.query.folder;
    if (req.query.tag) opts.tag = req.query.tag;

    const docs = await listDocuments(req.user.id, opts);

    // Fetch tags for all documents in one query
    const docTags = await fetchTagsForDocs(docs.map(d => d.id));

    json(res, 200, {
      documents: docs.map(d => ({
        ...formatDoc(d),
        tags: (docTags[d.id] || []).map(t => ({ id: t.id, name: t.name, color: t.color })),
      })),
    });
  });

  // ─── GET /api/docs/:slug — fetch document ─────────────────────
  router.get('/api/docs/:slug', async (req, res, config) => {
    const { slug } = req.params;

    // Try direct lookup
    let doc = await getDocumentBySlug(slug);

    // Try redirect if not found
    if (!doc) {
      const redirect = await resolveRedirect(slug);
      if (redirect) {
        json(res, 301, {
          redirect: true,
          slug: redirect.finalSlug,
          url: `/api/docs/${redirect.finalSlug}`,
        });
        return;
      }
      throw new HttpError(404, 'Document not found');
    }

    // Access control
    if (!doc.is_public) {
      requireAuth(req);
      if (doc.owner_user_id !== req.user.id) {
        throw new HttpError(403, 'Access denied');
      }
    }

    // Fetch tags and backlinks in parallel
    const [tags, backlinks] = await Promise.all([
      getDocumentTags(doc.id),
      getBacklinks(doc.id),
    ]);

    json(res, 200, {
      document: formatDocFull(doc, tags, backlinks),
    });
  });

  // ─── PUT /api/docs/:slug — update metadata ────────────────────
  router.put('/api/docs/:slug', async (req, res, config) => {
    requireAuth(req);
    const { slug } = req.params;

    const doc = await getDocumentBySlug(slug);
    if (!doc) throw new HttpError(404, 'Document not found');
    if (doc.owner_user_id !== req.user.id) throw new HttpError(403, 'Access denied');

    const body = await parseBody(req);
    const fields = {};

    if (body.title !== undefined) {
      const title = body.title.trim();
      if (!title) throw new HttpError(400, 'Title cannot be empty');
      if (title.length > 500) throw new HttpError(400, 'Title must be under 500 characters');
      fields.title = title;
    }

    if (body.isPublic !== undefined) {
      fields.isPublic = !!body.isPublic;
    }

    const updated = await updateDocument(
      doc.id,
      fields,
      config.slugs.auto_redirects,
    );

    json(res, 200, {
      document: formatDoc(updated),
    });
  });

  // ─── DELETE /api/docs/:slug — delete document ──────────────────
  router.delete('/api/docs/:slug', async (req, res, config) => {
    requireAuth(req);
    const { slug } = req.params;

    const doc = await getDocumentBySlug(slug);
    if (!doc) throw new HttpError(404, 'Document not found');
    if (doc.owner_user_id !== req.user.id) throw new HttpError(403, 'Access denied');

    await deleteDocument(doc.id);

    json(res, 200, { ok: true });
  });
}

/**
 * Format a document row for API responses (list view).
 */
function formatDoc(doc) {
  return {
    id: doc.id,
    title: doc.title,
    slug: doc.slug,
    is_public: doc.is_public,
    folder_id: doc.folder_id || null,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

/**
 * Format a document with full content (detail view).
 * Includes server-rendered HTML, tags, and backlinks.
 */
function formatDocFull(doc, tags = [], backlinks = []) {
  const markdown = doc.content_markdown || '';

  // Parse and render
  parser.resetHeadingIds();
  const ast = parser.parse(markdown);
  const { html, headings } = parser.renderWithToc(ast);

  return {
    id: doc.id,
    title: doc.title,
    slug: doc.slug,
    is_public: doc.is_public,
    folder_id: doc.folder_id || null,
    current_version_id: doc.current_version_id,
    content_markdown: markdown,
    content_html: html,
    headings,
    content_hash: doc.content_hash,
    tags: tags.map(t => ({ id: t.id, name: t.name, color: t.color })),
    backlinks: backlinks.map(b => ({ id: b.id, title: b.title, slug: b.slug })),
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    published_at: doc.published_at,
  };
}
