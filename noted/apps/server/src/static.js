import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const WEB_PUBLIC = resolve(__dirname, '../../web/public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/**
 * HTML page route map — clean URLs to HTML files.
 */
const PAGE_ROUTES = {
  '/': 'index.html',
  '/login': 'login.html',
  '/profile': 'profile.html',
};

/**
 * Dynamic page routes — patterns that map to HTML files.
 * Matched after static PAGE_ROUTES.
 */
const DYNAMIC_PAGES = [
  { prefix: '/d/', file: 'viewer.html' },
  { prefix: '/e/', file: 'editor.html' },
];

/**
 * Try to serve a static file or page route.
 * Returns true if handled, false if not found.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {boolean}
 */
export function serveStatic(req, res) {
  const pathname = req.pathname;

  // Check page routes first (clean URLs)
  if (PAGE_ROUTES[pathname]) {
    return sendFile(res, join(WEB_PUBLIC, PAGE_ROUTES[pathname]));
  }

  // Check dynamic page routes (e.g., /d/:slug, /e/:slug)
  for (const route of DYNAMIC_PAGES) {
    if (pathname.startsWith(route.prefix) && pathname.length > route.prefix.length) {
      return sendFile(res, join(WEB_PUBLIC, route.file));
    }
  }

  // Try to serve as a static file
  const safePath = pathname.replace(/\.\./g, '');
  const filePath = join(WEB_PUBLIC, safePath);

  // Prevent directory traversal
  if (!filePath.startsWith(WEB_PUBLIC)) return false;

  return sendFile(res, filePath);
}

/**
 * Send a file from disk.
 */
function sendFile(res, filePath) {
  if (!existsSync(filePath)) return false;

  const stat = statSync(filePath);
  if (!stat.isFile()) return false;

  const ext = extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const content = readFileSync(filePath);

    // ETag for conditional requests
    const etag = `"${stat.size.toString(36)}-${stat.mtimeMs.toString(36)}"`;

    // Cache strategy: HTML = no-cache, CSS/JS = 1h, fonts/images = 1 week
    let cacheControl = 'public, max-age=3600';
    if (ext === '.html') cacheControl = 'no-cache';
    else if (['.woff2', '.woff', '.png', '.jpg', '.gif', '.svg', '.ico'].includes(ext)) {
      cacheControl = 'public, max-age=604800';
    }

    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': content.length,
      'Cache-Control': cacheControl,
      'ETag': etag,
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}
