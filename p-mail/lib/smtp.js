import nodemailer from "nodemailer";

export function createSmtpTransport(config) {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  });

  return {
    async send({ from, to, cc, bcc, subject, html, text, attachments, inReplyTo, references }) {
      const fromAddr = from || `"${config.from_name}" <${config.from_address}>`;
      const mailOptions = {
        from: fromAddr,
        to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject,
        html: html || undefined,
        text: text || undefined,
        attachments,
        inReplyTo: inReplyTo || undefined,
        references: references || undefined,
      };

      const info = await transport.sendMail(mailOptions);
      return info;
    },

    async buildRaw({ from, to, cc, bcc, subject, html, text, attachments, inReplyTo, references }) {
      const fromAddr = from || `"${config.from_name}" <${config.from_address}>`;
      const mail = nodemailer.createTransport({ jsonTransport: true });
      const built = await mail.sendMail({
        from: fromAddr,
        to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject,
        html: html || undefined,
        text: text || undefined,
        attachments,
        inReplyTo: inReplyTo || undefined,
        references: references || undefined,
      });

      // Use nodemailer's compiled message for RFC 2822
      const compiler = new (await import("nodemailer/lib/mime-node/index.js")).default();
      // Simpler approach: use nodemailer to compose raw message
      return await compileRawMessage({
        from: fromAddr, to, cc, bcc, subject, html, text, attachments, inReplyTo, references,
      });
    },

    getFromAddress() {
      return `"${config.from_name}" <${config.from_address}>`;
    },

    getFromEmail() {
      return config.from_address;
    },
  };
}

async function compileRawMessage(opts) {
  const { MailComposer } = await import("nodemailer/lib/mail-composer/index.js");
  const mail = new MailComposer(opts);
  return new Promise((resolve, reject) => {
    mail.compile().build((err, message) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}
