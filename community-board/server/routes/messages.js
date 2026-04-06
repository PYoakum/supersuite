import { findUserByUsername } from "../../db/users.js";
import { sendMessage, getInbox, getInboxCount, getSent, getSentCount, getMessageById, markRead, softDeleteMessage } from "../../db/messages.js";
import { html, redirect, layoutExtras } from "../middleware.js";
import { renderMessagesInbox } from "../../web/pages/messages-inbox.js";
import { renderMessagesSent } from "../../web/pages/messages-sent.js";
import { renderMessagesCompose } from "../../web/pages/messages-compose.js";
import { renderMessageView } from "../../web/pages/messages-view.js";
import { renderError } from "../../web/pages/error.js";

export function registerMessageRoutes(router, config, sql) {
  router.get("/messages", async (ctx) => {
    if (!ctx.user) return redirect("/login");

    const page = Math.max(1, parseInt(ctx.url.searchParams.get("page")) || 1);
    const perPage = config.messaging?.messages_per_page ?? 25;
    const messages = await getInbox(sql, ctx.user.id, page, perPage);
    const totalMessages = await getInboxCount(sql, ctx.user.id);

    return html(renderMessagesInbox(config, ctx.user, messages, page, totalMessages, perPage, layoutExtras(ctx)));
  });

  router.get("/messages/sent", async (ctx) => {
    if (!ctx.user) return redirect("/login");

    const page = Math.max(1, parseInt(ctx.url.searchParams.get("page")) || 1);
    const perPage = config.messaging?.messages_per_page ?? 25;
    const messages = await getSent(sql, ctx.user.id, page, perPage);
    const totalMessages = await getSentCount(sql, ctx.user.id);

    return html(renderMessagesSent(config, ctx.user, messages, page, totalMessages, perPage, layoutExtras(ctx)));
  });

  router.get("/messages/new", async (ctx) => {
    if (!ctx.user) return redirect("/login");

    const prefillTo = ctx.url.searchParams.get("to") || "";
    return html(renderMessagesCompose(config, ctx.user, layoutExtras(ctx), prefillTo));
  });

  router.post("/messages/new", async (ctx) => {
    if (!ctx.user) return redirect("/login");

    // Check posting restriction (also applies to messaging)
    if (!ctx.user.can_post) {
      return html(renderError(config, ctx.user, 403, "You are not allowed to send messages"), 403);
    }

    const form = await ctx.req.formData();
    const to = form.get("to")?.trim();
    const subject = form.get("subject")?.trim();
    const body = form.get("body")?.trim();

    if (!to || !subject || !body) {
      return html(renderMessagesCompose(config, ctx.user, layoutExtras(ctx), to || "", "All fields are required"));
    }

    if (subject.length > 256) {
      return html(renderMessagesCompose(config, ctx.user, layoutExtras(ctx), to, "Subject must be 256 characters or less"));
    }

    const maxBody = config.messaging?.max_body_length ?? 10000;
    if (body.length > maxBody) {
      return html(renderMessagesCompose(config, ctx.user, layoutExtras(ctx), to, `Message body must be ${maxBody} characters or less`));
    }

    // Look up recipient
    const recipient = await findUserByUsername(sql, to);
    if (!recipient) {
      return html(renderMessagesCompose(config, ctx.user, layoutExtras(ctx), to, "User not found"));
    }

    if (recipient.id === ctx.user.id) {
      return html(renderMessagesCompose(config, ctx.user, layoutExtras(ctx), to, "You cannot send a message to yourself"));
    }

    await sendMessage(sql, ctx.user.id, recipient.id, subject, body);
    return redirect("/messages/sent");
  });

  router.get("/messages/:id", async (ctx) => {
    if (!ctx.user) return redirect("/login");

    const msg = await getMessageById(sql, parseInt(ctx.params.id));
    if (!msg) {
      return html(renderError(config, ctx.user, 404, "Message not found"), 404);
    }

    // Verify access — user must be sender or recipient
    const isSender = msg.sender_id === ctx.user.id;
    const isRecipient = msg.recipient_id === ctx.user.id;
    if (!isSender && !isRecipient) {
      return html(renderError(config, ctx.user, 403, "Access denied"), 403);
    }

    // Check if deleted for this user
    if ((isSender && msg.deleted_by_sender) || (isRecipient && msg.deleted_by_recipient)) {
      return html(renderError(config, ctx.user, 404, "Message not found"), 404);
    }

    // Mark as read if recipient
    if (isRecipient && !msg.read_at) {
      await markRead(sql, msg.id);
    }

    return html(renderMessageView(config, ctx.user, msg, layoutExtras(ctx)));
  });

  router.post("/messages/:id/delete", async (ctx) => {
    if (!ctx.user) return redirect("/login");

    const msg = await getMessageById(sql, parseInt(ctx.params.id));
    if (!msg) {
      return html(renderError(config, ctx.user, 404, "Message not found"), 404);
    }

    if (msg.sender_id !== ctx.user.id && msg.recipient_id !== ctx.user.id) {
      return html(renderError(config, ctx.user, 403, "Access denied"), 403);
    }

    await softDeleteMessage(sql, msg.id, ctx.user.id);
    return redirect("/messages");
  });
}
