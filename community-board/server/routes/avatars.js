import { getAvatar } from "../../db/avatars.js";

export function registerAvatarRoutes(router, config, sql) {
  router.get("/avatar/:id", async (ctx) => {
    const id = parseInt(ctx.params.id);
    if (!id || id <= 0) {
      return new Response("Not Found", { status: 404 });
    }

    const avatar = await getAvatar(sql, id);
    if (!avatar) {
      return new Response("Not Found", { status: 404 });
    }

    return new Response(avatar.data, {
      headers: {
        "Content-Type": avatar.mime_type,
        "Content-Length": String(avatar.size),
        "Cache-Control": "public, max-age=3600",
      },
    });
  });
}
