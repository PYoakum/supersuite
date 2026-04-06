import { json, error } from "../middleware.js";

export function registerSendRoutes(router) {
  router.post("/api/send", async (req, ctx) => {
    const contentType = req.headers.get("content-type") || "";
    let to, cc, bcc, subject, html, text, inReplyTo, references, draftUid, draftFolder;
    let attachments = [];

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      to = formData.get("to");
      cc = formData.get("cc") || "";
      bcc = formData.get("bcc") || "";
      subject = formData.get("subject") || "";
      html = formData.get("html") || "";
      text = formData.get("text") || "";
      inReplyTo = formData.get("inReplyTo") || "";
      references = formData.get("references") || "";
      draftUid = formData.get("draftUid") || "";
      draftFolder = formData.get("draftFolder") || "";

      const files = formData.getAll("attachments");
      for (const file of files) {
        if (file && file.size > 0) {
          const buffer = Buffer.from(await file.arrayBuffer());
          attachments.push({
            filename: file.name,
            content: buffer,
            contentType: file.type,
          });
        }
      }
    } else {
      const body = await req.json();
      to = body.to;
      cc = body.cc || "";
      bcc = body.bcc || "";
      subject = body.subject || "";
      html = body.html || "";
      text = body.text || "";
      inReplyTo = body.inReplyTo || "";
      references = body.references || "";
      draftUid = body.draftUid || "";
      draftFolder = body.draftFolder || "";
    }

    if (!to) return error("Recipient (to) is required", 400);

    // Check attachment size limit
    const totalSize = attachments.reduce((sum, a) => sum + a.content.length, 0);
    if (totalSize > ctx.config.attachments.max_upload_size) {
      return error(`Total attachment size exceeds limit (${Math.round(ctx.config.attachments.max_upload_size / 1048576)} MB)`, 413);
    }

    const mailOpts = {
      to, cc, bcc, subject, html, text, attachments,
      inReplyTo: inReplyTo || undefined,
      references: references || undefined,
    };

    // Send via SMTP
    await ctx.smtp.send(mailOpts);

    // Append copy to Sent folder
    try {
      const sentFolder = await ctx.imap.getSentFolder();
      const raw = await compileRaw(ctx.smtp, mailOpts);
      await ctx.imap.appendMessage(sentFolder, raw, ["\\Seen"]);
    } catch (err) {
      console.error("Failed to save to Sent:", err.message);
    }

    // Delete draft if this was a draft-to-send
    if (draftUid && draftFolder) {
      try {
        await ctx.imap.deleteMessages(draftFolder, [draftUid]);
      } catch (err) {
        console.error("Failed to delete draft:", err.message);
      }
    }

    return json({ ok: true });
  });
}

async function compileRaw(smtp, opts) {
  const { default: MailComposer } = await import("nodemailer/lib/mail-composer/index.js");
  const mail = new MailComposer({
    from: smtp.getFromAddress(),
    ...opts,
  });
  return new Promise((resolve, reject) => {
    mail.compile().build((err, message) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}
