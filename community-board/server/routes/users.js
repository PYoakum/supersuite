import { findUserPublicByUsername, getRecentPostsByUser } from "../../db/users.js";
import { getSavedPostsForUser } from "../../db/saved-posts.js";
import { html, layoutExtras } from "../middleware.js";
import { renderProfile } from "../../web/pages/profile.js";
import { renderError } from "../../web/pages/error.js";

export function registerUserRoutes(router, config, sql) {
  router.get("/u/:username", async (ctx) => {
    const profile = await findUserPublicByUsername(sql, ctx.params.username);
    if (!profile) {
      return html(renderError(config, ctx.user, 404, "User not found"), 404);
    }

    const tab = ctx.url.searchParams.get("tab") || "posts";
    const recentPosts = await getRecentPostsByUser(sql, profile.id);

    // Saved posts tab (owner-only)
    let savedPosts = [];
    const isOwner = ctx.user && ctx.user.id === profile.id;
    if (tab === "saved" && isOwner) {
      savedPosts = await getSavedPostsForUser(sql, profile.id);
    }

    return html(renderProfile(config, ctx.user, profile, recentPosts, layoutExtras(ctx), tab, savedPosts));
  });
}
