import { createRouter } from "./router.js";
import { authenticateRequest } from "./middleware.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerOrganizationRoutes } from "./routes/organizations.js";
import { registerWarehouseRoutes } from "./routes/warehouses.js";
import { registerItemRoutes } from "./routes/items.js";
import { registerRackLocationRoutes } from "./routes/rack-locations.js";
import { registerTagRoutes } from "./routes/tags.js";
import { registerBarcodeRoutes } from "./routes/barcodes.js";
import { registerPhotoRoutes } from "./routes/photos.js";
import { registerInventoryRoutes } from "./routes/inventory.js";
import { registerSearchRoutes } from "./routes/search.js";
import { join } from "path";

export function createServer(config, sql, spaHtml) {
  const router = createRouter();

  // Register all route modules
  registerHealthRoutes(router, config, sql);
  registerAuthRoutes(router, config, sql);
  registerOrganizationRoutes(router, config, sql);
  registerWarehouseRoutes(router, config, sql);
  registerItemRoutes(router, config, sql);
  registerRackLocationRoutes(router, config, sql);
  registerTagRoutes(router, config, sql);
  registerBarcodeRoutes(router, config, sql);
  registerPhotoRoutes(router, config, sql);
  registerInventoryRoutes(router, config, sql);
  registerSearchRoutes(router, config, sql);

  const uploadsDir = join(process.cwd(), config.storage.uploads_dir);

  return Bun.serve({
    port: config.server.port,
    hostname: config.server.host,

    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;

      // Serve uploaded files
      if (pathname.startsWith("/uploads/")) {
        const filePath = join(uploadsDir, pathname.slice("/uploads/".length));
        const file = Bun.file(filePath);
        if (await file.exists()) {
          return new Response(file);
        }
        return Response.json({ error: "Not found" }, { status: 404 });
      }

      // API routes
      if (pathname.startsWith("/api/")) {
        const match = router.match(req.method, pathname);
        if (!match) {
          return Response.json({ error: "Not found" }, { status: 404 });
        }

        try {
          // Parse auth for all API routes (handlers decide if required)
          const user = await authenticateRequest(req, config, sql);

          return await match.handler({
            req,
            url,
            params: match.params,
            config,
            sql,
            user,
          });
        } catch (err) {
          const status = err.status || 500;
          if (status >= 500) console.error(`${req.method} ${pathname} error:`, err);
          const message = err.expose ? err.message : "Internal server error";
          return Response.json({ error: message }, { status });
        }
      }

      // SPA — serve for all non-API, non-upload routes
      return new Response(spaHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  });
}
