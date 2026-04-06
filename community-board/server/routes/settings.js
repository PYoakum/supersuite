import { upsertAvatar, getAvatar, deleteAvatar } from "../../db/avatars.js";
import { html, redirect, layoutExtras } from "../middleware.js";
import { renderSettings } from "../../web/pages/settings.js";
import { renderError } from "../../web/pages/error.js";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export function registerSettingsRoutes(router, config, sql) {
  router.get("/settings", async (ctx) => {
    if (!ctx.user) return redirect("/login");

    const avatar = await getAvatar(sql, ctx.user.id);
    return html(renderSettings(config, ctx.user, avatar, layoutExtras(ctx)));
  });

  router.post("/settings/avatar", async (ctx) => {
    if (!ctx.user) return redirect("/login");

    const form = await ctx.req.formData();
    const file = form.get("avatar");

    if (!file || !(file instanceof File) || file.size === 0) {
      const avatar = await getAvatar(sql, ctx.user.id);
      return html(renderSettings(config, ctx.user, avatar, layoutExtras(ctx), "Please select an image file."));
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      const avatar = await getAvatar(sql, ctx.user.id);
      return html(renderSettings(config, ctx.user, avatar, layoutExtras(ctx), "Unsupported file type. Allowed: JPEG, PNG, GIF, WebP."));
    }

    const maxSize = (config.uploads?.max_avatar_size_mb ?? 2) * 1024 * 1024;
    if (file.size > maxSize) {
      const avatar = await getAvatar(sql, ctx.user.id);
      return html(renderSettings(config, ctx.user, avatar, layoutExtras(ctx), `File exceeds the ${config.uploads?.max_avatar_size_mb ?? 2}MB limit.`));
    }

    await upsertAvatar(sql, ctx.user.id, file);
    return redirect("/settings");
  });

  router.post("/settings/avatar/delete", async (ctx) => {
    if (!ctx.user) return redirect("/login");

    await deleteAvatar(sql, ctx.user.id);
    return redirect("/settings");
  });
}
