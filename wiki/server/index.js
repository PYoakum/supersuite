import { createRouter } from "./router.js";
import { resolveSession, html } from "./middleware.js";
import { registerPageRoutes } from "./routes/pages.js";
import { registerEditRoutes } from "./routes/edit.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerApiRoutes } from "./routes/api.js";
import { errorPage } from "../web/pages/error.js";

export function createServer(config) {
  const router = createRouter();

  registerPageRoutes(router);
  registerEditRoutes(router);
  registerAuthRoutes(router);
  registerSearchRoutes(router);
  registerApiRoutes(router);

  return Bun.serve({
    port: config.server.port,
    hostname: config.server.host,

    async fetch(req) {
      const url = new URL(req.url);
      const loggedIn = await resolveSession(req, config);

      const match = router.match(req.method, url.pathname);
      if (!match) {
        return html(errorPage(config, loggedIn, "Not Found"), 404);
      }

      try {
        return await match.handler(req, { config, loggedIn, params: match.params, url });
      } catch (err) {
        console.error("Route error:", err);
        return html(errorPage(config, loggedIn, "Internal server error"), 500);
      }
    },
  });
}
