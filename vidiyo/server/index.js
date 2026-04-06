/**
 * Server factory - route wiring, static file serving
 */

import { join } from "node:path";
import { createRouter } from "./router.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerRenderRoutes } from "./routes/render.js";
import { buildTemplate } from "../web/template.js";
import { getUploadsDir } from "../lib/uploads.js";

export function createServer(config) {
  const router = createRouter();

  registerFileRoutes(router, config);
  registerProjectRoutes(router);
  registerRenderRoutes(router, config);

  const html = buildTemplate();
  const outputDir = config.storage?.output_dir || "data/output";

  return Bun.serve({
    port: config.server.port,
    hostname: config.server.host,

    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // Serve SPA
      if (path === "/" || path === "/index.html") {
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // Serve uploaded media files
      if (path.startsWith("/media/")) {
        const filePath = join(getUploadsDir(), path.slice(7));
        const file = Bun.file(filePath);
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Cache-Control": "public, max-age=3600" },
          });
        }
        return new Response("Not Found", { status: 404 });
      }

      // Serve rendered output files
      if (path.startsWith("/output/")) {
        const filePath = join(outputDir, path.slice(8));
        const file = Bun.file(filePath);
        if (await file.exists()) {
          return new Response(file, {
            headers: {
              "Content-Disposition": `attachment; filename="${path.slice(8)}"`,
              "Cache-Control": "public, max-age=3600",
            },
          });
        }
        return new Response("Not Found", { status: 404 });
      }

      // Block config.toml access
      if (path === "/config.toml") {
        return new Response("Not Found", { status: 404 });
      }

      // API routes
      const match = router.match(req.method, path);
      if (match) {
        try {
          return await match.handler({ req, url, params: match.params, config });
        } catch (err) {
          console.error("Route error:", err);
          return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      return new Response("Not Found", { status: 404 });
    },
  });
}
