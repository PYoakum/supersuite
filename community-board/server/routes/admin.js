import { getAllCategories, createCategory, updateCategory, deleteCategory } from "../../db/categories.js";
import { getSetting, setSetting, deleteSetting } from "../../db/site-settings.js";
import { html, redirect, layoutExtras } from "../middleware.js";
import { renderAdmin } from "../../web/pages/admin.js";
import { renderError } from "../../web/pages/error.js";

export function registerAdminRoutes(router, config, sql) {
  router.get("/admin", async (ctx) => {
    if (!ctx.user || ctx.user.role !== "admin") {
      return html(renderError(config, ctx.user, 403, "Access denied"), 403);
    }

    const categories = await getAllCategories(sql);
    const banner = await getSetting(sql, "notification_banner");
    return html(renderAdmin(config, ctx.user, categories, layoutExtras(ctx), null, null, banner));
  });

  router.post("/admin/categories", async (ctx) => {
    if (!ctx.user || ctx.user.role !== "admin") {
      return html(renderError(config, ctx.user, 403, "Access denied"), 403);
    }

    const form = await ctx.req.formData();
    const slug = form.get("slug")?.trim().toLowerCase();
    const name = form.get("name")?.trim();
    const description = form.get("description")?.trim() || "";
    const position = parseInt(form.get("position")) || 0;

    if (!slug || !name) {
      const categories = await getAllCategories(sql);
      return html(renderAdmin(config, ctx.user, categories, layoutExtras(ctx), "Slug and name are required"));
    }

    if (!/^[a-z0-9-]+$/.test(slug)) {
      const categories = await getAllCategories(sql);
      return html(renderAdmin(config, ctx.user, categories, layoutExtras(ctx), "Slug may only contain lowercase letters, numbers, and hyphens"));
    }

    // Validate slug against config allow-list
    const allowedSlugs = config.categories?.allowed_slugs || [];
    if (allowedSlugs.length > 0 && !allowedSlugs.includes(slug)) {
      const categories = await getAllCategories(sql);
      return html(renderAdmin(config, ctx.user, categories, layoutExtras(ctx), `Slug "${slug}" is not in the allowed list. Allowed: ${allowedSlugs.join(", ")}`));
    }

    try {
      await createCategory(sql, slug, name, description, position);
    } catch (err) {
      if (err.code === "23505") {
        const categories = await getAllCategories(sql);
        return html(renderAdmin(config, ctx.user, categories, layoutExtras(ctx), "A category with that slug already exists"));
      }
      throw err;
    }

    return redirect("/admin");
  });

  router.post("/admin/categories/:id", async (ctx) => {
    if (!ctx.user || ctx.user.role !== "admin") {
      return html(renderError(config, ctx.user, 403, "Access denied"), 403);
    }

    const form = await ctx.req.formData();
    const action = form.get("action");
    const categoryId = parseInt(ctx.params.id);

    if (action === "delete") {
      await deleteCategory(sql, categoryId);
      return redirect("/admin");
    }

    // Update
    const name = form.get("name")?.trim();
    const description = form.get("description")?.trim();
    const position = parseInt(form.get("position"));

    await updateCategory(sql, categoryId, {
      name: name || undefined,
      description: description ?? undefined,
      position: isNaN(position) ? undefined : position,
    });

    return redirect("/admin");
  });

  router.post("/admin/banner", async (ctx) => {
    if (!ctx.user || ctx.user.role !== "admin") {
      return html(renderError(config, ctx.user, 403, "Access denied"), 403);
    }

    const form = await ctx.req.formData();
    const action = form.get("action");
    const bannerText = form.get("banner")?.trim();

    if (action === "clear") {
      await deleteSetting(sql, "notification_banner");
    } else if (bannerText) {
      await setSetting(sql, "notification_banner", bannerText);
    }

    return redirect("/admin");
  });
}
