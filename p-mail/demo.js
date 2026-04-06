import { createServer } from "./server/index.js";
import { simpleParser } from "mailparser";

// --- Hardcoded config (no config.toml needed) ---
const config = {
  server: { port: 3001, host: "0.0.0.0" },
  imap: { page_size: 50 },
  attachments: { max_upload_size: 26214400 },
  theme: {},
};

// --- In-memory message store ---
let nextUid = 1;
const store = { INBOX: [], Sent: [], Drafts: [], Trash: [] };

const folders = [
  { name: "INBOX", path: "INBOX", specialUse: "\\Inbox", delimiter: "/" },
  { name: "Sent", path: "Sent", specialUse: "\\Sent", delimiter: "/" },
  { name: "Drafts", path: "Drafts", specialUse: "\\Drafts", delimiter: "/" },
  { name: "Trash", path: "Trash", specialUse: "\\Trash", delimiter: "/" },
];

function addMessage(folder, opts) {
  const uid = nextUid++;
  const from = Array.isArray(opts.from) ? opts.from : [opts.from];
  const to = Array.isArray(opts.to) ? opts.to : [opts.to];
  store[folder].push({
    uid,
    flags: [...(opts.flags || [])],
    envelope: {
      date: new Date(opts.date),
      subject: opts.subject,
      from,
      to,
      cc: opts.cc ? (Array.isArray(opts.cc) ? opts.cc : [opts.cc]) : [],
      bcc: [],
      replyTo: from,
      messageId: opts.messageId || `<${uid}@demo.local>`,
      inReplyTo: opts.inReplyTo || null,
    },
    raw: Buffer.from(opts.raw),
    bodyStructure: opts.bodyStructure || { type: "text/plain", part: "1" },
    hasAttachments: opts.hasAttachments || false,
  });
  return uid;
}

// --- Seed data ---

// Attachment content (reused in getAttachment mock)
const meetingNotes = `Meeting Notes - Feb 20, 2026

Attendees: Alice, Bob, You

Topics:
- Project timeline review
- Budget allocation for Q2
- Next milestones and deliverables

Action Items:
- You: Finalize specs by Wednesday
- Alice: Send updated timeline
- Bob: Review budget proposal

Next meeting: Feb 27, same time.
`;
const meetingNotesB64 = Buffer.from(meetingNotes).toString("base64");

// INBOX: Welcome email (HTML, unread)
addMessage("INBOX", {
  from: { name: "p-mail Team", address: "team@p-mail.dev" },
  to: { name: "Demo User", address: "you@demo.local" },
  subject: "Welcome to p-mail!",
  date: "2026-02-22T09:00:00Z",
  messageId: "<welcome@demo.local>",
  raw: [
    'From: "p-mail Team" <team@p-mail.dev>',
    'To: "Demo User" <you@demo.local>',
    "Subject: Welcome to p-mail!",
    "Date: Sun, 22 Feb 2026 09:00:00 +0000",
    "Message-ID: <welcome@demo.local>",
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<html><body>",
    '<h2 style="color: #2563eb;">Welcome to p-mail!</h2>',
    "<p>This is a <strong>demo</strong> of your new email client. Here's what you can do:</p>",
    "<ul>",
    "  <li>Read and compose emails</li>",
    "  <li>HTML email rendering with external image blocking</li>",
    "  <li>Save and resume drafts</li>",
    "  <li>Manage email templates</li>",
    "  <li>Search across your messages</li>",
    "</ul>",
    '<p>Try composing a message, saving a draft, or searching for <em>"project"</em>.</p>',
    '<p style="color: #666; border-top: 1px solid #ddd; padding-top: 12px; margin-top: 16px;">\u2014 The p-mail Team</p>',
    "</body></html>",
  ].join("\r\n"),
});

