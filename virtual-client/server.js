import { join, extname } from "path";
import { readFile, readdir } from "fs/promises";
import { parse } from "smol-toml";
import { buildTemplate } from "./web/template.js";

let config = { server: { port: 3000 } };
try {
  const raw = await readFile(join(import.meta.dir, "config.toml"), "utf-8");
  config = { ...config, ...parse(raw) };
} catch {}

const port = parseInt(process.env.PORT, 10) || config.server?.port || 3000;
const html = buildTemplate();

const VENDOR_DIR = join(import.meta.dir, "vendor");
const IMAGES_DIR = join(import.meta.dir, "images");
const GUEST_DIR = join(import.meta.dir, "guest");

const MIME = {
  ".js": "application/javascript",
  ".wasm": "application/wasm",
  ".bin": "application/octet-stream",
  ".json": "application/json",
  ".sh": "text/plain",
};

async function serveStatic(dir, subpath) {
  if (subpath.includes("..")) return new Response("Forbidden", { status: 403 });
  try {
    const data = await readFile(join(dir, subpath));
    const mime = MIME[extname(subpath)] || "application/octet-stream";
    return new Response(data, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/" || path === "/index.html") {
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (path === "/api/images") {
      try {
        const files = await readdir(IMAGES_DIR);
        const images = files
          .filter((f) => /\.(iso\.cdr|iso|bin|img|qcow2|raw)$/.test(f))
          .map((f) => ({
            name: f,
            type: f.endsWith(".bin") ? "bzimage"
              : f.endsWith(".img") ? "fda"
              : f.endsWith(".qcow2") || f.endsWith(".raw") ? "hda"
              : "cdrom",
          }));
        return Response.json(images);
      } catch {
        return Response.json([]);
      }
    }

    if (path.startsWith("/vendor/")) {
      return serveStatic(VENDOR_DIR, path.slice("/vendor/".length));
    }

    if (path.startsWith("/images/")) {
      return serveStatic(IMAGES_DIR, path.slice("/images/".length));
    }

    if (path.startsWith("/guest/")) {
      return serveStatic(GUEST_DIR, path.slice("/guest/".length));
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`virtual-client running on http://localhost:${port}`);
