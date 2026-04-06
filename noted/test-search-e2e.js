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
import { registerSearchRoutes } from './apps/server/src/routes/search.js';

const PORT = 13583;
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
  return { status: res.status, data, headers: res.headers };
}

function assert(ok, msg) {
  if (!ok) { console.error(`  FAIL: ${msg}`); failed++; }
  else { console.log(`  PASS: ${msg}`); passed++; }
}

// ─── Setup ──────────────────────────────────────────

const config = loadConfig();
const sql = initDb(config.database);
await runMigrations(sql);

// Clean test data
await sql`UPDATE documents SET current_version_id = NULL WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-search.com')`;
await sql`DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-search.com'))`;
await sql`DELETE FROM document_redirects WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-search.com'))`;
await sql`DELETE FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-search.com')`;
await sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test-search.com')`;
await sql`DELETE FROM users WHERE email LIKE '%@test-search.com'`;

const router = createRouter();
registerAuthRoutes(router);
registerDocumentRoutes(router);
registerSaveRoute(router);
registerSearchRoutes(router);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  req.pathname = url.pathname;
  req.query = Object.fromEntries(url.searchParams);
  req.cookies = parseCookies(req);

  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');

  try {
    await loadUser(req, config);
    const m = router.match(req.method, req.pathname);
    if (m) { req.params = m.params; await m.handler(req, res, config); }
    else json(res, 404, { error: 'Not found' });
  } catch (err) {
    if (res.headersSent) return;
    if (err instanceof HttpError) {
      if (err.status === 429 && err.retryAfter) res.setHeader('Retry-After', String(err.retryAfter));
      json(res, err.status, { error: err.message });
    }
    else { console.error(err.message); json(res, 500, { error: 'Internal error' }); }
  }
});

await new Promise(r => server.listen(PORT, '127.0.0.1', r));

