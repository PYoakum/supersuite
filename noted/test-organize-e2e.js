import { createServer } from 'node:http';
import { loadConfig } from './apps/server/src/config.js';
import { initDb, closeDb } from './apps/server/src/db/connection.js';
import { runMigrations } from './apps/server/src/db/migrate.js';
import { createRouter } from './apps/server/src/router.js';
import { json, HttpError, parseCookies } from './apps/server/src/http.js';
import { loadUser } from './apps/server/src/middleware/auth.js';
import { registerAuthRoutes } from './apps/server/src/routes/auth.js';
import { registerDocumentRoutes } from './apps/server/src/routes/documents.js';
import { registerSaveRoute } from './apps/server/src/routes/save.js';
import { registerOrganizeRoutes } from './apps/server/src/routes/organize.js';

const PORT = 13584;
const BASE = `http://127.0.0.1:${PORT}`;
let cookie = '';
let passed = 0;
let failed = 0;

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const sc = res.headers.get('set-cookie');
  if (sc && sc.includes('noted_sid=')) cookie = sc.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  let data = null;
  if (ct.includes('json')) data = await res.json();
  return { status: res.status, data };
}

function assert(ok, msg) {
  if (!ok) { console.error(`  FAIL: ${msg}`); failed++; }
  else { console.log(`  PASS: ${msg}`); passed++; }
}

const config = loadConfig();
const sql = initDb(config.database);
await runMigrations(sql);

// Clean
await sql`DELETE FROM document_links WHERE source_document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-org.com'))`;
await sql`DELETE FROM document_tags WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-org.com'))`;
await sql`UPDATE documents SET current_version_id = NULL WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-org.com')`;
await sql`DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-org.com'))`;
await sql`DELETE FROM document_redirects WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-org.com'))`;
await sql`DELETE FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-org.com')`;
await sql`DELETE FROM folders WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-org.com')`;
await sql`DELETE FROM tags WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-org.com')`;
await sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test-org.com')`;
await sql`DELETE FROM users WHERE email LIKE '%@test-org.com'`;

const router = createRouter();
registerAuthRoutes(router);
registerDocumentRoutes(router);
registerSaveRoute(router);
registerOrganizeRoutes(router);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  req.pathname = url.pathname;
  req.query = Object.fromEntries(url.searchParams);
  req.cookies = parseCookies(req);
  try {
    await loadUser(req, config);
    const m = router.match(req.method, req.pathname);
    if (m) { req.params = m.params; await m.handler(req, res, config); }
    else json(res, 404, { error: 'Not found' });
  } catch (err) {
    if (res.headersSent) return;
    if (err instanceof HttpError) json(res, err.status, { error: err.message });
    else { console.error(err.message); json(res, 500, { error: 'Internal error' }); }
  }
});

await new Promise(r => server.listen(PORT, '127.0.0.1', r));

