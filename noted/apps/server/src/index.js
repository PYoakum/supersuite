import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { initDb, closeDb } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { createRouter } from './router.js';
import { json, HttpError, parseCookies } from './http.js';
import { loadUser } from './middleware/auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { registerSaveRoute } from './routes/save.js';
import { registerVersionRoutes } from './routes/versions.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerOrganizeRoutes } from './routes/organize.js';
import { serveStatic } from './static.js';

// ─── Router setup ──────────────────────────────────────────────────
const router = createRouter();

const NOT_FOUND_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>404 — Noted</title><link rel="stylesheet" href="/styles.css"></head><body>
<nav class="nav"><a href="/" class="nav-brand">Noted</a></nav>
<div class="container" style="text-align:center;padding-top:4rem;">
<h1 style="font-size:3rem;margin-bottom:0.5rem;color:var(--text-muted)">404</h1>
<p style="font-size:1.1rem;color:var(--text-muted)">Page not found.</p>
<a href="/" class="btn btn-primary" style="margin-top:1rem;">Go to Dashboard</a>
</div></body></html>`;

// Health check
router.get('/api/health', async (req, res) => {
  json(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
});

// Register route modules
registerAuthRoutes(router);
registerDocumentRoutes(router);
registerSaveRoute(router);
registerVersionRoutes(router);
registerMediaRoutes(router);
registerSearchRoutes(router);
registerOrganizeRoutes(router);

// ─── Request handler ───────────────────────────────────────────────
function handleRequest(config) {
  return async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // Attach parsed helpers to request
    req.pathname = pathname;
    req.query = Object.fromEntries(url.searchParams);
    req.cookies = parseCookies(req);

    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    // CORS — same-origin only
    const origin = req.headers.origin;
    if (origin && origin !== config.server.public_url) {
      json(res, 403, { error: 'Cross-origin request denied' });
      return;
    }

    // Content-Length guard for non-streaming routes (10MB default, media has its own)
    const contentLength = parseInt(req.headers['content-length'] || '0');
    if (contentLength > 10 * 1024 * 1024 && !pathname.startsWith('/api/media')) {
      json(res, 413, { error: 'Request body too large' });
      return;
    }

    try {
      // Load authenticated user for all requests
      await loadUser(req, config);

      // 1. Try API routes
      const matched = router.match(req.method, pathname);
      if (matched) {
        req.params = matched.params;
        await matched.handler(req, res, config);
        return;
      }

      // 2. Try static files / page routes (GET only)
      if (req.method === 'GET') {
        const served = serveStatic(req, res);
        if (served) return;
      }

      // 3. Not found
      const accept = req.headers['accept'] || '';
      if (accept.includes('text/html')) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(NOT_FOUND_HTML);
      } else {
        json(res, 404, { error: 'Not found' });
      }
    } catch (err) {
      if (res.headersSent) return;
      if (err instanceof HttpError) {
        if (err.status === 429 && err.retryAfter) {
          res.setHeader('Retry-After', String(err.retryAfter));
        }
        json(res, err.status, { error: err.message });
      } else {
        console.error('[server] Unhandled error:', err);
        json(res, 500, { error: 'Internal server error' });
      }
    }
  };
}

// ─── Bootstrap ─────────────────────────────────────────────────────
async function main() {
  console.log('[noted] Starting...');

  // 1. Load configuration
  const config = loadConfig();
  console.log(`[noted] Config loaded: ${config.server.host}:${config.server.port}`);

  // 2. Connect to database
  let dbReady = false;
  try {
    const sql = initDb(config.database);
    const [{ now }] = await sql`SELECT now()`;
    console.log(`[noted] Database connected (server time: ${now})`);
    dbReady = true;
  } catch (err) {
    console.error('[noted] Database connection failed:', err.message);
    console.error('[noted] API endpoints requiring DB will return errors.');
  }

  // 3. Auto-run migrations if DB is connected
  if (dbReady) {
    try {
      await runMigrations(initDb(config.database));
    } catch (err) {
      console.warn('[noted] Auto-migration issue:', err.message);
    }
  }

  // 4. Start HTTP server
  const server = createServer(handleRequest(config));

  server.listen(config.server.port, config.server.host, () => {
    console.log(`[noted] Server listening on http://${config.server.host}:${config.server.port}`);
    console.log(`[noted] Public URL: ${config.server.public_url}`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[noted] Received ${signal}, shutting down...`);
    server.close();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[noted] Fatal error:', err);
  process.exit(1);
});

export { router };
