import { getPage, savePage, slugify, isValidSlug } from "../../lib/wiki.js";
import { html, redirect, requireAuth } from "../middleware.js";
import { editPage } from "../../web/pages/edit.js";

export function registerEditRoutes(router) {
  router.get("/wiki/:slug/edit", async (req, ctx) => {
    const authRedirect = requireAuth(ctx.loggedIn, `/wiki/${ctx.params.slug}/edit`);
    if (authRedirect) return authRedirect;

    const page = await getPage(ctx.params.slug) || { slug: ctx.params.slug, content: `# ${ctx.params.slug}\n\n`, title: ctx.params.slug };
    return html(editPage(ctx.config, ctx.loggedIn, page));
  });

  router.post("/wiki/:slug/edit", async (req, ctx) => {
    const authRedirect = requireAuth(ctx.loggedIn, `/wiki/${ctx.params.slug}/edit`);
    if (authRedirect) return authRedirect;

    const { slug } = ctx.params;
    if (!isValidSlug(slug)) {
      return html(editPage(ctx.config, ctx.loggedIn, { slug, content: "", title: slug }, { error: "Invalid page slug" }));
    }

    const form = await req.formData();
    const content = form.get("content") || "";
    await savePage(slug, content);
    return redirect(`/wiki/${slug}`);
  });

  router.get("/new", async (req, ctx) => {
    const authRedirect = requireAuth(ctx.loggedIn, "/new");
    if (authRedirect) return authRedirect;

    return html(editPage(ctx.config, ctx.loggedIn, { slug: "", content: "# New Page\n\n", title: "New Page" }, { isNew: true }));
  });

  router.post("/new", async (req, ctx) => {
    const authRedirect = requireAuth(ctx.loggedIn, "/new");
    if (authRedirect) return authRedirect;

    const form = await req.formData();
    const rawSlug = form.get("slug") || "";
    const content = form.get("content") || "";
    const slug = slugify(rawSlug);

    if (!slug || !isValidSlug(slug)) {
      return html(editPage(ctx.config, ctx.loggedIn, { slug: rawSlug, content, title: "New Page" }, { isNew: true, error: "Invalid slug. Use lowercase letters, numbers, and hyphens." }));
    }

    const existing = await getPage(slug);
    if (existing) {
      return html(editPage(ctx.config, ctx.loggedIn, { slug, content, title: "New Page" }, { isNew: true, error: `Page "${slug}" already exists.` }));
    }

    await savePage(slug, content);
    return redirect(`/wiki/${slug}`);
  });
}
