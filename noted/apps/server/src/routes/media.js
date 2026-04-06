import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { json, HttpError } from '../http.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit, getClientIp } from '../middleware/ratelimit.js';
import { parseMultipart } from '../multipart.js';
import { createMedia, getMediaById, listMedia, deleteMedia } from '../db/media.js';

/** Allowed MIME types and their kind mapping. */
const ALLOWED_TYPES = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/svg+xml': 'image',
  'image/avif': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/ogg': 'video',
  'video/quicktime': 'video',
};

const MIME_TO_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogg',
  'video/quicktime': '.mov',
};

/**
 * Register media routes.
 * @param {import('../router.js').Router} router
 */
export function registerMediaRoutes(router) {

  // ─── POST /api/media/upload — upload file ─────────────────────
  router.post('/api/media/upload', async (req, res, config) => {
    requireAuth(req);
    rateLimit(`upload:${req.user.id}`, 30, HttpError);

    const { fields, files } = await parseMultipart(req);
    const file = files.file;

    if (!file) throw new HttpError(400, 'No file provided (use field name "file")');
    if (!file.data || file.data.length === 0) throw new HttpError(400, 'Empty file');

    // Validate MIME type
    const kind = ALLOWED_TYPES[file.mimeType];
    if (!kind) {
      throw new HttpError(400, `Unsupported file type: ${file.mimeType}. Allowed: ${Object.keys(ALLOWED_TYPES).join(', ')}`);
    }

    // Size limit (from config or default 20MB)
    const maxSize = 20 * 1024 * 1024;
    if (file.data.length > maxSize) {
      throw new HttpError(400, `File too large (${(file.data.length / 1024 / 1024).toFixed(1)}MB). Max: ${maxSize / 1024 / 1024}MB`);
    }

    // Ensure storage directory exists
    const mediaPath = config.storage.media_path;
    await mkdir(mediaPath, { recursive: true });

    // Generate unique filename: YYYY/MM/uuid.ext
    const now = new Date();
    const subDir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
    const ext = MIME_TO_EXT[file.mimeType] || extname(file.filename) || '';
    const fileName = randomUUID() + ext;
    const relPath = join(subDir, fileName);
    const absPath = join(mediaPath, relPath);

    // Create subdirectory and write file
    await mkdir(join(mediaPath, subDir), { recursive: true });
    await writeFile(absPath, file.data);

    // Get image dimensions (basic approach for common formats)
    let width = null, height = null;
    if (kind === 'image' && file.mimeType === 'image/png') {
      const dims = parsePngDimensions(file.data);
      if (dims) { width = dims.width; height = dims.height; }
    } else if (kind === 'image' && file.mimeType === 'image/jpeg') {
      const dims = parseJpegDimensions(file.data);
      if (dims) { width = dims.width; height = dims.height; }
    }

    // Create DB record
    const media = await createMedia({
      ownerUserId: req.user.id,
      kind,
      storagePath: relPath,
      mimeType: file.mimeType,
      byteSize: file.data.length,
      width,
      height,
    });

    json(res, 201, {
      media: formatMedia(media, config),
    });
  });

  // ─── GET /media/:id — serve file ──────────────────────────────
  router.get('/media/:id', async (req, res, config) => {
    const { id } = req.params;

    // Validate UUID format
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new HttpError(400, 'Invalid media ID');
    }

    const media = await getMediaById(id);
    if (!media) throw new HttpError(404, 'Media not found');

    const absPath = join(config.storage.media_path, media.storage_path);
    if (!existsSync(absPath)) {
      throw new HttpError(404, 'File not found on disk');
    }

    // Set headers
    const fileStat = await stat(absPath);
    res.setHeader('Content-Type', media.mime_type);
    res.setHeader('Content-Length', fileStat.size);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Accept-Ranges', 'bytes');

    // Stream the file
    res.statusCode = 200;
    const stream = createReadStream(absPath);
    stream.pipe(res);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('File read error');
      }
    });
  });

  // ─── GET /api/media — list user's media ───────────────────────
  router.get('/api/media', async (req, res, config) => {
    requireAuth(req);

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const kind = req.query.kind; // optional filter

    const { media, total } = await listMedia(req.user.id, { limit, offset, kind });

    json(res, 200, {
      media: media.map(m => formatMedia(m, config)),
      total,
      limit,
      offset,
    });
  });

  // ─── DELETE /api/media/:id — delete media ─────────────────────
  router.delete('/api/media/:id', async (req, res, config) => {
    requireAuth(req);
    const { id } = req.params;

    const deleted = await deleteMedia(id, req.user.id);
    if (!deleted) throw new HttpError(404, 'Media not found');

    // Try to delete file from disk
    try {
      const absPath = join(config.storage.media_path, deleted.storage_path);
      await unlink(absPath);
    } catch {
      // File already gone or inaccessible — not critical
    }

    json(res, 200, { ok: true });
  });
}

/**
 * Format a media row for API responses.
 */
function formatMedia(m, config) {
  return {
    id: m.id,
    kind: m.kind,
    mime_type: m.mime_type,
    byte_size: m.byte_size,
    width: m.width,
    height: m.height,
    duration: m.duration,
    url: `/media/${m.id}`,
    created_at: m.created_at,
  };
}

// ─── Dimension parsers (basic, no dependencies) ─────────────────

function parsePngDimensions(buf) {
  // PNG IHDR chunk: bytes 16-23 contain width (4 bytes) and height (4 bytes)
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50) return null; // Not PNG
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function parseJpegDimensions(buf) {
  // JPEG: scan for SOFn markers (0xFF 0xC0-0xCF, except 0xC4 and 0xCC)
  if (buf.length < 2 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let pos = 2;
  while (pos < buf.length - 1) {
    if (buf[pos] !== 0xFF) { pos++; continue; }
    const marker = buf[pos + 1];
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xCC) {
      // SOF marker found
      if (pos + 9 < buf.length) {
        return {
          height: buf.readUInt16BE(pos + 5),
          width: buf.readUInt16BE(pos + 7),
        };
      }
    }
    // Skip to next marker
    if (pos + 3 < buf.length) {
      const len = buf.readUInt16BE(pos + 2);
      pos += 2 + len;
    } else {
      break;
    }
  }
  return null;
}
