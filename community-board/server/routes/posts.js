import { findThreadById } from "../../db/threads.js";
import { createReply, getPostCountForThread, getPostById, updatePost } from "../../db/posts.js";
import { savePost, unsavePost, getSavedPostIdsForUser } from "../../db/saved-posts.js";
import { html, redirect, validateImages, layoutExtras } from "../middleware.js";
import { renderError } from "../../web/pages/error.js";
import { renderEditPost } from "../../web/pages/edit-post.js";

export function registerPostRoutes(router, config, sql) {
  router.get("/c/:slug/t/:id/post/:postId/edit", async (ctx) => {
    if (!ctx.user) return redirect("/login");

    const thread = await findThreadById(sql, parseInt(ctx.params.id));
    if (!thread || thread.category_slug !== ctx.params.slug) {
      return html(renderError(config, ctx.user, 404, "Thread not found"), 404);
    }

    if (thread.is_locked) {
      return html(renderError(config, ctx.user, 403, "This thread is locked"), 403);
    }

    const post = await getPostById(sql, parseInt(ctx.params.postId));
    if (!post || post.thread_id !== thread.id) {
      return html(renderError(config, ctx.user, 404, "Post not found"), 404);
    }

    if (post.user_id !== ctx.user.id && ctx.user.role !== "admin") {
      return html(renderError(config, ctx.user, 403, "You can only edit your own posts"), 403);
    }

    return html(renderEditPost(config, ctx.user, thread, post, layoutExtras(ctx)));
  });

  router.post("/c/:slug/t/:id/post/:postId/edit", async (ctx) => {
    if (!ctx.user) return redirect("/login");

    const thread = await findThreadById(sql, parseInt(ctx.params.id));
    if (!thread || thread.category_slug !== ctx.params.slug) {
      return html(renderError(config, ctx.user, 404, "Thread not found"), 404);
    }

    if (thread.is_locked) {
      return html(renderError(config, ctx.user, 403, "This thread is locked"), 403);
    }

    const post = await getPostById(sql, parseInt(ctx.params.postId));
    if (!post || post.thread_id !== thread.id) {
      return html(renderError(config, ctx.user, 404, "Post not found"), 404);
    }

    if (post.user_id !== ctx.user.id && ctx.user.role !== "admin") {
      return html(renderError(config, ctx.user, 403, "You can only edit your own posts"), 403);
    }

    const form = await ctx.req.formData();
    const body = form.get("body")?.trim();
    const contentTag = form.get("content_tag")?.trim() || null;

    if (!body) {
      return html(renderEditPost(config, ctx.user, thread, post, layoutExtras(ctx), "Post body cannot be empty"));
    }

    // Validate content tag against config
    if (contentTag) {
      const allowedTags = config.content_tags?.allowed || [];
      if (!allowedTags.includes(contentTag)) {
        return html(renderEditPost(config, ctx.user, thread, post, layoutExtras(ctx), "Invalid content tag"));
      }
    }

    await updatePost(sql, post.id, body, contentTag);
    return redirect(`/c/${ctx.params.slug}/t/${ctx.params.id}`);
  });

  router.post("/c/:slug/t/:id/reply", async (ctx) => {
    if (!ctx.user) return redirect("/login");

    // Check posting restriction
    if (!ctx.user.can_post) {
      return html(renderError(config, ctx.user, 403, "You are not allowed to post"), 403);
    }

    const thread = await findThreadById(sql, parseInt(ctx.params.id));
    if (!thread || thread.category_slug !== ctx.params.slug) {
      return html(renderError(config, ctx.user, 404, "Thread not found"), 404);
    }

    if (thread.is_locked) {
      return html(renderError(config, ctx.user, 403, "This thread is locked"), 403);
    }

    const form = await ctx.req.formData();
    const body = form.get("body")?.trim();
    const parentPostId = parseInt(form.get("parent_post_id")) || null;
    const contentTag = form.get("content_tag")?.trim() || null;
    const imageFiles = form.getAll("images").filter((f) => f instanceof File && f.size > 0);

    if (!body) {
      return redirect(`/c/${ctx.params.slug}/t/${ctx.params.id}`);
    }

    // Validate parent post belongs to same thread
    if (parentPostId) {
      const parentPost = await getPostById(sql, parentPostId);
      if (!parentPost || parentPost.thread_id !== thread.id) {
        return html(renderError(config, ctx.user, 400, "Invalid parent post"), 400);
      }
    }

    // Validate content tag against config
    if (contentTag) {
      const allowedTags = config.content_tags?.allowed || [];
      if (!allowedTags.includes(contentTag)) {
        return html(renderError(config, ctx.user, 400, "Invalid content tag"), 400);
      }
    }

    if (imageFiles.length) {
      const imgErr = validateImages(imageFiles, config);
      if (imgErr) {
        return html(renderError(config, ctx.user, 400, imgErr), 400);
      }
    }

    await createReply(sql, thread.id, thread.category_id, ctx.user.id, body, parentPostId, contentTag, imageFiles);

    // Redirect to last page of thread
    const totalPosts = await getPostCountForThread(sql, thread.id);
    const lastPage = Math.ceil(totalPosts / config.site.posts_per_page);
    return redirect(`/c/${ctx.params.slug}/t/${ctx.params.id}?page=${lastPage}`);
  });

  // Bookmark toggle
  router.post("/c/:slug/t/:id/post/:postId/save", async (ctx) => {
    if (!ctx.user) return redirect("/login");

    const postId = parseInt(ctx.params.postId);
    const post = await getPostById(sql, postId);
    if (!post) {
      return html(renderError(config, ctx.user, 404, "Post not found"), 404);
    }

    const savedSet = await getSavedPostIdsForUser(sql, ctx.user.id, [postId]);
    if (savedSet.has(postId)) {
      await unsavePost(sql, ctx.user.id, postId);
    } else {
      await savePost(sql, ctx.user.id, postId);
    }

    return redirect(`/c/${ctx.params.slug}/t/${ctx.params.id}#post-${postId}`);
  });
}