// INBOX: Newsletter with external image (HTML, unread)
addMessage("INBOX", {
  from: { name: "Tech Weekly", address: "newsletter@techweekly.example" },
  to: { name: "Demo User", address: "you@demo.local" },
  subject: "This Week in Tech: AI Agents, Rust 2026, and More",
  date: "2026-02-21T15:30:00Z",
  messageId: "<newsletter-42@techweekly.example>",
  raw: [
    'From: "Tech Weekly" <newsletter@techweekly.example>',
    'To: "Demo User" <you@demo.local>',
    "Subject: This Week in Tech: AI Agents, Rust 2026, and More",
    "Date: Sat, 21 Feb 2026 15:30:00 +0000",
    "Message-ID: <newsletter-42@techweekly.example>",
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    '<html><body style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto;">',
    '<img src="https://example.com/newsletter/header.png" alt="Tech Weekly" style="width: 100%; height: auto;">',
    '<h3 style="color: #1a1a1a;">Top Stories This Week</h3>',
    "<p><strong>AI Agents Go Mainstream</strong> \u2014 New frameworks are making it easier than ever to build autonomous agent systems. Several major companies announced agent-first developer tools this week.</p>",
    '<hr style="border: none; border-top: 1px solid #eee;">',
    "<p><strong>Rust 2026 Edition Released</strong> \u2014 The latest edition brings long-awaited async improvements, better error messages, and streamlined trait syntax.</p>",
    '<hr style="border: none; border-top: 1px solid #eee;">',
    "<p><strong>WebAssembly Components Hit 1.0</strong> \u2014 The component model specification is finalized, enabling true cross-language interop in the browser and beyond.</p>",
    '<p style="font-size: 12px; color: #999; margin-top: 24px;">You received this because you subscribed to Tech Weekly.</p>',
    "</body></html>",
  ].join("\r\n"),
});

// INBOX: Message with attachment (unread)
addMessage("INBOX", {
  from: { name: "Alice Chen", address: "alice@example.com" },
  to: { name: "Demo User", address: "you@demo.local" },
  subject: "Meeting notes from Friday",
  date: "2026-02-20T17:45:00Z",
  messageId: "<alice-notes@example.com>",
  hasAttachments: true,
  bodyStructure: {
    type: "multipart/mixed",
    childNodes: [
      { type: "text/plain", part: "1", encoding: "7bit", size: 95 },
      {
        type: "text/plain",
        part: "2",
        encoding: "base64",
        size: meetingNotes.length,
        disposition: "attachment",
        dispositionParameters: { filename: "meeting-notes.txt" },
      },
    ],
  },
  raw: [
    'From: "Alice Chen" <alice@example.com>',
    'To: "Demo User" <you@demo.local>',
    "Subject: Meeting notes from Friday",
    "Date: Fri, 20 Feb 2026 17:45:00 +0000",
    "Message-ID: <alice-notes@example.com>",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="----=_Part_001"',
    "",
    "------=_Part_001",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hey, here are the notes from our meeting on Friday.",
    "Let me know if I missed anything!",
    "",
    "- Alice",
    "",
    "------=_Part_001",
    'Content-Type: text/plain; charset=utf-8; name="meeting-notes.txt"',
    'Content-Disposition: attachment; filename="meeting-notes.txt"',
    "Content-Transfer-Encoding: base64",
    "",
    meetingNotesB64,
    "",
    "------=_Part_001--",
  ].join("\r\n"),
});

// INBOX: Reply from Bob (read)
addMessage("INBOX", {
  from: { name: "Bob Martinez", address: "bob@example.com" },
  to: { name: "Demo User", address: "you@demo.local" },
  subject: "Re: Project proposal",
  date: "2026-02-19T11:20:00Z",
  messageId: "<bob-reply@example.com>",
  inReplyTo: "<your-proposal@demo.local>",
  flags: ["\\Seen"],
  raw: [
    'From: "Bob Martinez" <bob@example.com>',
    'To: "Demo User" <you@demo.local>',
    "Subject: Re: Project proposal",
    "Date: Wed, 19 Feb 2026 11:20:00 +0000",
    "Message-ID: <bob-reply@example.com>",
    "In-Reply-To: <your-proposal@demo.local>",
    "References: <your-proposal@demo.local>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Looks great! I think we should go with option B. The timeline",
    "is more realistic and the cost is within budget.",
    "",
    "Can we schedule a call next week to discuss the details?",
    "",
    "Bob",
  ].join("\r\n"),
});

// INBOX: Question from Carol (read)
addMessage("INBOX", {
  from: { name: "Carol Davis", address: "carol@example.com" },
  to: { name: "Demo User", address: "you@demo.local" },
  subject: "Quick question about the API",
  date: "2026-02-18T14:10:00Z",
  messageId: "<carol-question@example.com>",
  flags: ["\\Seen"],
  raw: [
    'From: "Carol Davis" <carol@example.com>',
    'To: "Demo User" <you@demo.local>',
    "Subject: Quick question about the API",
    "Date: Tue, 18 Feb 2026 14:10:00 +0000",
    "Message-ID: <carol-question@example.com>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hi,",
    "",
    "I was looking at the API docs and had a quick question \u2014 is the",
    "/users endpoint paginated by default or do we need to pass a",
    "page parameter?",
    "",
    "Also, are there rate limits we should be aware of?",
    "",
    "Thanks,",
    "Carol",
  ].join("\r\n"),
});

