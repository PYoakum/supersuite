import { createRouter } from "./router.js";
import { resolveSession, csrfProtect, deriveCsrfToken } from "./middleware.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCategoryRoutes } from "./routes/categories.js";
import { registerThreadRoutes } from "./routes/threads.js";
import { registerPostRoutes } from "./routes/posts.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerImageRoutes } from "./routes/images.js";
import { registerAvatarRoutes } from "./routes/avatars.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerModerationRoutes } from "./routes/moderation.js";
import { registerMessageRoutes } from "./routes/messages.js";
import { renderError } from "../web/pages/error.js";
import { cleanExpiredSessions } from "../db/sessions.js";
import { getSetting } from "../db/site-settings.js";
import { getUnreadCount } from "../db/messages.js";
import { renderMarkdown } from "../web/markdown.js";

export function startServer(config, sql) {
  const router = createRouter();

  registerAuthRoutes(router, config, sql);
  registerCategoryRoutes(router, config, sql);
  registerThreadRoutes(router, config, sql);
  registerPostRoutes(router, config, sql);
  registerUserRoutes(router, config, sql);
  registerAdminRoutes(router, config, sql);
  registerImageRoutes(router, config, sql);
  registerAvatarRoutes(router, config, sql);
  registerSettingsRoutes(router, config, sql);
  registerModerationRoutes(router, config, sql);
  registerMessageRoutes(router, config, sql);

  // Periodic session cleanup every hour
  setInterval(() => cleanExpiredSessions(sql), 60 * 60 * 1000);

  const server = Bun.serve({
    port: config.server.port,
    hostname: config.server.hostname,

    async fetch(req) {
      const url = new URL(req.url);

      // Block config.toml access
      if (url.pathname === "/config.toml") {
        return new Response(renderError(config, null, 404, "Not Found"), {
          status: 404,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      const result = router.match(req.method, url.pathname);
      if (!result) {
        return new Response(renderError(config, null, 404, "Not Found"), {
          status: 404,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      try {
        const user = await resolveSession(req, config, sql);
        const csrfToken = user ? await deriveCsrfToken(user._sessionToken) : null;

        // Fetch banner and unread count for layout
        const bannerRaw = await getSetting(sql, "notification_banner");
        const bannerHtml = bannerRaw ? renderMarkdown(bannerRaw) : null;
        const unreadCount = user ? await getUnreadCount(sql, user.id) : 0;

        const ctx = {
          req,
          url,
          params: result.params,
          user,
          config,
          sql,
          csrfToken,
          bannerHtml,
          unreadCount,
        };

        // CSRF protection on POST requests
        if (req.method === "POST") {
          const csrfError = await csrfProtect(req, user);
          if (csrfError) {
            return new Response(renderError(config, user, 403, "Invalid CSRF token"), {
              status: 403,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }
        }

        return await result.handler(ctx);
      } catch (err) {
        console.error("Request error:", err);
        return new Response(renderError(config, null, 500, "Internal Server Error"), {
          status: 500,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    },
  });

  console.log(`Community Board running at http://${config.server.hostname}:${config.server.port}`);
  return server;
}
