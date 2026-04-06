import { join } from "path";

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * Serve static files from the given directory.
 * Returns a Response if a file is found, or null to continue routing.
 */
export async function serveStatic(pathname, publicDir) {
  // Prevent directory traversal
  const safePath = pathname.replace(/\.\./g, "");
  const filePath = join(publicDir, safePath);

  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) return null;

    const ext = filePath.substring(filePath.lastIndexOf("."));
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    return new Response(file, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return null;
  }
}
