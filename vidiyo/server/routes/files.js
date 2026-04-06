/**
 * File upload, list, delete, thumbnail, and media serving routes
 */

import { join } from "node:path";
import { saveFile, listFiles, getFile, deleteFile, getMediaType, getThumbnailsDir } from "../../lib/uploads.js";

let ffmpegPath = "ffmpeg";

export function registerFileRoutes(router, config) {
  ffmpegPath = config.ffmpeg?.ffmpeg_path || "ffmpeg";
  const maxUploadBytes = (config.storage?.max_upload_mb || 500) * 1024 * 1024;

  // Upload file (multipart)
  router.post("/api/files/upload", async (ctx) => {
    const contentType = ctx.req.headers.get("content-type") || "";

    if (!contentType.includes("multipart/form-data")) {
      return json({ error: "Expected multipart/form-data" }, 400);
    }

    const formData = await ctx.req.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return json({ error: "No file provided" }, 400);
    }

    if (file.size > maxUploadBytes) {
      return json({ error: `File too large (max ${config.storage?.max_upload_mb || 500}MB)` }, 413);
    }

    const entry = await saveFile(file);
    return json(entry);
  });

  // List files
  router.get("/api/files", async () => {
    return json(listFiles());
  });

  // Get thumbnail
  router.get("/api/files/:id/thumbnail", async (ctx) => {
    const { id } = ctx.params;
    const file = getFile(id);
    if (!file) return json({ error: "File not found" }, 404);

    const thumbDir = getThumbnailsDir();
    const thumbPath = join(thumbDir, `${id}.jpg`);
    const thumbFile = Bun.file(thumbPath);

    if (await thumbFile.exists()) {
      return new Response(thumbFile, {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" },
      });
    }

    // Generate thumbnail
    const mediaType = getMediaType(file.filename);
    if (mediaType === "image") {
      // For images, resize as thumbnail
      const proc = Bun.spawn([
        ffmpegPath, "-y", "-i", file.path,
        "-vf", "scale=320:-1",
        "-frames:v", "1",
        thumbPath,
      ], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
    } else if (mediaType === "video") {
      // For video, grab frame at 1 second
      const proc = Bun.spawn([
        ffmpegPath, "-y", "-i", file.path,
        "-ss", "1", "-vf", "scale=320:-1",
        "-frames:v", "1",
        thumbPath,
      ], { stdout: "pipe", stderr: "pipe" });
      await proc.exited;
    } else {
      return json({ error: "No thumbnail for this file type" }, 404);
    }

    const generatedThumb = Bun.file(thumbPath);
    if (await generatedThumb.exists()) {
      return new Response(generatedThumb, {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" },
      });
    }

    return json({ error: "Failed to generate thumbnail" }, 500);
  });

  // Delete file
  router.delete("/api/files/:id", async (ctx) => {
    const { id } = ctx.params;
    const deleted = await deleteFile(id);
    if (!deleted) return json({ error: "File not found" }, 404);
    return json({ ok: true });
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
