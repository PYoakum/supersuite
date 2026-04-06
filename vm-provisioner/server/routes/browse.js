/**
 * File browser endpoint
 */

import { readdir, stat } from "fs/promises";
import { resolve, dirname, extname, basename } from "path";
import { jsonResponse } from "../middleware.js";

const MAX_ENTRIES = 500;

export async function handleBrowse(url) {
  const rawPath = url.searchParams.get("path") || "/";
  const dirPath = resolve(rawPath);

  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") {
      return jsonResponse({ success: false, error: "Directory not found: " + dirPath }, 404);
    }
    if (err.code === "EACCES") {
      return jsonResponse({ success: false, error: "Permission denied: " + dirPath }, 403);
    }
    return jsonResponse({ success: false, error: err.message }, 500);
  }

  // Filter hidden files
  const visible = entries.filter(e => !e.name.startsWith("."));

  // Stat each entry (skip failures)
  const results = [];
  for (const entry of visible) {
    if (results.length >= MAX_ENTRIES) break;
    const fullPath = resolve(dirPath, entry.name);
    try {
      const info = await stat(fullPath);
      results.push({
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
        size: entry.isDirectory() ? null : info.size,
        modified: info.mtime.toISOString(),
        ext: entry.isDirectory() ? null : extname(entry.name).toLowerCase(),
      });
    } catch {
      // Skip entries we can't stat (broken symlinks, etc.)
    }
  }

  // Sort: directories first, then alphabetically
  results.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const parent = dirPath === "/" ? null : dirname(dirPath);

  return jsonResponse({
    success: true,
    data: { path: dirPath, parent, entries: results },
  });
}
