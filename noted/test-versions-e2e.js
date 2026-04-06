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
import { registerVersionRoutes } from './apps/server/src/routes/versions.js';

const PORT = 13581;
const BASE = `http://127.0.0.1:${PORT}`;
let sessionCookie = '';
let passed = 0;
let failed = 0;

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionCookie) headers['Cookie'] = sessionCookie;
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const sc = res.headers.get('set-cookie');
  if (sc && sc.includes('noted_sid=')) sessionCookie = sc.split(';')[0];
  return { status: res.status, data: await res.json() };
}

function assert(ok, msg) {
  if (!ok) { console.error(`  FAIL: ${msg}`); failed++; }
  else { console.log(`  PASS: ${msg}`); passed++; }
}

// -- Server setup --
const config = loadConfig();
const sql = initDb(config.database);
await runMigrations(sql);

// Clean
const DOMAIN = '@test-ver.com';
await sql`UPDATE documents SET current_version_id = NULL WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${'%' + DOMAIN})`;
await sql`DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${'%' + DOMAIN}))`;
await sql`DELETE FROM document_redirects WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${'%' + DOMAIN}))`;
await sql`DELETE FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${'%' + DOMAIN})`;
await sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${'%' + DOMAIN})`;
await sql`DELETE FROM users WHERE email LIKE ${'%' + DOMAIN}`;

const router = createRouter();
registerAuthRoutes(router);
registerDocumentRoutes(router);
registerSaveRoute(router);
registerVersionRoutes(router);

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
    if (err instanceof HttpError) json(res, err.status, { error: err.message });
    else { console.error(err); json(res, 500, { error: 'Internal error' }); }
  }
});

await new Promise(r => server.listen(PORT, '127.0.0.1', r));
console.log(`Test server on ${BASE}\n`);

try {
  // ─── Setup ──────────────────────────────────────────────────────
  console.log('0. Setup');
  const signup = await request('POST', '/api/auth/signup', {
    email: `ver${DOMAIN}`, password: 'password123', displayName: 'Version Tester',
  });
  assert(signup.status === 201, 'signup OK');

  const create = await request('POST', '/api/docs', { title: 'Version Test Doc' });
  assert(create.status === 201, 'doc created');
  const slug = create.data.document.slug;
  console.log('');

  // ─── 1. Initial version exists ──────────────────────────────────
  console.log('1. Initial version listing');
  const list1 = await request('GET', `/api/docs/${slug}/versions`);
  assert(list1.status === 200, `200 (got ${list1.status})`);
  assert(list1.data.versions?.length === 1, `1 version (got ${list1.data.versions?.length})`);
  assert(list1.data.total === 1, `total = 1`);
  const initialVersionId = list1.data.versions[0].id;
  assert(initialVersionId === list1.data.current_version_id, 'initial = current');
  console.log('');

  // ─── 2. Save content → creates version 2 ────────────────────────
  console.log('2. Save creates version 2');
  const save1 = await request('POST', `/api/docs/${slug}/save`, {
    base_version_id: initialVersionId,
    content_markdown: '# Version 1 Content\n\nHello world.\n',
  });
  assert(save1.status === 200, '200');
  assert(save1.data.changed === true, 'changed');
  const v2Id = save1.data.version_id;
  console.log('');

  // ─── 3. Save again → version 3 ──────────────────────────────────
  console.log('3. Save creates version 3');
  const save2 = await request('POST', `/api/docs/${slug}/save`, {
    base_version_id: v2Id,
    content_markdown: '# Version 2 Content\n\nUpdated text.\n',
  });
  assert(save2.data.changed === true, 'changed');
  const v3Id = save2.data.version_id;
  console.log('');

  // ─── 4. Save again → version 4 ──────────────────────────────────
  console.log('4. Save creates version 4');
  const save3 = await request('POST', `/api/docs/${slug}/save`, {
    base_version_id: v3Id,
    content_markdown: '# Version 3 Content\n\nFinal text.\n',
  });
  assert(save3.data.changed === true, 'changed');
  const v4Id = save3.data.version_id;
  console.log('');

  // ─── 5. List versions — should have 4 ───────────────────────────
  console.log('5. List all versions');
  const list2 = await request('GET', `/api/docs/${slug}/versions`);
  assert(list2.data.versions?.length === 4, `4 versions (got ${list2.data.versions?.length})`);
  assert(list2.data.total === 4, `total = 4 (got ${list2.data.total})`);
  assert(list2.data.current_version_id === v4Id, 'current is latest');
  // Versions should be newest first
  assert(list2.data.versions[0].id === v4Id, 'newest first');
  assert(list2.data.versions[3].id === initialVersionId, 'oldest last');
  console.log('');

  // ─── 6. Fetch specific version ──────────────────────────────────
  console.log('6. Fetch specific version (v2)');
  const fetchV2 = await request('GET', `/api/docs/${slug}/versions/${v2Id}`);
  assert(fetchV2.status === 200, `200 (got ${fetchV2.status})`);
  assert(fetchV2.data.version?.content_markdown?.includes('Version 1 Content'), 'correct content');
  assert(fetchV2.data.version?.id === v2Id, 'correct id');
  console.log('');

  // ─── 7. Fetch initial version ───────────────────────────────────
  console.log('7. Fetch initial version (empty)');
  const fetchInit = await request('GET', `/api/docs/${slug}/versions/${initialVersionId}`);
  assert(fetchInit.status === 200, `200 (got ${fetchInit.status})`);
  assert(fetchInit.data.version?.content_markdown?.trim() === '', 'empty content');
  console.log('');

  // ─── 8. Fetch nonexistent version → 404 ─────────────────────────
  console.log('8. Fetch nonexistent version');
  const fetchBad = await request('GET', `/api/docs/${slug}/versions/00000000-0000-0000-0000-000000000000`);
  assert(fetchBad.status === 404, `404 (got ${fetchBad.status})`);
  console.log('');

  // ─── 9. Restore to version 2 ────────────────────────────────────
  console.log('9. Restore to version 2');
  const restore1 = await request('POST', `/api/docs/${slug}/restore/${v2Id}`);
  assert(restore1.status === 200, `200 (got ${restore1.status})`);
  assert(restore1.data.changed === true, 'changed (different content)');
  const restoredVersionId = restore1.data.version_id;
  assert(restoredVersionId !== v2Id, 'creates new version (not pointer move)');
  console.log('');

  // ─── 10. Verify restored content ────────────────────────────────
  console.log('10. Verify restored content');
  const fetchRestored = await request('GET', `/api/docs/${slug}`);
  assert(fetchRestored.data.document?.content_markdown?.includes('Version 1 Content'), 'restored to v2 content');
  assert(fetchRestored.data.document?.current_version_id === restoredVersionId, 'current = restored version');
  console.log('');

  // ─── 11. Versions now have 5 entries ─────────────────────────────
  console.log('11. Version count after restore');
  const list3 = await request('GET', `/api/docs/${slug}/versions`);
  assert(list3.data.total === 5, `5 versions (got ${list3.data.total})`);
  // Newest should be the restored version
  assert(list3.data.versions[0].id === restoredVersionId, 'restored version is newest');
  assert(list3.data.versions[0].summary?.includes('Restored'), 'has restore summary');
  console.log('');

  // ─── 12. Restore to same content → no change ────────────────────
  console.log('12. Restore to current content (no change)');
  const restore2 = await request('POST', `/api/docs/${slug}/restore/${restoredVersionId}`);
  assert(restore2.status === 200, `200 (got ${restore2.status})`);
  assert(restore2.data.changed === false, 'no change (same content)');
  console.log('');

  // ─── 13. Pagination (limit/offset) ──────────────────────────────
  console.log('13. Pagination');
  const page1 = await request('GET', `/api/docs/${slug}/versions?limit=2&offset=0`);
  assert(page1.data.versions?.length === 2, `page 1: 2 items (got ${page1.data.versions?.length})`);
  assert(page1.data.total === 5, 'total still 5');

  const page2 = await request('GET', `/api/docs/${slug}/versions?limit=2&offset=2`);
  assert(page2.data.versions?.length === 2, `page 2: 2 items (got ${page2.data.versions?.length})`);

  const page3 = await request('GET', `/api/docs/${slug}/versions?limit=2&offset=4`);
  assert(page3.data.versions?.length === 1, `page 3: 1 item (got ${page3.data.versions?.length})`);
  console.log('');

  // ─── 14. Version metadata includes author ────────────────────────
  console.log('14. Version metadata');
  const v = list3.data.versions[0];
  assert(v.created_by_name === 'Version Tester', `author name (got ${v.created_by_name})`);
  assert(typeof v.content_hash === 'string' && v.content_hash.length === 64, 'hash is sha256');
  assert(typeof v.content_length === 'number', 'content_length present');
  console.log('');

  // ─── 15. No-change save still has no extra version ───────────────
  console.log('15. No-change save produces no version');
  const countBefore = (await request('GET', `/api/docs/${slug}/versions`)).data.total;
  await request('POST', `/api/docs/${slug}/save`, {
    base_version_id: restoredVersionId,
    content_markdown: '# Version 1 Content\n\nHello world.\n',
  });
  const countAfter = (await request('GET', `/api/docs/${slug}/versions`)).data.total;
  assert(countBefore === countAfter, `count unchanged: ${countBefore} → ${countAfter}`);
  console.log('');

} finally {
  server.close();
  await sql`UPDATE documents SET current_version_id = NULL WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${'%' + DOMAIN})`;
  await sql`DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${'%' + DOMAIN}))`;
  await sql`DELETE FROM document_redirects WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${'%' + DOMAIN}))`;
  await sql`DELETE FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${'%' + DOMAIN})`;
  await sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${'%' + DOMAIN})`;
  await sql`DELETE FROM users WHERE email LIKE ${'%' + DOMAIN}`;
  await closeDb();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