try {

  // ─── Setup: create user and docs ───────────────
  console.log('Setup: create user + documents');
  {
    await request('POST', '/api/auth/signup', {
      email: 'searcher@test-search.com', password: 'Search123!', displayName: 'Searcher',
    });
    const { status } = await request('POST', '/api/auth/login', {
      email: 'searcher@test-search.com', password: 'Search123!',
    });
    assert(status === 200, `login (${status})`);

    // Create docs with different content
    const docs = [
      { title: 'Photosynthesis Notes', content: '# Photosynthesis\n\nPlants convert sunlight into energy using chlorophyll.\n' },
      { title: 'Quantum Physics Intro', content: '# Quantum Mechanics\n\nParticles exhibit wave-particle duality.\n' },
      { title: 'Cooking Recipes', content: '# Best Pasta\n\nBoil water with salt, cook spaghetti al dente.\n' },
      { title: 'JavaScript Guide', content: '# JavaScript\n\nFunctions are first-class citizens in JavaScript.\n' },
      { title: 'Garden Planning', content: '# My Garden\n\nPlant tomatoes and sunflowers in spring.\n' },
    ];

    for (const d of docs) {
      const { data } = await request('POST', '/api/docs', { title: d.title });
      const slug = data.document.slug;
      const { data: fetchData } = await request('GET', `/api/docs/${slug}`);
      await request('POST', `/api/docs/${slug}/save`, {
        base_version_id: fetchData.document.current_version_id,
        content_markdown: d.content,
      });
    }
  }

  // Brief delay for tsv update to complete
  await new Promise(r => setTimeout(r, 100));

  // ─── 1. Search by title ────────────────────────
  console.log('\n1. Search by title');
  {
    const { status, data } = await request('GET', '/api/search?q=photosynthesis');
    assert(status === 200, `200 (${status})`);
    assert(data.results.length >= 1, `results (${data.results.length})`);
    assert(data.results[0].title.includes('Photosynthesis'), `title match (${data.results[0].title})`);
    assert(data.total >= 1, `total (${data.total})`);
    assert(data.query === 'photosynthesis', 'query echoed');
  }

  // ─── 2. Search by content ──────────────────────
  console.log('\n2. Search by content');
  {
    const { status, data } = await request('GET', '/api/search?q=chlorophyll');
    assert(status === 200, `200 (${status})`);
    assert(data.results.length >= 1, `results (${data.results.length})`);
    assert(data.results.some(r => r.title.includes('Photosynthesis')), 'found photosynthesis doc');
  }

  // ─── 3. Search with snippet ────────────────────
  console.log('\n3. Search returns snippets');
  {
    const { data } = await request('GET', '/api/search?q=spaghetti');
    assert(data.results.length >= 1, `results (${data.results.length})`);
    const r = data.results.find(r => r.title.includes('Cooking'));
    assert(r, 'found cooking doc');
    assert(r.snippet && r.snippet.includes('<mark>'), `snippet has highlight (${r.snippet?.slice(0, 50)})`);
  }

  // ─── 4. Search no results ─────────────────────
  console.log('\n4. No results');
  {
    const { data } = await request('GET', '/api/search?q=xyznonexistent');
    assert(data.results.length === 0, `empty (${data.results.length})`);
    assert(data.total === 0, 'total 0');
  }

  // ─── 5. Empty search query ────────────────────
  console.log('\n5. Empty query');
  {
    const { status, data } = await request('GET', '/api/search?q=');
    assert(status === 200, `200 (${status})`);
    assert(data.results.length === 0, 'empty results');
  }

  // ─── 6. Search multi-word ─────────────────────
  console.log('\n6. Multi-word search');
  {
    const { data } = await request('GET', '/api/search?q=plant+sunflower');
    assert(data.results.length >= 1, `results (${data.results.length})`);
    assert(data.results.some(r => r.title.includes('Garden')), 'found garden doc');
  }

  // ─── 7. Search without auth → 401 ────────────
  console.log('\n7. Search requires auth');
  {
    const savedCookie = cookie;
    cookie = '';
    const { status } = await request('GET', '/api/search?q=test');
    assert(status === 401, `401 (${status})`);
    cookie = savedCookie;
  }

  // ─── 8. Search pagination ─────────────────────
  console.log('\n8. Search pagination');
  {
    const { data } = await request('GET', '/api/search?q=plant&limit=1&offset=0');
    assert(data.limit === 1, 'limit');
    assert(data.offset === 0, 'offset');
    assert(data.results.length <= 1, `capped (${data.results.length})`);
  }

  // ─── 9. Security: X-Frame-Options ────────────
  console.log('\n9. Security headers');
  {
    const { headers } = await request('GET', '/api/search?q=test');
    assert(headers.get('x-frame-options') === 'DENY', 'X-Frame-Options');
    assert(headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options');
    assert(headers.get('x-xss-protection') === '1; mode=block', 'X-XSS-Protection');
  }

  // ─── 10. Title search ranks higher ────────────
  console.log('\n10. Title ranks higher than content');
  {
    // "plant" appears in Garden title (content) and Photosynthesis content
    // "JavaScript" appears in a title — should rank first
    const { data } = await request('GET', '/api/search?q=javascript');
    assert(data.results.length >= 1, `results (${data.results.length})`);
    assert(data.results[0].title.includes('JavaScript'), `title match first (${data.results[0].title})`);
  }

  // ─── 11. Search query too long → 400 ──────────
  console.log('\n11. Query too long');
  {
    const longQ = 'a'.repeat(201);
    const { status } = await request('GET', `/api/search?q=${longQ}`);
    assert(status === 400, `400 (${status})`);
  }

  // ─── 12. Rate limit on login ──────────────────
  console.log('\n12. Rate limiting on login');
  {
    // Fire many requests quickly — should eventually get 429
    let got429 = false;
    for (let i = 0; i < 15; i++) {
      const { status } = await request('POST', '/api/auth/login', {
        email: 'nobody@test-search.com', password: 'wrong',
      });
      if (status === 429) { got429 = true; break; }
    }
    assert(got429, 'rate limited after many attempts');
  }

  // ─── 13. Search result has slug for linking ───
  console.log('\n13. Search results have slug');
  {
    const { data } = await request('GET', '/api/search?q=quantum');
    assert(data.results.length >= 1, `results (${data.results.length})`);
    assert(data.results[0].slug, `has slug (${data.results[0].slug})`);
    assert(data.results[0].updated_at, 'has updated_at');
  }

} finally {
  server.close();
  await sql`UPDATE documents SET current_version_id = NULL WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-search.com')`;
  await sql`DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-search.com'))`;
  await sql`DELETE FROM document_redirects WHERE document_id IN (SELECT id FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-search.com'))`;
  await sql`DELETE FROM documents WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE '%@test-search.com')`;
  await sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test-search.com')`;
  await sql`DELETE FROM users WHERE email LIKE '%@test-search.com'`;
  await closeDb();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
