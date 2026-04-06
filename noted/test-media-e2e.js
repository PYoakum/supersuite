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
import { registerMediaRoutes } from './apps/server/src/routes/media.js';

const PORT = 13582;
const BASE = `http://127.0.0.1:${PORT}`;
let cookie = '';
let passed = 0;
let failed = 0;

async function request(method, path, body, opts = {}) {
  const headers = { ...opts.headers };
  if (cookie) headers['Cookie'] = cookie;
  const fetchOpts = { method, headers, redirect: 'manual' };

  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    fetchOpts.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    fetchOpts.body = body;
  }

  fetchOpts.headers = headers;
  const res = await fetch(`${BASE}${path}`, fetchOpts);
  const sc = res.headers.get('set-cookie');
  if (sc && sc.includes('noted_sid=')) cookie = sc.split(';')[0];

  const ct = res.headers.get('content-type') || '';
  let data = null;
  if (ct.includes('json')) data = await res.json();
  return { status: res.status, data, headers: res.headers, res };
}

function assert(ok, msg) {
  if (!ok) { console.error(`  FAIL: ${msg}`); failed++; }
  else { console.log(`  PASS: ${msg}`); passed++; }
}

/** Minimal 1x1 PNG */
function createTestPng() {
  return Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00,
    0x90, 0x77, 0x53, 0xDE,
    0x00, 0x00, 0x00, 0x0C,
    0x49, 0x44, 0x41, 0x54,
    0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00,
    0x00, 0x02, 0x00, 0x01,
    0xE2, 0x21, 0xBC, 0x33,
    0x00, 0x00, 0x00, 0x00,
    0x49, 0x45, 0x4E, 0x44,
    0xAE, 0x42, 0x60, 0x82,
  ]);
}

function uploadForm(filename, mimeType, buffer) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  return form;
}

// ─── Setup in-process server ──────────────────────────────

const config = loadConfig();
const sql = initDb(config.database);
await runMigrations(sql);

// Clean test data
await sql`DELETE FROM media WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-media.com')`;
await sql`UPDATE documents SET current_version_id = NULL WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-media.com')`;
await sql`DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-media.com'))`;
await sql`DELETE FROM document_redirects WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-media.com'))`;
await sql`DELETE FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-media.com')`;
await sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test-media.com')`;
await sql`DELETE FROM users WHERE email LIKE '%@test-media.com'`;

const router = createRouter();
registerAuthRoutes(router);
registerDocumentRoutes(router);
registerSaveRoute(router);
registerMediaRoutes(router);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  req.pathname = url.pathname;
  req.query = Object.fromEntries(url.searchParams);
  req.cookies = parseCookies(req);
  try {
    await loadUser(req, config);
    const m = router.match(req.method, req.pathname);
    if (m) {
      req.params = m.params;
      await m.handler(req, res, config);
    } else {
      json(res, 404, { error: 'Not found' });
    }
  } catch (err) {
    if (res.headersSent) return;
    if (err instanceof HttpError) json(res, err.status, { error: err.message });
    else { console.error('Test server error:', err.message); json(res, 500, { error: 'Internal error' }); }
  }
});

await new Promise(r => server.listen(PORT, '127.0.0.1', r));

