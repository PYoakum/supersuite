import { error, file } from "../middleware.js";

export function registerAttachmentRoutes(router) {
  router.get("/api/attachment/:folder/:uid/:partId", async (req, ctx) => {
    const { folder, uid, partId } = ctx.params;

    try {
      const { data, meta } = await ctx.imap.getAttachment(folder, uid, partId);
      const contentType = meta?.contentType || "application/octet-stream";
      const filename = meta?.filename || `attachment-${partId}`;

      return new Response(data, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": meta?.disposition === "inline"
            ? `inline; filename="${filename}"`
            : `attachment; filename="${filename}"`,
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch (err) {
      console.error("Attachment error:", err);
      return error("Failed to download attachment", 500);
    }
  });
}
