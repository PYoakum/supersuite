import { json, error } from "../middleware.js";

export function registerFolderRoutes(router) {
  router.get("/api/folders", async (req, ctx) => {
    const folders = await ctx.imap.listFolders();

    // Get status for each folder
    const result = await Promise.all(
      folders.map(async (f) => {
        try {
          const status = await ctx.imap.folderStatus(f.path);
          return {
            ...f,
            messages: status.messages,
            unseen: status.unseen,
          };
        } catch {
          return { ...f, messages: 0, unseen: 0 };
        }
      })
    );

    return json(result);
  });
}