try {
  // Setup
  console.log('Setup');
  {
    await request('POST', '/api/auth/signup', { email: 'org@test-org.com', password: 'Organize1!', displayName: 'Organizer' });
    const { status } = await request('POST', '/api/auth/login', { email: 'org@test-org.com', password: 'Organize1!' });
    assert(status === 200, `login (${status})`);
  }

  let docASlug, docBSlug, docCSlug;

  console.log('\nSetup: create docs');
  {
    const { data: a } = await request('POST', '/api/docs', { title: 'Doc Alpha' });
    docASlug = a.document.slug;
    const { data: b } = await request('POST', '/api/docs', { title: 'Doc Beta' });
    docBSlug = b.document.slug;
    const { data: c } = await request('POST', '/api/docs', { title: 'Doc Gamma' });
    docCSlug = c.document.slug;
    assert(docASlug && docBSlug && docCSlug, 'docs created');
  }

  // ═══════════════════════════════════════════════
  // TAGS
  // ═══════════════════════════════════════════════

  console.log('\n1. Create tag');
  let tagId;
  {
    const { status, data } = await request('POST', '/api/tags', { name: 'Important' });
    assert(status === 201, `201 (${status})`);
    assert(data.tag.name === 'important', `lowercase (${data.tag.name})`);
    tagId = data.tag.id;
  }

  console.log('\n2. List tags');
  {
    const { data } = await request('GET', '/api/tags');
    assert(data.tags.length >= 1, `has tags (${data.tags.length})`);
    assert(data.tags.some(t => t.name === 'important'), 'found');
  }

  console.log('\n3. Tag a document');
  {
    const { status, data } = await request('PUT', `/api/docs/${docASlug}/tags`, { tags: ['important', 'draft'] });
    assert(status === 200, `200 (${status})`);
    assert(data.tags.length === 2, `2 tags (${data.tags.length})`);
  }

  console.log('\n4. Get doc tags');
  {
    const { data } = await request('GET', `/api/docs/${docASlug}/tags`);
    assert(data.tags.length === 2, `2 tags (${data.tags.length})`);
    assert(data.tags.some(t => t.name === 'important'), 'important');
    assert(data.tags.some(t => t.name === 'draft'), 'draft');
  }

  console.log('\n5. Doc detail includes tags');
  {
    const { data } = await request('GET', `/api/docs/${docASlug}`);
    assert(data.document.tags.length === 2, `tags in detail (${data.document.tags.length})`);
  }

  console.log('\n6. Remove a tag from doc');
  {
    await request('PUT', `/api/docs/${docASlug}/tags`, { tags: ['important'] });
    const { data } = await request('GET', `/api/docs/${docASlug}/tags`);
    assert(data.tags.length === 1, `1 tag (${data.tags.length})`);
  }

  console.log('\n7. Filter docs by tag');
  {
    const { data } = await request('GET', '/api/docs?tag=important');
    assert(data.documents.some(d => d.slug === docASlug), 'alpha found');
    assert(!data.documents.some(d => d.slug === docBSlug), 'beta not found');
  }

  console.log('\n8. Rename tag');
  {
    const { status, data } = await request('PUT', `/api/tags/${tagId}`, { name: 'critical' });
    assert(status === 200, `200 (${status})`);
    assert(data.tag.name === 'critical', `renamed (${data.tag.name})`);
  }

  console.log('\n9. Delete tag');
  {
    const { data: tdata } = await request('POST', '/api/tags', { name: 'temp' });
    const { status } = await request('DELETE', `/api/tags/${tdata.tag.id}`);
    assert(status === 200, `200 (${status})`);
    const { data } = await request('GET', '/api/tags');
    assert(!data.tags.some(t => t.name === 'temp'), 'gone');
  }

  // ═══════════════════════════════════════════════
  // FOLDERS
  // ═══════════════════════════════════════════════

  let folderId;

  console.log('\n10. Create folder');
  {
    const { status, data } = await request('POST', '/api/folders', { name: 'Projects' });
    assert(status === 201, `201 (${status})`);
    assert(data.folder.name === 'Projects', `name (${data.folder.name})`);
    folderId = data.folder.id;
  }

  console.log('\n11. List folders');
  {
    const { data } = await request('GET', '/api/folders');
    assert(data.folders.length >= 1, `has folders (${data.folders.length})`);
  }

  console.log('\n12. Move doc to folder');
  {
    const { status } = await request('PUT', `/api/docs/${docASlug}/folder`, { folderId });
    assert(status === 200, `200 (${status})`);
  }

  console.log('\n13. Doc detail includes folder_id');
  {
    const { data } = await request('GET', `/api/docs/${docASlug}`);
    assert(data.document.folder_id === folderId, `folder_id (${data.document.folder_id})`);
  }

  console.log('\n14. Filter docs by folder');
  {
    const { data } = await request('GET', `/api/docs?folder=${folderId}`);
    assert(data.documents.some(d => d.slug === docASlug), 'alpha in folder');
    assert(!data.documents.some(d => d.slug === docBSlug), 'beta not in folder');
  }

  console.log('\n15. Filter unfiled docs');
  {
    const { data } = await request('GET', '/api/docs?folder=none');
    assert(!data.documents.some(d => d.slug === docASlug), 'alpha is filed');
    assert(data.documents.some(d => d.slug === docBSlug), 'beta unfiled');
  }

  console.log('\n16. Rename folder');
  {
    const { status, data } = await request('PUT', `/api/folders/${folderId}`, { name: 'Active Projects' });
    assert(status === 200, `200 (${status})`);
    assert(data.folder.name === 'Active Projects', `renamed (${data.folder.name})`);
  }

  console.log('\n17. Delete folder (docs unassigned)');
  {
    const { data: fd } = await request('POST', '/api/folders', { name: 'Temp Folder' });
    await request('PUT', `/api/docs/${docBSlug}/folder`, { folderId: fd.folder.id });
    const { status } = await request('DELETE', `/api/folders/${fd.folder.id}`);
    assert(status === 200, `200 (${status})`);
    const { data: d } = await request('GET', `/api/docs/${docBSlug}`);
    assert(d.document.folder_id === null, 'folder_id null after delete');
  }

  // ═══════════════════════════════════════════════
  // BACKLINKS
  // ═══════════════════════════════════════════════

  console.log('\n18. Wiki-link extraction on save');
  {
    const { data: fetchB } = await request('GET', `/api/docs/${docBSlug}`);
    const md = `# Doc Beta\n\nSee also [[${docASlug}]] for more info.\n`;
    await request('POST', `/api/docs/${docBSlug}/save`, {
      base_version_id: fetchB.document.current_version_id,
      content_markdown: md,
    });
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n19. Get backlinks for Doc Alpha');
  {
    const { status, data } = await request('GET', `/api/docs/${docASlug}/backlinks`);
    assert(status === 200, `200 (${status})`);
    assert(data.backlinks.length >= 1, `has backlinks (${data.backlinks.length})`);
    assert(data.backlinks.some(b => b.slug === docBSlug), 'beta links to alpha');
  }

  console.log('\n20. Doc detail includes backlinks');
  {
    const { data } = await request('GET', `/api/docs/${docASlug}`);
    assert(data.document.backlinks.length >= 1, `backlinks in detail (${data.document.backlinks.length})`);
  }

  console.log('\n21. Get outgoing links');
  {
    const { status, data } = await request('GET', `/api/docs/${docBSlug}/outlinks`);
    assert(status === 200, `200 (${status})`);
    assert(data.outlinks.length >= 1, `has outlinks (${data.outlinks.length})`);
    assert(data.outlinks.some(o => o.target_slug === docASlug), 'links to alpha');
  }

  console.log('\n22. Multiple wiki-links');
  {
    const { data: fetchC } = await request('GET', `/api/docs/${docCSlug}`);
    const md = `# Gamma\n\nLinks to [[${docASlug}]] and [[${docBSlug}|Beta Doc]].\n`;
    await request('POST', `/api/docs/${docCSlug}/save`, {
      base_version_id: fetchC.document.current_version_id,
      content_markdown: md,
    });
    await new Promise(r => setTimeout(r, 300));

    const { data } = await request('GET', `/api/docs/${docCSlug}/outlinks`);
    assert(data.outlinks.length >= 2, `2 outlinks (${data.outlinks.length})`);

    const { data: bl } = await request('GET', `/api/docs/${docASlug}/backlinks`);
    assert(bl.backlinks.length >= 2, `alpha has 2+ backlinks (${bl.backlinks.length})`);
  }

  console.log('\n23. Auth required for organize');
  {
    const saved = cookie;
    cookie = '';
    const { status: s1 } = await request('GET', '/api/tags');
    const { status: s2 } = await request('GET', '/api/folders');
    const { status: s3 } = await request('GET', `/api/docs/${docASlug}/backlinks`);
    assert(s1 === 401, `tags 401 (${s1})`);
    assert(s2 === 401, `folders 401 (${s2})`);
    assert(s3 === 401, `backlinks 401 (${s3})`);
    cookie = saved;
  }

} finally {
  server.close();
  await sql`DELETE FROM document_links WHERE source_document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-org.com'))`;
  await sql`DELETE FROM document_tags WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-org.com'))`;
  await sql`UPDATE documents SET current_version_id = NULL WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-org.com')`;
  await sql`DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-org.com'))`;
  await sql`DELETE FROM document_redirects WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-org.com'))`;
  await sql`DELETE FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-org.com')`;
  await sql`DELETE FROM folders WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-org.com')`;
  await sql`DELETE FROM tags WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-org.com')`;
  await sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test-org.com')`;
  await sql`DELETE FROM users WHERE email LIKE '%@test-org.com'`;
  await closeDb();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
