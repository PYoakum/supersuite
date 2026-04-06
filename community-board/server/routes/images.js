import { getImageById } from "../../db/images.js";

export function registerImageRoutes(router, config, sql) {
  router.get("/img/:id", async (ctx) => {
    const id = parseInt(ctx.params.id);
    if (!id || id <= 0) {
      return new Response("Not Found", { status: 404 });
    }

    const img = await getImageById(sql, id);
    if (!img) {
      return new Response("Not Found", { status: 404 });
    }

    return new Response(img.data, {
      headers: {
        "Content-Type": img.mime_type,
        "Content-Length": String(img.size),
        "Cache-Control": "public, max-age=86400",
      },
    });
  });
}
