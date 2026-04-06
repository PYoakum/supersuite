import { getPage, listPages } from "../../lib/wiki.js";
import { redirect, html } from "../middleware.js";
import { viewPage } from "../../web/pages/view.js";
import { listPage } from "../../web/pages/list.js";
import { notFoundPage } from "../../web/pages/error.js";
import { escapeHtml } from "../../web/template.js";

async function buildSidebar(activeSlug) {
  const pages = await listPages();
  const items = pages.map(p => {
    const cls = p.slug === activeSlug ? ' class="active-page"' : "";
    return `<li${cls}><a href="/wiki/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></li>`;
  }).join("");
  return `<h3>Pages</h3><ul>${items}</ul>`;
}

export function registerPageRoutes(router) {
  router.get("/", async (req, ctx) => {
    return redirect("/wiki/home");
  });

  router.get("/wiki/:slug", async (req, ctx) => {
    const { slug } = ctx.params;
    const page = await getPage(slug);
    if (!page) {
      return html(notFoundPage(ctx.config, ctx.loggedIn, slug), 404);
    }
    const sidebar = await buildSidebar(slug);
    return html(viewPage(ctx.config, ctx.loggedIn, page, sidebar));
  });

  router.get("/pages", async (req, ctx) => {
    const pages = await listPages();
    return html(listPage(ctx.config, ctx.loggedIn, pages));
  });
}
