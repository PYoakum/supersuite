/**
 * File upload management - save, index, delete uploaded media
 */

import { readdir, unlink, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { probe } from "./ffprobe.js";

let uploadsDir = "data/uploads";
let thumbnailsDir = "data/thumbnails";

const fileIndex = new Map(); // id -> { id, filename, originalName, path, metadata, uploadedAt }

export function configure(config) {
  uploadsDir = config.storage?.uploads_dir || "data/uploads";
  thumbnailsDir = config.storage?.thumbnails_dir || "data/thumbnails";
}

export async function init() {
  await mkdir(uploadsDir, { recursive: true });
  await mkdir(thumbnailsDir, { recursive: true });

  // Scan existing uploads
  const entries = await readdir(uploadsDir);
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const filePath = join(uploadsDir, entry);
    const stat = await Bun.file(filePath).exists() ? Bun.file(filePath) : null;
    if (!stat) continue;

    // Extract id from filename (id_originalname.ext)
    const dashIdx = entry.indexOf("_");
    const id = dashIdx > 0 ? entry.slice(0, dashIdx) : entry;
    const originalName = dashIdx > 0 ? entry.slice(dashIdx + 1) : entry;

    let metadata = {};
    try {
      metadata = await probe(filePath);
    } catch { /* non-media files */ }

    fileIndex.set(id, {
      id,
      filename: entry,
      originalName,
      path: filePath,
      metadata,
      uploadedAt: new Date().toISOString(),
    });
  }
}

function sanitizeFilename(name) {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 200);
}

export async function saveFile(file) {
  const id = crypto.randomUUID();
  const safeName = sanitizeFilename(file.name);
  const filename = `${id}_${safeName}`;
  const filePath = join(uploadsDir, filename);

  await Bun.write(filePath, file);

  let metadata = {};
  try {
    metadata = await probe(filePath);
  } catch { /* non-media or probe not available */ }

  const entry = {
    id,
    filename,
    originalName: file.name,
    path: filePath,
    metadata,
    uploadedAt: new Date().toISOString(),
  };

  fileIndex.set(id, entry);
  return entry;
}

export function listFiles() {
  return Array.from(fileIndex.values()).map(f => ({
    id: f.id,
    name: f.originalName,
    filename: f.filename,
    metadata: f.metadata,
    uploadedAt: f.uploadedAt,
  }));
}

export function getFile(id) {
  return fileIndex.get(id) || null;
}

export async function deleteFile(id) {
  const entry = fileIndex.get(id);
  if (!entry) return false;

  try { await unlink(entry.path); } catch { /* already gone */ }

  // Remove thumbnail if exists
  const thumbPath = join(thumbnailsDir, `${id}.jpg`);
  try { await unlink(thumbPath); } catch { /* no thumb */ }

  fileIndex.delete(id);
  return true;
}

export function getUploadsDir() { return uploadsDir; }
export function getThumbnailsDir() { return thumbnailsDir; }

export function getMediaType(filename) {
  const ext = extname(filename).toLowerCase();
  const videoExts = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".ogv"];
  const audioExts = [".mp3", ".wav", ".ogg", ".aac", ".flac", ".m4a", ".wma"];
  const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"];

  if (videoExts.includes(ext)) return "video";
  if (audioExts.includes(ext)) return "audio";
  if (imageExts.includes(ext)) return "image";
  return "other";
}