// Sent: Reply to Bob
addMessage("Sent", {
  from: { name: "Demo User", address: "you@demo.local" },
  to: { name: "Bob Martinez", address: "bob@example.com" },
  subject: "Re: Project proposal",
  date: "2026-02-19T14:05:00Z",
  messageId: "<your-reply-to-bob@demo.local>",
  inReplyTo: "<bob-reply@example.com>",
  flags: ["\\Seen"],
  raw: [
    'From: "Demo User" <you@demo.local>',
    'To: "Bob Martinez" <bob@example.com>',
    "Subject: Re: Project proposal",
    "Date: Wed, 19 Feb 2026 14:05:00 +0000",
    "Message-ID: <your-reply-to-bob@demo.local>",
    "In-Reply-To: <bob-reply@example.com>",
    "References: <your-proposal@demo.local> <bob-reply@example.com>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Sounds good, Bob! Let's do Tuesday at 2pm.",
    "I'll send a calendar invite.",
  ].join("\r\n"),
});

// Sent: Original proposal to Bob
addMessage("Sent", {
  from: { name: "Demo User", address: "you@demo.local" },
  to: { name: "Bob Martinez", address: "bob@example.com" },
  subject: "Project proposal",
  date: "2026-02-18T09:00:00Z",
  messageId: "<your-proposal@demo.local>",
  flags: ["\\Seen"],
  raw: [
    'From: "Demo User" <you@demo.local>',
    'To: "Bob Martinez" <bob@example.com>',
    "Subject: Project proposal",
    "Date: Tue, 18 Feb 2026 09:00:00 +0000",
    "Message-ID: <your-proposal@demo.local>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hi Bob,",
    "",
    "I've put together a project proposal with two options:",
    "",
    "Option A: Aggressive timeline (8 weeks), higher cost",
    "Option B: Relaxed timeline (12 weeks), fits within budget",
    "",
    "Both options deliver the same scope. Let me know your thoughts!",
    "",
    "Best,",
    "Demo User",
  ].join("\r\n"),
});

// Drafts: Draft to Dave (HTML, in progress)
addMessage("Drafts", {
  from: { name: "Demo User", address: "you@demo.local" },
  to: { name: "Dave Wilson", address: "dave@example.com" },
  subject: "Quarterly report feedback",
  date: "2026-02-22T20:00:00Z",
  messageId: "<draft-1@demo.local>",
  flags: ["\\Draft", "\\Seen"],
  raw: [
    'From: "Demo User" <you@demo.local>',
    'To: "Dave Wilson" <dave@example.com>',
    "Subject: Quarterly report feedback",
    "Date: Sun, 22 Feb 2026 20:00:00 +0000",
    "Message-ID: <draft-1@demo.local>",
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<html><body>",
    "<p>Hi Dave,</p>",
    "<p>I've reviewed the quarterly report and have a few suggestions:</p>",
    "<ul>",
    "  <li>The revenue section could use more detail on regional breakdown</li>",
    "  <li>Customer retention numbers look great \u2014 let's highlight those</li>",
    "  <li>Missing comparison to last quarter's projections</li>",
    "</ul>",
    "<p>Overall it's looking good. Let me know if you want to </p>",
    "</body></html>",
  ].join("\r\n"),
});

// Trash: Spam message
addMessage("Trash", {
  from: { name: "Special Offers", address: "deals@totallylegit.example" },
  to: { name: "Demo User", address: "you@demo.local" },
  subject: "You won't BELIEVE these deals!!!",
  date: "2026-02-16T03:22:00Z",
  messageId: "<spam-1@totallylegit.example>",
  flags: ["\\Seen"],
  raw: [
    'From: "Special Offers" <deals@totallylegit.example>',
    'To: "Demo User" <you@demo.local>',
    "Subject: You won't BELIEVE these deals!!!",
    "Date: Mon, 16 Feb 2026 03:22:00 +0000",
    "Message-ID: <spam-1@totallylegit.example>",
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<html><body>",
    '<h1 style="color: red; font-size: 28px;">AMAZING DEALS!!!</h1>',
    "<p>Click here for INCREDIBLE savings on products you never knew you needed!</p>",
    "<p>Act now before it's TOO LATE!</p>",
    '<p style="font-size: 8px; color: #ccc;">To unsubscribe, reply with STOP.</p>',
    "</body></html>",
  ].join("\r\n"),
});

