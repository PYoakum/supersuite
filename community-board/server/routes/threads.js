import { findCategoryBySlug } from "../../db/categories.js";
import { findThreadById, createThread } from "../../db/threads.js";
import { getPostsForThread, getPostCountForThread, getPostsByIds } from "../../db/posts.js";
import { getImagesForPosts } from "../../db/images.js";
import { getSavedPostIdsForUser } from "../../db/saved-posts.js";
import { html, redirect, validateImages, layoutExtras } from "../middleware.js";
import { renderThread } from "../../web/pages/thread.js";
import { renderNewThread } from "../../web/pages/new-thread.js";
import { renderError } from "../../web/pages/error.js";

export function registerThreadRoutes(router, config, sql) {
  router.get("/c/:slug/t/:id", async (ctx) => {
    const thread = await findThreadById(sql, parseInt(ctx.params.id));
    if (!thread || thread.category_slug !== ctx.params.slug) {
      return html(renderError(config, ctx.user, 404, "Thread not found"), 404);
    }

    const page = Math.max(1, parseInt(ctx.url.searchParams.get("page")) || 1);
    const perPage = config.site.posts_per_page;
    const posts = await getPostsForThread(sql, thread.id, page, perPage);
    const totalPosts = await getPostCountForThread(sql, thread.id);

    // Batch-load images for all posts on this page
    const postIds = posts.map((p) => p.id);
    const images = await getImagesForPosts(sql, postIds);
    const imagesByPost = {};
    for (const img of images) {
      (imagesByPost[img.post_id] ||= []).push(img);
    }
    for (const post of posts) {
      post.images = imagesByPost[post.id] || [];
    }

    // Build postsById map for quote-tree; batch-fetch missing parents
    const postsById = {};
    for (const p of posts) {
      postsById[p.id] = p;
    }
    const missingParentIds = posts
      .filter((p) => p.parent_post_id && !postsById[p.parent_post_id])
      .map((p) => p.parent_post_id);
    if (missingParentIds.length) {
      const parentPosts = await getPostsByIds(sql, [...new Set(missingParentIds)]);
      for (const pp of parentPosts) {
        postsById[pp.id] = pp;
      }
    }

    // Attach parent info to each post for quote-tree rendering
    for (const post of posts) {
      if (post.parent_post_id && postsById[post.parent_post_id]) {
        const parent = postsById[post.parent_post_id];
        post._parentUsername = parent.username;
        post._parentSnippet = (parent.body || "").substring(0, 200);
        post._parentId = parent.id;
      }
    }

    // Batch-load bookmark state for current user
    if (ctx.user) {
      const savedSet = await getSavedPostIdsForUser(sql, ctx.user.id, postIds);
      for (const post of posts) {
        post._isSaved = savedSet.has(post.id);
      }
    }

    return html(renderThread(config, ctx.user, thread, posts, page, totalPosts, perPage, layoutExtras(ctx)));
  });

  router.get("/c/:slug/new", async (ctx) => {
    if (!ctx.user) return redirect("/login");

    const category = await findCategoryBySlug(sql, ctx.params.slug);
    if (!category) {
      return html(renderError(config, ctx.user, 404, "Category not found"), 404);
    }

    return html(renderNewThread(config, ctx.user, category, layoutExtras(ctx)));
  });

  router.post("/c/:slug/new", async (ctx) => {
    if (!ctx.user) return redirect("/login");

    // Check thread creation restriction
    if (!ctx.user.can_create_threads) {
      return html(renderError(config, ctx.user, 403, "You are not allowed to create threads"), 403);
    }

    const category = await findCategoryBySlug(sql, ctx.params.slug);
    if (!category) {
      return html(renderError(config, ctx.user, 404, "Category not found"), 404);
    }

    const form = await ctx.req.formData();
    const title = form.get("title")?.trim();
    const body = form.get("body")?.trim();
    const contentTag = form.get("content_tag")?.trim() || null;
    const imageFiles = form.getAll("images").filter((f) => f instanceof File && f.size > 0);

    if (!title || !body) {
      return html(renderNewThread(config, ctx.user, category, layoutExtras(ctx), "Title and body are required"));
    }
    if (title.length > 256) {
      return html(renderNewThread(config, ctx.user, category, layoutExtras(ctx), "Title must be 256 characters or less"));
    }

    // Validate content tag against config
    if (contentTag) {
      const allowedTags = config.content_tags?.allowed || [];
      if (!allowedTags.includes(contentTag)) {
        return html(renderNewThread(config, ctx.user, category, layoutExtras(ctx), "Invalid content tag"));
      }
    }

    if (imageFiles.length) {
      const imgErr = validateImages(imageFiles, config);
      if (imgErr) {
        return html(renderNewThread(config, ctx.user, category, layoutExtras(ctx), imgErr));
      }
    }

    const thread = await createThread(sql, category.id, ctx.user.id, title, body, contentTag, imageFiles);
    return redirect(`/c/${category.slug}/t/${thread.id}`);
  });
}
