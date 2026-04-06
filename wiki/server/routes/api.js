import { renderMarkdown } from "../../web/markdown.js";
import { json, requireAuth } from "../middleware.js";

export function registerApiRoutes(router) {
  router.post("/api/preview", async (req, ctx) => {
    const authRedirect = requireAuth(ctx.loggedIn, "/login");
    if (authRedirect) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const html = renderMarkdown(body.content || "");
    return json({ html });
  });
}
