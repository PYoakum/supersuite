import { searchPages } from "../../lib/wiki.js";
import { html } from "../middleware.js";
import { searchPage } from "../../web/pages/search.js";

export function registerSearchRoutes(router) {
  router.get("/search", async (req, ctx) => {
    const query = ctx.url.searchParams.get("q") || "";
    const results = query ? await searchPages(query) : null;
    return html(searchPage(ctx.config, ctx.loggedIn, query, results));
  });
}