try {
  // ─── Setup: signup + login ────────────────────
  console.log('Setup: auth');
  {
    await request('POST', '/api/auth/signup', {
      email: 'uploader@test-media.com', password: 'MediaPass1!', displayName: 'Uploader',
    });
    const { status } = await request('POST', '/api/auth/login', {
      email: 'uploader@test-media.com', password: 'MediaPass1!',
    });
    assert(status === 200, `login (${status})`);
  }

  let mediaId, mediaUrl, secondId;

  // ─── 1. Upload PNG ────────────────────────────
  console.log('\n1. Upload PNG image');
  {
    const form = uploadForm('test.png', 'image/png', createTestPng());
    const { status, data } = await request('POST', '/api/media/upload', form);
    assert(status === 201, `201 (${status})`);
    assert(data.media, 'media object');
    assert(data.media.kind === 'image', `kind=image (${data.media.kind})`);
    assert(data.media.mime_type === 'image/png', `mime=image/png (${data.media.mime_type})`);
    assert(data.media.byte_size > 0, `size>0 (${data.media.byte_size})`);
    assert(data.media.width === 1, `width=1 (${data.media.width})`);
    assert(data.media.height === 1, `height=1 (${data.media.height})`);
    assert(data.media.url.startsWith('/media/'), `url prefix (${data.media.url})`);
    assert(data.media.id, 'has id');
    mediaId = data.media.id;
    mediaUrl = data.media.url;
  }

  // ─── 2. Serve the file ────────────────────────
  console.log('\n2. Serve uploaded file');
  {
    const res = await fetch(`${BASE}${mediaUrl}`);
    assert(res.status === 200, `200 (${res.status})`);
    assert(res.headers.get('content-type') === 'image/png', 'content-type');
    assert(res.headers.get('cache-control')?.includes('immutable'), 'cache immutable');
    const buf = await res.arrayBuffer();
    assert(buf.byteLength > 0, `body (${buf.byteLength}B)`);
  }

  // ─── 3. Serve without auth (media is public) ──
  console.log('\n3. Serve without auth');
  {
    const res = await fetch(`${BASE}${mediaUrl}`);
    assert(res.status === 200, `public serve (${res.status})`);
  }

  // ─── 4. List media ────────────────────────────
  console.log('\n4. List media');
  {
    const { status, data } = await request('GET', '/api/media');
    assert(status === 200, `200 (${status})`);
    assert(Array.isArray(data.media), 'array');
    assert(data.media.length >= 1, `count (${data.media.length})`);
    assert(data.total >= 1, `total (${data.total})`);
    assert(data.media.find(m => m.id === mediaId), 'found uploaded');
  }

  // ─── 5. Upload second file ────────────────────
  console.log('\n5. Upload second');
  {
    const form = uploadForm('second.png', 'image/png', createTestPng());
    const { status, data } = await request('POST', '/api/media/upload', form);
    assert(status === 201, `201 (${status})`);
    secondId = data.media.id;
    assert(secondId !== mediaId, 'different id');
  }

  // ─── 6. List shows both ───────────────────────
  console.log('\n6. List shows both');
  {
    const { data } = await request('GET', '/api/media');
    assert(data.media.length >= 2, `count >= 2 (${data.media.length})`);
  }

  // ─── 7. Filter by kind ────────────────────────
  console.log('\n7. Filter by kind');
  {
    const { data: imgs } = await request('GET', '/api/media?kind=image');
    assert(imgs.media.length >= 2, `images (${imgs.media.length})`);
    const { data: vids } = await request('GET', '/api/media?kind=video');
    assert(vids.media.length === 0, `no videos (${vids.media.length})`);
  }

  // ─── 8. Delete media ──────────────────────────
  console.log('\n8. Delete media');
  {
    const { status } = await request('DELETE', `/api/media/${secondId}`);
    assert(status === 200, `200 (${status})`);
    const { data } = await request('GET', '/api/media');
    assert(!data.media.find(m => m.id === secondId), 'gone from list');
  }

  // ─── 9. Serve deleted → 404 ───────────────────
  console.log('\n9. Deleted → 404');
  {
    const res = await fetch(`${BASE}/media/${secondId}`);
    assert(res.status === 404, `404 (${res.status})`);
    await res.text(); // drain
  }

  // ─── 10. Reject invalid type ──────────────────
  console.log('\n10. Reject invalid type');
  {
    const form = uploadForm('bad.exe', 'application/x-msdownload', Buffer.from('MZ'));
    const { status, data } = await request('POST', '/api/media/upload', form);
    assert(status === 400, `400 (${status})`);
    assert(data.error.includes('Unsupported'), `msg (${data.error})`);
  }

  // ─── 11. Reject missing file ──────────────────
  console.log('\n11. Reject missing file');
  {
    const form = new FormData();
    form.append('notfile', 'hello');
    const { status } = await request('POST', '/api/media/upload', form);
    assert(status === 400, `400 (${status})`);
  }

  // ─── 12. Reject without auth ──────────────────
  console.log('\n12. Reject without auth');
  {
    const form = uploadForm('noauth.png', 'image/png', createTestPng());
    const res = await fetch(`${BASE}/api/media/upload`, { method: 'POST', body: form });
    assert(res.status === 401, `401 (${res.status})`);
    await res.text();
  }

  // ─── 13. Embed in doc ─────────────────────────
  console.log('\n13. Embed in document');
  {
    // Create doc
    const { data: docData } = await request('POST', '/api/docs', { title: 'Embed Test' });
    const slug = docData.document.slug;

    // Fetch current version
    const { data: fetchData } = await request('GET', `/api/docs/${slug}`);
    const baseVid = fetchData.document.current_version_id;

    // Save with embedded image
    const md = `# With Image\n\n![photo](${mediaUrl})\n`;
    const { status, data } = await request('POST', `/api/docs/${slug}/save`, {
      base_version_id: baseVid, content_markdown: md,
    });
    assert(status === 200, `save (${status})`);

    // Verify HTML render
    const { data: d2 } = await request('GET', `/api/docs/${slug}`);
    assert(d2.document.content_html.includes('<img'), 'html has <img>');
    assert(d2.document.content_html.includes(mediaUrl), 'html has media url');
  }

  // ─── 14. Delete non-existent → 404 ────────────
  console.log('\n14. Delete non-existent → 404');
  {
    const { status } = await request('DELETE', '/api/media/00000000-0000-0000-0000-000000000000');
    assert(status === 404, `404 (${status})`);
  }

  // ─── 15. Pagination ───────────────────────────
  console.log('\n15. Pagination');
  {
    const { data } = await request('GET', '/api/media?limit=1&offset=0');
    assert(data.media.length <= 1, `limit (${data.media.length})`);
    assert(data.limit === 1, 'limit in resp');
    assert(data.offset === 0, 'offset in resp');
  }

  // ─── 16. Invalid media ID → 400 ───────────────
  console.log('\n16. Invalid media ID');
  {
    const res = await fetch(`${BASE}/media/not-a-uuid`);
    assert(res.status === 400, `400 (${res.status})`);
    await res.text();
  }

} finally {
  server.close();
  await sql`DELETE FROM media WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-media.com')`;
  await sql`UPDATE documents SET current_version_id = NULL WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-media.com')`;
  await sql`DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-media.com'))`;
  await sql`DELETE FROM document_redirects WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-media.com'))`;
  await sql`DELETE FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-media.com')`;
  await sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test-media.com')`;
  await sql`DELETE FROM users WHERE email LIKE '%@test-media.com'`;
  await closeDb();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
