import { json, error } from "../middleware.js";

export function registerActionRoutes(router) {
  router.post("/api/move", async (req, ctx) => {
    const { folder, uids, destination } = await req.json();
    if (!folder || !uids?.length || !destination) {
      return error("folder, uids, and destination are required", 400);
    }
    await ctx.imap.moveMessages(folder, uids, destination);
    return json({ ok: true });
  });

  router.post("/api/delete", async (req, ctx) => {
    const { folder, uids, permanent } = await req.json();
    if (!folder || !uids?.length) {
      return error("folder and uids are required", 400);
    }

    if (permanent) {
      await ctx.imap.deleteMessages(folder, uids);
    } else {
      const trashFolder = await ctx.imap.getTrashFolder();
      if (folder === trashFolder) {
        // Already in trash — permanently delete
        await ctx.imap.deleteMessages(folder, uids);
      } else {
        await ctx.imap.moveMessages(folder, uids, trashFolder);
      }
    }

    return json({ ok: true });
  });

  router.post("/api/mark-read", async (req, ctx) => {
    const { folder, uids, read } = await req.json();
    if (!folder || !uids?.length) {
      return error("folder and uids are required", 400);
    }

    const action = read !== false ? "add" : "remove";
    await ctx.imap.setFlags(folder, uids, ["\\Seen"], action);
    return json({ ok: true });
  });
}
