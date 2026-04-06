import { createServer } from 'node:http';
import { loadConfig } from './apps/server/src/config.js';
import { initDb, closeDb, getDb } from './apps/server/src/db/connection.js';
import { runMigrations } from './apps/server/src/db/migrate.js';
import { createRouter } from './apps/server/src/router.js';
import { json, HttpError, parseCookies } from './apps/server/src/http.js';
import { loadUser } from './apps/server/src/middleware/auth.js';
import { registerAuthRoutes } from './apps/server/src/routes/auth.js';
import { registerDocumentRoutes } from './apps/server/src/routes/documents.js';
import { registerSaveRoute } from './apps/server/src/routes/save.js';

const PORT = 13580;
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

// Clean test data
await sql`UPDATE documents SET current_version_id = NULL WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-docs.com')`;
await sql`DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-docs.com'))`;
await sql`DELETE FROM document_redirects WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-docs.com'))`;
await sql`DELETE FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-docs.com')`;
await sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test-docs.com')`;
await sql`DELETE FROM users WHERE email LIKE '%@test-docs.com'`;

const router = createRouter();
registerAuthRoutes(router);
registerDocumentRoutes(router);
registerSaveRoute(router);

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
  // ─── Setup: Create test user ────────────────────────────────────
  console.log('0. Setup — create user');
  const signup = await request('POST', '/api/auth/signup', {
    email: 'doctest@test-docs.com',
    password: 'password123',
    displayName: 'Doc Tester',
  });
  assert(signup.status === 201, `signup 201 (got ${signup.status})`);
  console.log('');

  // ─── 1. Create document ─────────────────────────────────────────
  console.log('1. Create document');
  const create = await request('POST', '/api/docs', { title: 'My First Note' });
  assert(create.status === 201, `201 (got ${create.status})`);
  assert(create.data.document?.slug === 'my-first-note', `slug = my-first-note (got ${create.data.document?.slug})`);
  assert(create.data.document?.title === 'My First Note', 'title matches');
  const slug1 = create.data.document.slug;
  console.log('');

  // ─── 2. Create another document (same title → different slug) ──
  console.log('2. Create duplicate title');
  const create2 = await request('POST', '/api/docs', { title: 'My First Note' });
  assert(create2.status === 201, `201 (got ${create2.status})`);
  assert(create2.data.document?.slug === 'my-first-note-2', `slug = my-first-note-2 (got ${create2.data.document?.slug})`);
  console.log('');

  // ─── 3. List documents ──────────────────────────────────────────
  console.log('3. List documents');
  const list = await request('GET', '/api/docs');
  assert(list.status === 200, `200 (got ${list.status})`);
  assert(list.data.documents?.length === 2, `2 docs (got ${list.data.documents?.length})`);
  console.log('');

  // ─── 4. Fetch document by slug ──────────────────────────────────
  console.log('4. Fetch document');
  const fetch1 = await request('GET', `/api/docs/${slug1}`);
  assert(fetch1.status === 200, `200 (got ${fetch1.status})`);
  assert(fetch1.data.document?.content_markdown !== undefined, 'content_markdown present');
  assert(fetch1.data.document?.current_version_id !== null, 'has version id');
  console.log('');

  // ─── 5. Save content ────────────────────────────────────────────
  console.log('5. Save content');
  const versionId = fetch1.data.document.current_version_id;
  const save1 = await request('POST', `/api/docs/${slug1}/save`, {
    base_version_id: versionId,
    content_markdown: '# Hello World\n\nThis is a test.\n',
  });
  assert(save1.status === 200, `200 (got ${save1.status})`);
  assert(save1.data.changed === true, 'changed = true');
  assert(save1.data.version_id !== versionId, 'new version id');
  console.log('');

  // ─── 6. Save same content again → no change ────────────────────
  console.log('6. Save same content (no change)');
  const save2 = await request('POST', `/api/docs/${slug1}/save`, {
    base_version_id: save1.data.version_id,
    content_markdown: '# Hello World\n\nThis is a test.\n',
  });
  assert(save2.status === 200, `200 (got ${save2.status})`);
  assert(save2.data.changed === false, 'changed = false');
  console.log('');

  // ─── 7. Save different content → new version ───────────────────
  console.log('7. Save different content');
  const save3 = await request('POST', `/api/docs/${slug1}/save`, {
    base_version_id: save1.data.version_id,
    content_markdown: '# Hello World\n\nThis is updated.\n',
  });
  assert(save3.status === 200, `200 (got ${save3.status})`);
  assert(save3.data.changed === true, 'changed = true');
  assert(save3.data.version_id !== save1.data.version_id, 'different version id');
  console.log('');

  // ─── 8. Update title → slug change + redirect ──────────────────
  console.log('8. Update title (slug change + redirect)');
  const update = await request('PUT', `/api/docs/${slug1}`, { title: 'Renamed Note' });
  assert(update.status === 200, `200 (got ${update.status})`);
  assert(update.data.document?.slug === 'renamed-note', `new slug = renamed-note (got ${update.data.document?.slug})`);
  assert(update.data.document?.title === 'Renamed Note', 'title updated');
  const newSlug = update.data.document.slug;
  console.log('');

  // ─── 9. Old slug returns redirect ──────────────────────────────
  console.log('9. Old slug → redirect');
  const redirect = await request('GET', `/api/docs/${slug1}`);
  assert(redirect.status === 301, `301 (got ${redirect.status})`);
  assert(redirect.data.slug === newSlug, `redirects to ${newSlug} (got ${redirect.data.slug})`);
  console.log('');

  // ─── 10. New slug works ─────────────────────────────────────────
  console.log('10. New slug works');
  const fetchNew = await request('GET', `/api/docs/${newSlug}`);
  assert(fetchNew.status === 200, `200 (got ${fetchNew.status})`);
  assert(fetchNew.data.document?.title === 'Renamed Note', 'correct title');
  console.log('');

  // ─── 11. Toggle public ──────────────────────────────────────────
  console.log('11. Toggle public');
  const pub = await request('PUT', `/api/docs/${newSlug}`, { isPublic: true });
  assert(pub.status === 200, `200 (got ${pub.status})`);
  assert(pub.data.document?.is_public === true, 'is_public = true');
  console.log('');

  // ─── 12. Public access without auth ─────────────────────────────
  console.log('12. Public access (no auth)');
  const savedCookie = sessionCookie;
  sessionCookie = '';
  const pubFetch = await request('GET', `/api/docs/${newSlug}`);
  assert(pubFetch.status === 200, `200 (got ${pubFetch.status})`);
  assert(pubFetch.data.document?.title === 'Renamed Note', 'can read public doc');
  console.log('');

  // ─── 13. Private doc not accessible without auth ────────────────
  console.log('13. Private doc without auth');
  const slug2 = create2.data.document.slug;
  const privateFetch = await request('GET', `/api/docs/${slug2}`);
  assert(privateFetch.status === 401, `401 (got ${privateFetch.status})`);
  sessionCookie = savedCookie;
  console.log('');

  // ─── 14. Delete document ────────────────────────────────────────
  console.log('14. Delete document');
  const del = await request('DELETE', `/api/docs/${slug2}`);
  assert(del.status === 200, `200 (got ${del.status})`);

  const listAfter = await request('GET', '/api/docs');
  assert(listAfter.data.documents?.length === 1, `1 doc remaining (got ${listAfter.data.documents?.length})`);
  console.log('');

  // ─── 15. Optimistic concurrency (409) ───────────────────────────
  console.log('15. Optimistic concurrency conflict');
  const conflict = await request('POST', `/api/docs/${newSlug}/save`, {
    base_version_id: versionId,  // stale version id
    content_markdown: '# Conflict test\n',
  });
  assert(conflict.status === 409, `409 (got ${conflict.status})`);
  console.log('');

  // ─── 16. Chain redirect (rename twice) ──────────────────────────
  console.log('16. Chain redirect');
  const rename2 = await request('PUT', `/api/docs/${newSlug}`, { title: 'Double Renamed' });
  assert(rename2.status === 200, `200 (got ${rename2.status})`);
  const finalSlug = rename2.data.document.slug;

  // Original slug should still resolve through the chain
  const chainRedirect = await request('GET', `/api/docs/${slug1}`);
  assert(chainRedirect.status === 301, `301 (got ${chainRedirect.status})`);
  assert(chainRedirect.data.slug === finalSlug, `chain resolves to ${finalSlug} (got ${chainRedirect.data.slug})`);
  console.log('');

} finally {
  server.close();
  // Cleanup
  await sql`UPDATE documents SET current_version_id = NULL WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-docs.com')`;
  await sql`DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-docs.com'))`;
  await sql`DELETE FROM document_redirects WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-docs.com'))`;
  await sql`DELETE FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-docs.com')`;
  await sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test-docs.com')`;
  await sql`DELETE FROM users WHERE email LIKE '%@test-docs.com'`;
  await closeDb();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
