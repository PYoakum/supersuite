import { createServer } from 'node:http';
import { loadConfig } from './apps/server/src/config.js';
import { initDb, closeDb } from './apps/server/src/db/connection.js';
import { runMigrations } from './apps/server/src/db/migrate.js';
import { createRouter } from './apps/server/src/router.js';
import { json, HttpError, parseCookies } from './apps/server/src/http.js';
import { loadUser } from './apps/server/src/middleware/auth.js';
import { registerAuthRoutes } from './apps/server/src/routes/auth.js';

const PORT = 13579;
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

// -- Set up server in-process --
const config = loadConfig();
const sql = initDb(config.database);
await runMigrations(sql);

// Clean test data
await sql`DELETE FROM sessions`;
await sql`DELETE FROM users WHERE email LIKE '%@test-e2e.com'`;

const router = createRouter();
router.get('/api/health', (req, res) => json(res, 200, { ok: true }));
registerAuthRoutes(router);

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
  // -- Tests --
  console.log('1. Signup');
  const s = await request('POST', '/api/auth/signup', { email: 'a@test-e2e.com', password: 'password123', displayName: 'Alice' });
  assert(s.status === 201, `201 (got ${s.status})`);
  assert(s.data.user?.email === 'a@test-e2e.com', 'email');
  assert(s.data.user?.displayName === 'Alice', 'displayName');
  assert(sessionCookie.includes('noted_sid'), 'cookie set');

  console.log('\n2. GET /api/me');
  const me = await request('GET', '/api/me');
  assert(me.status === 200, `200 (got ${me.status})`);
  assert(me.data.user?.role === 'editor', 'default role');

  console.log('\n3. Update profile');
  const up = await request('PUT', '/api/me', { displayName: 'Alice W.' });
  assert(up.status === 200, `200 (got ${up.status})`);
  assert(up.data.user?.displayName === 'Alice W.', 'name updated');

  console.log('\n4. Dup signup');
  const dup = await request('POST', '/api/auth/signup', { email: 'a@test-e2e.com', password: 'otherpass1', displayName: 'X' });
  assert(dup.status === 409, `409 (got ${dup.status})`);

  console.log('\n5. Short password');
  const sh = await request('POST', '/api/auth/signup', { email: 'b@test-e2e.com', password: '123' });
  assert(sh.status === 400, `400 (got ${sh.status})`);

  console.log('\n6. Logout');
  const lo = await request('POST', '/api/auth/logout');
  assert(lo.status === 200, `200 (got ${lo.status})`);

  console.log('\n7. /api/me after logout');
  sessionCookie = '';
  const mea = await request('GET', '/api/me');
  assert(mea.status === 401, `401 (got ${mea.status})`);

  console.log('\n8. Wrong password');
  const wp = await request('POST', '/api/auth/login', { email: 'a@test-e2e.com', password: 'wrong' });
  assert(wp.status === 401, `401 (got ${wp.status})`);

  console.log('\n9. Correct login');
  const li = await request('POST', '/api/auth/login', { email: 'a@test-e2e.com', password: 'password123' });
  assert(li.status === 200, `200 (got ${li.status})`);
  assert(li.data.user?.email === 'a@test-e2e.com', 'correct user');

  console.log('\n10. Session valid after re-login');
  const me2 = await request('GET', '/api/me');
  assert(me2.status === 200, `200 (got ${me2.status})`);
  assert(me2.data.user?.displayName === 'Alice W.', 'profile persisted');

} finally {
  server.close();
  await sql`DELETE FROM sessions`;
  await sql`DELETE FROM users WHERE email LIKE '%@test-e2e.com'`;
  await closeDb();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
