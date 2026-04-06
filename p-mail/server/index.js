import { createRouter } from "./router.js";
import { html, error } from "./middleware.js";
import { buildTemplate } from "../web/template.js";
import { registerFolderRoutes } from "./routes/folders.js";
import { registerMessageRoutes } from "./routes/messages.js";
import { registerAttachmentRoutes } from "./routes/attachments.js";
import { registerSendRoutes } from "./routes/send.js";
import { registerActionRoutes } from "./routes/actions.js";
import { registerDraftRoutes } from "./routes/drafts.js";
import { registerTemplateRoutes } from "./routes/templates.js";

export function createServer(config, imap, smtp) {
  const router = createRouter();
  const spaHtml = buildTemplate(config);

  registerFolderRoutes(router);
  registerMessageRoutes(router);
  registerAttachmentRoutes(router);
  registerSendRoutes(router);
  registerActionRoutes(router);
  registerDraftRoutes(router);
  registerTemplateRoutes(router);

  return Bun.serve({
    port: config.server.port,
    hostname: config.server.host,

    async fetch(req) {
      const url = new URL(req.url);
      const match = router.match(req.method, url.pathname);

      if (match) {
        try {
          return await match.handler(req, { config, imap, smtp, params: match.params, url });
        } catch (err) {
          console.error("Route error:", err);
          return error(err.message, 500);
        }
      }

      // SPA fallback for non-API routes
      if (!url.pathname.startsWith("/api/")) {
        return html(spaHtml);
      }

      return error("Not found", 404);
    },
  });
}