// --- Mock IMAP ---
const imap = {
  async listFolders() {
    return folders;
  },

  async folderStatus(folder) {
    const msgs = store[folder] || [];
    return {
      messages: msgs.length,
      unseen: msgs.filter((m) => !m.flags.includes("\\Seen")).length,
    };
  },

  async listMessages(folder, page = 1, pageSize = 50) {
    const msgs = store[folder] || [];
    const sorted = [...msgs].sort((a, b) => b.envelope.date - a.envelope.date);
    const total = sorted.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const slice = sorted.slice(start, start + pageSize);
    return {
      messages: slice.map((m, i) => ({
        uid: m.uid,
        seq: start + i + 1,
        flags: m.flags,
        envelope: m.envelope,
        hasAttachments: m.hasAttachments,
      })),
      total,
      page,
      pages,
    };
  },

  async getMessage(folder, uid) {
    const msgs = store[folder] || [];
    const m = msgs.find((msg) => msg.uid === Number(uid));
    if (!m) return null;
    return {
      uid: m.uid,
      flags: m.flags,
      envelope: m.envelope,
      source: m.raw,
      bodyStructure: m.bodyStructure,
    };
  },

  async getAttachment() {
    return {
      data: Buffer.from(meetingNotes),
      meta: {
        contentType: "text/plain",
        filename: "meeting-notes.txt",
        disposition: "attachment",
      },
    };
  },

  async moveMessages(fromFolder, uids, destination) {
    if (!store[destination]) store[destination] = [];
    const numUids = uids.map(Number);
    const src = store[fromFolder] || [];
    const toMove = src.filter((m) => numUids.includes(m.uid));
    store[fromFolder] = src.filter((m) => !numUids.includes(m.uid));
    store[destination].push(...toMove);
  },

  async deleteMessages(folder, uids) {
    const numUids = uids.map(Number);
    store[folder] = (store[folder] || []).filter(
      (m) => !numUids.includes(m.uid),
    );
  },

  async setFlags(folder, uids, flags, action = "add") {
    const numUids = uids.map(Number);
    for (const m of store[folder] || []) {
      if (!numUids.includes(m.uid)) continue;
      if (action === "add") {
        for (const f of flags) if (!m.flags.includes(f)) m.flags.push(f);
      } else if (action === "remove") {
        m.flags = m.flags.filter((f) => !flags.includes(f));
      } else if (action === "set") {
        m.flags = [...flags];
      }
    }
  },

  async appendMessage(folder, raw, flags = []) {
    if (!store[folder]) store[folder] = [];
    const uid = nextUid++;
    const parsed = await simpleParser(raw);
    store[folder].push({
      uid,
      flags: [...flags],
      envelope: {
        date: parsed.date || new Date(),
        subject: parsed.subject || "(no subject)",
        from: parsed.from?.value || [],
        to: parsed.to?.value || [],
        cc: parsed.cc?.value || [],
        bcc: parsed.bcc?.value || [],
        replyTo: parsed.from?.value || [],
        messageId: parsed.messageId || `<${uid}@demo.local>`,
        inReplyTo: parsed.inReplyTo || null,
      },
      raw: Buffer.isBuffer(raw) ? raw : Buffer.from(raw),
      bodyStructure: { type: "text/plain", part: "1" },
      hasAttachments: false,
    });
    return { uid };
  },

  async search(folder, query) {
    const q = query.toLowerCase();
    return (store[folder] || [])
      .filter((m) => {
        const { subject = "", from = [], to = [] } = m.envelope;
        const text = [
          subject,
          ...from.map((a) => `${a.name} ${a.address}`),
          ...to.map((a) => `${a.name} ${a.address}`),
        ]
          .join(" ")
          .toLowerCase();
        return text.includes(q);
      })
      .map((m, i) => ({
        uid: m.uid,
        seq: i + 1,
        flags: m.flags,
        envelope: m.envelope,
        hasAttachments: m.hasAttachments,
      }));
  },

  async getDraftFolder() {
    return "Drafts";
  },
  async getSentFolder() {
    return "Sent";
  },
  async getTrashFolder() {
    return "Trash";
  },
};

// --- Mock SMTP ---
const smtp = {
  async send(opts) {
    console.log(`[demo] Email sent to: ${opts.to} | Subject: ${opts.subject}`);
    return {
      messageId: `<sent-${Date.now()}@demo.local>`,
      response: "250 OK",
    };
  },

  getFromAddress() {
    return '"Demo User" <you@demo.local>';
  },

  getFromEmail() {
    return "you@demo.local";
  },
};

// --- Start server ---
const server = createServer(config, imap, smtp);
console.log(
  `p-mail demo running at http://${server.hostname}:${server.port}`,
);
console.log(
  "  INBOX: 5 messages (3 unread) | Sent: 2 | Drafts: 1 | Trash: 1",
);
