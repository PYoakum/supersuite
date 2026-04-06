import { json, error } from "../middleware.js";
import { parseMessage, getBodyStructureParts } from "../../lib/sanitize.js";

export function registerMessageRoutes(router) {
  // List messages in a folder
  router.get("/api/messages/:folder", async (req, ctx) => {
    const { folder } = ctx.params;
    const page = parseInt(ctx.url.searchParams.get("page") || "1", 10);
    const search = ctx.url.searchParams.get("search") || "";
    const pageSize = ctx.config.imap.page_size;

    if (search) {
      const messages = await ctx.imap.search(folder, search);
      return json({ messages, total: messages.length, page: 1, pages: 1 });
    }

    const result = await ctx.imap.listMessages(folder, page, pageSize);
    return json(result);
  });

  // Get a single message
  router.get("/api/message/:folder/:uid", async (req, ctx) => {
    const { folder, uid } = ctx.params;
    const external = ctx.url.searchParams.get("external") === "1";

    const msg = await ctx.imap.getMessage(folder, uid, external);
    if (!msg) return error("Message not found", 404);

    const parsed = await parseMessage(msg.source, { external, folder, uid });
    const attachmentParts = getBodyStructureParts(msg.bodyStructure);

    return json({
      uid: msg.uid,
      flags: msg.flags,
      envelope: msg.envelope,
      ...parsed,
      attachmentParts,
    });
  });
}
