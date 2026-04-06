import { findUserById, getRecentPostsByUser } from "../../db/users.js";
import { searchUsers, getUserCountFiltered, updateUserRestrictions, suspendUser, unsuspendUser, logModAction, getModLog, getLoginLog } from "../../db/moderation.js";
import { html, redirect, layoutExtras } from "../middleware.js";
import { renderAdminUsers } from "../../web/pages/admin-users.js";
import { renderAdminUserDetail } from "../../web/pages/admin-user-detail.js";
import { renderError } from "../../web/pages/error.js";

export function registerModerationRoutes(router, config, sql) {
  router.get("/admin/users", async (ctx) => {
    if (!ctx.user || ctx.user.role !== "admin") {
      return html(renderError(config, ctx.user, 403, "Access denied"), 403);
    }

    const query = ctx.url.searchParams.get("q")?.trim() || "";
    const page = Math.max(1, parseInt(ctx.url.searchParams.get("page")) || 1);
    const perPage = 25;
    const users = await searchUsers(sql, query, page, perPage);
    const totalUsers = await getUserCountFiltered(sql, query);

    return html(renderAdminUsers(config, ctx.user, users, query, page, totalUsers, perPage, layoutExtras(ctx)));
  });

  router.get("/admin/users/:id", async (ctx) => {
    if (!ctx.user || ctx.user.role !== "admin") {
      return html(renderError(config, ctx.user, 403, "Access denied"), 403);
    }

    const target = await findUserById(sql, parseInt(ctx.params.id));
    if (!target) {
      return html(renderError(config, ctx.user, 404, "User not found"), 404);
    }

    const recentPosts = await getRecentPostsByUser(sql, target.id);
    const loginLog = await getLoginLog(sql, target.id);
    const modLog = await getModLog(sql, target.id);

    return html(renderAdminUserDetail(config, ctx.user, target, recentPosts, loginLog, modLog, layoutExtras(ctx)));
  });

  router.post("/admin/users/:id/restrict", async (ctx) => {
    if (!ctx.user || ctx.user.role !== "admin") {
      return html(renderError(config, ctx.user, 403, "Access denied"), 403);
    }

    const targetId = parseInt(ctx.params.id);
    const target = await findUserById(sql, targetId);
    if (!target) {
      return html(renderError(config, ctx.user, 404, "User not found"), 404);
    }

    const form = await ctx.req.formData();
    const canPost = form.has("can_post");
    const canCreateThreads = form.has("can_create_threads");

    await updateUserRestrictions(sql, targetId, { canPost, canCreateThreads });

    const changes = [];
    if (canPost !== target.can_post) changes.push(`can_post: ${canPost}`);
    if (canCreateThreads !== target.can_create_threads) changes.push(`can_create_threads: ${canCreateThreads}`);
    if (changes.length) {
      await logModAction(sql, ctx.user.id, targetId, "restrict", changes.join(", "));
    }

    return redirect(`/admin/users/${targetId}`);
  });

  router.post("/admin/users/:id/suspend", async (ctx) => {
    if (!ctx.user || ctx.user.role !== "admin") {
      return html(renderError(config, ctx.user, 403, "Access denied"), 403);
    }

    const targetId = parseInt(ctx.params.id);
    const target = await findUserById(sql, targetId);
    if (!target) {
      return html(renderError(config, ctx.user, 404, "User not found"), 404);
    }

    const form = await ctx.req.formData();
    const action = form.get("action");

    if (action === "unsuspend") {
      await unsuspendUser(sql, targetId);
      await logModAction(sql, ctx.user.id, targetId, "unsuspend");
    } else {
      const hours = parseInt(form.get("hours")) || (config.moderation?.default_suspension_hours ?? 24);
      const reason = form.get("reason")?.trim() || null;
      const suspendedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);

      await suspendUser(sql, targetId, suspendedUntil, reason);
      await logModAction(sql, ctx.user.id, targetId, "suspend", `${hours}h${reason ? ` — ${reason}` : ""}`);
    }

    return redirect(`/admin/users/${targetId}`);
  });
}
