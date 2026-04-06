import { json, error } from "../middleware.js";

export function registerDraftRoutes(router) {
  // Save new draft
  router.post("/api/drafts", async (req, ctx) => {
    const { to, cc, bcc, subject, html, text } = await req.json();

    const raw = await compileDraft(ctx.smtp, { to, cc, bcc, subject, html, text });
    const draftFolder = await ctx.imap.getDraftFolder();
    const result = await ctx.imap.appendMessage(draftFolder, raw, ["\\Draft", "\\Seen"]);

    return json({ ok: true, uid: result?.uid || null, folder: draftFolder });
  });

  // Update existing draft (delete old + save new)
  router.put("/api/drafts/:folder/:uid", async (req, ctx) => {
    const { folder, uid } = ctx.params;
    const { to, cc, bcc, subject, html, text } = await req.json();

    // Save new draft
    const raw = await compileDraft(ctx.smtp, { to, cc, bcc, subject, html, text });
    const draftFolder = await ctx.imap.getDraftFolder();
    const result = await ctx.imap.appendMessage(draftFolder, raw, ["\\Draft", "\\Seen"]);

    // Delete old draft
    try {
      await ctx.imap.deleteMessages(folder, [uid]);
    } catch (err) {
      console.error("Failed to delete old draft:", err.message);
    }

    return json({ ok: true, uid: result?.uid || null, folder: draftFolder });
  });

  // Delete draft
  router.delete("/api/drafts/:folder/:uid", async (req, ctx) => {
    const { folder, uid } = ctx.params;
    await ctx.imap.deleteMessages(folder, [uid]);
    return json({ ok: true });
  });
}

async function compileDraft(smtp, opts) {
  const { default: MailComposer } = await import("nodemailer/lib/mail-composer/index.js");
  const mail = new MailComposer({
    from: smtp.getFromAddress(),
    to: opts.to || "",
    cc: opts.cc || undefined,
    bcc: opts.bcc || undefined,
    subject: opts.subject || "",
    html: opts.html || undefined,
    text: opts.text || undefined,
  });
  return new Promise((resolve, reject) => {
    mail.compile().build((err, message) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}
