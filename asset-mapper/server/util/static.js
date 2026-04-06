// server/util/static.js
import { join, extname, normalize } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};

export function serveStatic(pathname, publicDir) {
  let urlPath = pathname;
  if (urlPath === '/' || !extname(urlPath)) return null;

  // Prevent path traversal
  const safe = normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = join(publicDir, safe);

  const file = Bun.file(filePath);
  if (!file.size) return null;

  const ext = extname(filePath);
  return new Response(file, {
    headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream' },
  });
}
