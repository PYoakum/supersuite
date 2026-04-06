import { getAllCategories, findCategoryBySlug } from "../../db/categories.js";
import { getThreadsForCategory } from "../../db/threads.js";
import { html, layoutExtras } from "../middleware.js";
import { renderHome } from "../../web/pages/home.js";
import { renderCategory } from "../../web/pages/category.js";
import { renderError } from "../../web/pages/error.js";

export function registerCategoryRoutes(router, config, sql) {
  router.get("/", async (ctx) => {
    const categories = await getAllCategories(sql);
    return html(renderHome(config, ctx.user, categories, layoutExtras(ctx)));
  });

  router.get("/c/:slug", async (ctx) => {
    const category = await findCategoryBySlug(sql, ctx.params.slug);
    if (!category) {
      return html(renderError(config, ctx.user, 404, "Category not found"), 404);
    }

    const page = Math.max(1, parseInt(ctx.url.searchParams.get("page")) || 1);
    const perPage = config.site.threads_per_page;
    const threads = await getThreadsForCategory(sql, category.id, page, perPage);
    const totalThreads = category.thread_count;

    return html(renderCategory(config, ctx.user, category, threads, page, totalThreads, perPage, layoutExtras(ctx)));
  });
}
