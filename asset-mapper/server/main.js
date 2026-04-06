// server/main.js — Bun HTTP server entry point
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import logger from './util/logger.js';
import { serveStatic } from './util/static.js';
import { route } from './router.js';
import { migrate, seed } from './migrate.js';
import { jsonResponse } from './util/json.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '../public');

// Run migrations + seed
migrate();
seed();

const server = Bun.serve({
  port: config.port,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS headers for development
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    logger.debug(`${req.method} ${url.pathname}`);

    try {
      // API routes
      if (url.pathname.startsWith('/api/')) {
        const response = await route(req, url);
        if (response === null) {
          return jsonResponse(404, { error: 'Not found' }, corsHeaders);
        }
        // Merge CORS headers into the response
        const merged = new Response(response.body, response);
        for (const [k, v] of Object.entries(corsHeaders)) {
          merged.headers.set(k, v);
        }
        return merged;
      }

      // Static files
      const staticResponse = serveStatic(url.pathname, PUBLIC_DIR);
      if (staticResponse) return staticResponse;

      // SPA fallback — serve index.html for unknown paths
      return new Response(Bun.file(join(PUBLIC_DIR, 'index.html')));
    } catch (err) {
      logger.error('Request error:', err);
      return jsonResponse(500, { error: 'Internal server error' }, corsHeaders);
    }
  },
});

logger.info(`asset-map running → http://localhost:${server.port}`);
