import { json, parseBody, HttpError } from '../http.js';
import { requireAuth } from '../middleware/auth.js';
import { getOrCreateTag, listTags, deleteTag, renameTag, setDocumentTags, getDocumentTags } from '../db/tags.js';
import { createFolder, listFolders, renameFolder, deleteFolder, moveDocumentToFolder } from '../db/folders.js';
import { getBacklinks, getOutgoingLinks } from '../db/links.js';
import { getDocumentBySlug } from '../db/documents.js';

/**
 * Register organization routes (tags, folders, backlinks).
 * @param {import('../router.js').Router} router
 */
export function registerOrganizeRoutes(router) {

  // ═══════════════════════════════════════════════
  // TAGS
  // ═══════════════════════════════════════════════

  // GET /api/tags — list user's tags with counts
  router.get('/api/tags', async (req, res) => {
    requireAuth(req);
    const tags = await listTags(req.user.id);
    json(res, 200, { tags });
  });

  // POST /api/tags — create a tag
  router.post('/api/tags', async (req, res) => {
    requireAuth(req);
    const { name, color } = await parseBody(req);
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new HttpError(400, 'Tag name required');
    }
    const tag = await getOrCreateTag(req.user.id, name, color);
    json(res, 201, { tag });
  });

  // PUT /api/tags/:id — rename tag
  router.put('/api/tags/:id', async (req, res) => {
    requireAuth(req);
    const { name } = await parseBody(req);
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new HttpError(400, 'Tag name required');
    }
    const tag = await renameTag(req.params.id, req.user.id, name);
    if (!tag) throw new HttpError(404, 'Tag not found');
    json(res, 200, { tag });
  });

  // DELETE /api/tags/:id — delete tag
  router.delete('/api/tags/:id', async (req, res) => {
    requireAuth(req);
    const deleted = await deleteTag(req.params.id, req.user.id);
    if (!deleted) throw new HttpError(404, 'Tag not found');
    json(res, 200, { ok: true });
  });

  // PUT /api/docs/:slug/tags — set tags on a document
  router.put('/api/docs/:slug/tags', async (req, res) => {
    requireAuth(req);
    const doc = await resolveDoc(req.params.slug, req.user.id);
    const { tags } = await parseBody(req);
    if (!Array.isArray(tags)) throw new HttpError(400, 'tags must be an array of strings');
    await setDocumentTags(req.user.id, doc.id, tags);
    const updated = await getDocumentTags(doc.id);
    json(res, 200, { tags: updated });
  });

  // GET /api/docs/:slug/tags — get tags for a document
  router.get('/api/docs/:slug/tags', async (req, res) => {
    requireAuth(req);
    const doc = await resolveDoc(req.params.slug, req.user.id);
    const tags = await getDocumentTags(doc.id);
    json(res, 200, { tags });
  });

  // ═══════════════════════════════════════════════
  // FOLDERS
  // ═══════════════════════════════════════════════

  // GET /api/folders — list user's folders
  router.get('/api/folders', async (req, res) => {
    requireAuth(req);
    const folders = await listFolders(req.user.id);
    json(res, 200, { folders });
  });

  // POST /api/folders — create folder
  router.post('/api/folders', async (req, res) => {
    requireAuth(req);
    const { name, parentId } = await parseBody(req);
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new HttpError(400, 'Folder name required');
    }
    const folder = await createFolder(req.user.id, name, parentId || null);
    json(res, 201, { folder });
  });

  // PUT /api/folders/:id — rename folder
  router.put('/api/folders/:id', async (req, res) => {
    requireAuth(req);
    const { name } = await parseBody(req);
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new HttpError(400, 'Folder name required');
    }
    const folder = await renameFolder(req.params.id, req.user.id, name);
    if (!folder) throw new HttpError(404, 'Folder not found');
    json(res, 200, { folder });
  });

  // DELETE /api/folders/:id — delete folder
  router.delete('/api/folders/:id', async (req, res) => {
    requireAuth(req);
    const deleted = await deleteFolder(req.params.id, req.user.id);
    if (!deleted) throw new HttpError(404, 'Folder not found');
    json(res, 200, { ok: true });
  });

  // PUT /api/docs/:slug/folder — move doc to folder
  router.put('/api/docs/:slug/folder', async (req, res) => {
    requireAuth(req);
    const doc = await resolveDoc(req.params.slug, req.user.id);
    const { folderId } = await parseBody(req);
    await moveDocumentToFolder(doc.id, folderId || null);
    json(res, 200, { ok: true, folderId: folderId || null });
  });

  // ═══════════════════════════════════════════════
  // BACKLINKS
  // ═══════════════════════════════════════════════

  // GET /api/docs/:slug/backlinks — docs linking to this one
  router.get('/api/docs/:slug/backlinks', async (req, res) => {
    requireAuth(req);
    const doc = await resolveDoc(req.params.slug, req.user.id);
    const backlinks = await getBacklinks(doc.id);
    json(res, 200, { backlinks });
  });

  // GET /api/docs/:slug/outlinks — docs this one links to
  router.get('/api/docs/:slug/outlinks', async (req, res) => {
    requireAuth(req);
    const doc = await resolveDoc(req.params.slug, req.user.id);
    const outlinks = await getOutgoingLinks(doc.id);
    json(res, 200, { outlinks });
  });
}

/** Helper: resolve slug to owned document or throw. */
async function resolveDoc(slug, userId) {
  const doc = await getDocumentBySlug(slug);
  if (!doc) throw new HttpError(404, 'Document not found');
  if (doc.owner_user_id !== userId) throw new HttpError(403, 'Access denied');
  return doc;
}
