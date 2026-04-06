import { writeFile } from "fs/promises";
import { join } from "path";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ────────────────────────────────────────────────

const PLACEHOLDER_ADDRESSES = {
  sender: "SENDER@SENDER.SEND",
  recipient: "RECIPIENT@RECIPIENT.RECEIVE",
  cc: "CC@CC.COPY",
  bcc: "BCC@BCC.BLIND",
  replyTo: "REPLY@REPLY.TO",
};

// ── Types ────────────────────────────────────────────────────

interface EmailNotepad {
  to?: string;
  toName?: string;
  from?: string;
  fromName?: string;
  subject: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  importance?: string;
  notepadFilename?: string;
  createdAt: string;
  updatedAt: string;
  messageId?: string;
  date?: Date;
}

interface NotepadTool {
  write(args: {
    sessionId: string;
    filename: string;
    content: string;
    append: boolean;
  }): Promise<unknown>;
}

// ── In-memory storage ────────────────────────────────────────

const emailNotepads = new Map<string, EmailNotepad>();

// ── Helpers ──────────────────────────────────────────────────

function generateMessageId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `<${timestamp}.${random}@yaygent.local>`;
}

function formatEmailDate(date: Date = new Date()): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  const d = days[date.getDay()];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  const tzOffset = -date.getTimezoneOffset();
  const tzSign = tzOffset >= 0 ? "+" : "-";
  const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, "0");
  const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, "0");

  return `${d}, ${day} ${month} ${year} ${hours}:${minutes}:${seconds} ${tzSign}${tzHours}${tzMins}`;
}

function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  const encoded = Buffer.from(value, "utf-8").toString("base64");
  return `=?UTF-8?B?${encoded}?=`;
}

function formatAddr(email: string, name?: string): string {
  if (name) return `${encodeHeaderValue(name)} <${email}>`;
  return email;
}

function wrapLines(text: string, maxLength = 76): string {
  const lines = text.split("\n");
  const wrapped: string[] = [];

  for (const line of lines) {
    if (line.length <= maxLength) {
      wrapped.push(line);
      continue;
    }

    let remaining = line;
    while (remaining.length > maxLength) {
      let breakPoint = remaining.lastIndexOf(" ", maxLength);
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = maxLength;
      }
      wrapped.push(remaining.slice(0, breakPoint));
      remaining = remaining.slice(breakPoint).trimStart();
    }
    if (remaining) wrapped.push(remaining);
  }

  return wrapped.join("\n");
}

function buildEmlContent(email: EmailNotepad): string {
  const lines: string[] = [];

  lines.push(`From: ${formatAddr(email.from || PLACEHOLDER_ADDRESSES.sender, email.fromName)}`);
  lines.push(`To: ${formatAddr(email.to || PLACEHOLDER_ADDRESSES.recipient, email.toName)}`);
  lines.push(`Subject: ${encodeHeaderValue(email.subject || "(No Subject)")}`);
  lines.push(`Date: ${formatEmailDate(email.date || new Date())}`);
  lines.push(`Message-ID: ${email.messageId || generateMessageId()}`);

  if (email.cc) {
    const ccAddresses = Array.isArray(email.cc) ? email.cc : [email.cc];
    lines.push(`Cc: ${ccAddresses.map((addr) => formatAddr(addr)).join(", ")}`);
  }

  if (email.bcc) {
    const bccAddresses = Array.isArray(email.bcc) ? email.bcc : [email.bcc];
    lines.push(`Bcc: ${bccAddresses.map((addr) => formatAddr(addr)).join(", ")}`);
  }

  if (email.replyTo) {
    lines.push(`Reply-To: ${formatAddr(email.replyTo)}`);
  }

  lines.push("MIME-Version: 1.0");
  lines.push("Content-Type: text/plain; charset=UTF-8");
  lines.push("Content-Transfer-Encoding: 8bit");
  lines.push("X-Mailer: YayAgent Compose Email Tool");
  lines.push("X-Priority: 3");

  if (email.importance) {
    lines.push(`Importance: ${email.importance}`);
  }

  lines.push("");
  lines.push(wrapLines(email.body || ""));

  return lines.join("\r\n");
}

// ── Notepad sync ─────────────────────────────────────────────

async function syncToNotepad(
  notepadTool: NotepadTool | null,
  sessionId: string,
  notepad: EmailNotepad,
  notepadFilename = "email_draft"
): Promise<string | null> {
  if (!notepadTool) return null;

  try {
    const emailContent = [
      `Subject: ${notepad.subject || "(No Subject)"}`,
      `From: ${notepad.fromName ? `${notepad.fromName} <${notepad.from}>` : notepad.from}`,
      `To: ${notepad.toName ? `${notepad.toName} <${notepad.to}>` : notepad.to}`,
      notepad.cc ? `Cc: ${notepad.cc}` : null,
      notepad.bcc ? `Bcc: ${notepad.bcc}` : null,
      "",
      notepad.body || "",
    ]
      .filter((line) => line !== null)
      .join("\n");

    await notepadTool.write({
      sessionId,
      filename: notepadFilename,
      content: emailContent,
      append: false,
    });

    return notepadFilename;
  } catch (err) {
    console.error(`[compose_email] Failed to sync to notepad: ${(err as Error).message}`);
    return null;
  }
}

// ── Action handlers ──────────────────────────────────────────

async function newEmail(
  args: Record<string, unknown>,
  sessionId: string,
  notepadTool: NotepadTool | null,
  defaultAddresses: typeof PLACEHOLDER_ADDRESSES
): Promise<ToolResult> {
  const to = args.to as string | undefined;
  const toName = args.toName as string | undefined;
  const from = args.from as string | undefined;
  const fromName = args.fromName as string | undefined;
  const subject = (args.subject as string) ?? "";
  const body = (args.body as string) ?? "";
  const cc = args.cc as string | string[] | undefined;
  const bcc = args.bcc as string | string[] | undefined;
  const replyTo = args.replyTo as string | undefined;
  const importance = args.importance as string | undefined;
  const usePlaceholders = (args.usePlaceholders as boolean) !== false;
  const notepadFilename = (args.notepadFilename as string) ?? "email_draft";

  const notepad: EmailNotepad = {
    to: to || (usePlaceholders ? defaultAddresses.recipient : undefined),
    toName,
    from: from || (usePlaceholders ? defaultAddresses.sender : undefined),
    fromName,
    subject,
    body,
    cc,
    bcc,
    replyTo,
    importance,
    notepadFilename,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  emailNotepads.set(sessionId, notepad);

  const syncedFilename = await syncToNotepad(notepadTool, sessionId, notepad, notepadFilename);

  return formatResponse({
    success: true,
    action: "compose",
    message: "New email composition started",
    notepad: {
      to: notepad.to,
      from: notepad.from,
      subject: notepad.subject,
      bodyLength: notepad.body.length,
      hasPlaceholders: usePlaceholders,
    },
    syncedToNotepad: !!syncedFilename,
    notepadFilename: syncedFilename,
    notepadAccess: syncedFilename
      ? {
          tool: "notepad_read",
          sessionId,
          filename: syncedFilename,
          hint: `Use notepad_read with sessionId="${sessionId}" and filename="${syncedFilename}" to read this email`,
        }
      : null,
    instructions: [
      'Use action="append" with text="..." to add content to the body',
      'Use action="set" with field="subject" and value="..." to update fields',
      'Use action="preview" to see the full email',
      'Use action="export" to save as .eml file',
      "Placeholder addresses can be replaced with token_replace tool",
      syncedFilename
        ? `Email content is available via notepad_read with sessionId="${sessionId}" and filename="${syncedFilename}"`
        : null,
    ].filter(Boolean),
  });
}

async function appendBody(
  args: Record<string, unknown>,
  sessionId: string,
  notepadTool: NotepadTool | null,
  defaultAddresses: typeof PLACEHOLDER_ADDRESSES
): Promise<ToolResult> {
  const text = args.text as string | undefined;
  const newline = (args.newline as boolean) !== false;

  if (!text) return formatError("text is required for append action");

  let notepad = emailNotepads.get(sessionId);
  if (!notepad) {
    notepad = {
      to: defaultAddresses.recipient,
      from: defaultAddresses.sender,
      subject: "",
      body: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    emailNotepads.set(sessionId, notepad);
  }

  notepad.body += text + (newline ? "\n" : "");
  notepad.updatedAt = new Date().toISOString();

  await syncToNotepad(notepadTool, sessionId, notepad, notepad.notepadFilename || "email_draft");

  return formatResponse({
    success: true,
    action: "append",
    message: `Appended ${text.length} characters to body`,
    bodyLength: notepad.body.length,
    lineCount: notepad.body.split("\n").length,
    notepadFilename: notepad.notepadFilename || "email_draft",
  });
}

async function updateField(
  args: Record<string, unknown>,
  sessionId: string,
  notepadTool: NotepadTool | null
): Promise<ToolResult> {
  const field = args.field as string | undefined;
  const value = args.value as string | undefined;

  if (!field) return formatError("field is required for set action");

  const notepad = emailNotepads.get(sessionId);
  if (!notepad) {
    return formatError('No email composition in progress. Use action="compose" first.');
  }

  const allowedFields = [
    "to", "toName", "from", "fromName", "subject", "body",
    "cc", "bcc", "replyTo", "importance",
  ];
  if (!allowedFields.includes(field)) {
    return formatError(`Invalid field: ${field}. Allowed: ${allowedFields.join(", ")}`);
  }

  (notepad as Record<string, unknown>)[field] = value;
  notepad.updatedAt = new Date().toISOString();

  await syncToNotepad(notepadTool, sessionId, notepad, notepad.notepadFilename || "email_draft");

  return formatResponse({
    success: true,
    action: "set",
    field,
    message: `Updated ${field}`,
    preview: field === "body" ? `${String(value).slice(0, 50)}...` : value,
    notepadFilename: notepad.notepadFilename || "email_draft",
  });
}

async function preview(args: Record<string, unknown>, sessionId: string): Promise<ToolResult> {
  const format = (args.format as string) ?? "summary";

  const notepad = emailNotepads.get(sessionId);
  if (!notepad) {
    return formatError('No email composition in progress. Use action="compose" first.');
  }

  if (format === "full" || format === "eml") {
    const emlContent = buildEmlContent(notepad);
    return formatResponse({
      success: true,
      action: "preview",
      format: "eml",
      content: emlContent,
    });
  }

  return formatResponse({
    success: true,
    action: "preview",
    format: "summary",
    email: {
      from: notepad.from,
      fromName: notepad.fromName,
      to: notepad.to,
      toName: notepad.toName,
      cc: notepad.cc,
      bcc: notepad.bcc,
      replyTo: notepad.replyTo,
      subject: notepad.subject,
      bodyPreview: notepad.body.slice(0, 200) + (notepad.body.length > 200 ? "..." : ""),
      bodyLength: notepad.body.length,
      lineCount: notepad.body.split("\n").length,
      importance: notepad.importance,
      createdAt: notepad.createdAt,
      updatedAt: notepad.updatedAt,
    },
    placeholderInfo: {
      senderPlaceholder: PLACEHOLDER_ADDRESSES.sender,
      recipientPlaceholder: PLACEHOLDER_ADDRESSES.recipient,
      note: "Use token_replace tool to replace placeholders with actual addresses",
    },
  });
}

async function exportEmail(
  args: Record<string, unknown>,
  sessionId: string,
  ctx: ToolContext
): Promise<ToolResult> {
  const outputPath = args.outputPath as string | undefined;
  const filename = args.filename as string | undefined;

  const notepad = emailNotepads.get(sessionId);
  if (!notepad) {
    return formatError('No email composition in progress. Use action="compose" first.');
  }

  const sandboxPath = await ctx.sandbox.ensureSandbox(sessionId);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeSubject = (notepad.subject || "email")
    .replace(/[^a-zA-Z0-9-_]/g, "_")
    .slice(0, 30);
  const defaultFilename = `${safeSubject}-${timestamp}.eml`;
  const finalFilename = filename || outputPath || defaultFilename;

  const emlContent = buildEmlContent(notepad);

  const absOutputPath = join(sandboxPath, finalFilename);
  await writeFile(absOutputPath, emlContent, "utf-8");

  return formatResponse({
    success: true,
    action: "export",
    outputPath: finalFilename,
    absolutePath: absOutputPath,
    fileSize: emlContent.length,
    message: "Email exported successfully",
    email: {
      from: notepad.from,
      to: notepad.to,
      subject: notepad.subject,
      bodyLength: notepad.body.length,
    },
    nextSteps: [
      "Use token_replace to substitute placeholder addresses",
      "Open .eml file in email client to send",
      "Or use pdf_export to create printable version",
    ],
  });
}

async function clearEmail(sessionId: string): Promise<ToolResult> {
  const existed = emailNotepads.has(sessionId);
  emailNotepads.delete(sessionId);

  return formatResponse({
    success: true,
    action: "clear",
    message: existed ? "Email composition cleared" : "No composition was in progress",
  });
}

async function statusEmail(sessionId: string): Promise<ToolResult> {
  const notepad = emailNotepads.get(sessionId);

  if (!notepad) {
    return formatResponse({
      success: true,
      action: "status",
      hasComposition: false,
      message: "No email composition in progress",
    });
  }

  return formatResponse({
    success: true,
    action: "status",
    hasComposition: true,
    email: {
      from: notepad.from,
      to: notepad.to,
      subject: notepad.subject,
      bodyLength: notepad.body.length,
      lineCount: notepad.body.split("\n").length,
    },
    createdAt: notepad.createdAt,
    updatedAt: notepad.updatedAt,
  });
}

// ── Execute entry point ──────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  const action = (args.action as string) ?? "compose";

  if (!sessionId) return formatError("sessionId is required for sandbox isolation");

  const notepadTool = (ctx.config.notepadTool as NotepadTool | undefined) ?? null;
  const defaultAddresses = {
    ...PLACEHOLDER_ADDRESSES,
    ...((ctx.config.defaultAddresses as Partial<typeof PLACEHOLDER_ADDRESSES>) ?? {}),
  };

  switch (action) {
    case "compose":
    case "new":
      return newEmail(args, sessionId, notepadTool, defaultAddresses);
    case "append":
    case "stream":
      return appendBody(args, sessionId, notepadTool, defaultAddresses);
    case "set":
    case "update":
      return updateField(args, sessionId, notepadTool);
    case "preview":
      return preview(args, sessionId);
    case "export":
    case "save":
      return exportEmail(args, sessionId, ctx);
    case "clear":
      return clearEmail(sessionId);
    case "status":
      return statusEmail(sessionId);
    default:
      return formatError(`Unknown action: ${action}. Use: compose, append, set, preview, export, clear, status`);
  }
}

// ── Tool Definition ─────────────────────────────────────────

const composeEmailTool: Tool = {
  name: "compose_email",
  description: `Compose emails by streaming text to a notepad resource, then export as .eml file.

CROSS-TOOL ACCESS (IMPORTANT):
- Email content is automatically saved to notepad for other tools to access
- Default notepad filename: "email_draft" (customizable via notepadFilename parameter)
- To read email content from another task, use: notepad_read with the SAME sessionId and filename="email_draft"
- The response includes notepadAccess object with exact parameters needed to read the email

IMPORTANT EMAIL FORMATTING:
- Uses placeholder addresses by default for template-style composition
- Default sender: SENDER@SENDER.SEND
- Default recipient: RECIPIENT@RECIPIENT.RECEIVE
- Replace placeholders using token_replace tool before sending

WORKFLOW:
1. action="compose" - Start new email with subject, optional body (saves to notepad automatically)
2. action="append" - Stream/add text to body incrementally (updates notepad)
3. action="set" - Update specific fields (to, from, subject, etc.) (updates notepad)
4. action="preview" - View email before export
5. action="export" - Save as .eml file

The exported .eml file can be:
- Opened in any email client (Outlook, Thunderbird, Apple Mail)
- Processed with token_replace to substitute placeholder addresses
- Converted to PDF using pdf_export tool`,
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID for sandbox isolation (required)",
      },
      action: {
        type: "string",
        enum: [
          "compose", "new", "append", "stream", "set", "update",
          "preview", "export", "save", "clear", "status",
        ],
        default: "compose",
        description: "Action to perform on the email notepad",
      },
      to: {
        type: "string",
        description: "Recipient email (default: RECIPIENT@RECIPIENT.RECEIVE)",
      },
      toName: {
        type: "string",
        description: "Recipient display name",
      },
      from: {
        type: "string",
        description: "Sender email (default: SENDER@SENDER.SEND)",
      },
      fromName: {
        type: "string",
        description: "Sender display name",
      },
      subject: {
        type: "string",
        description: "Email subject line",
      },
      body: {
        type: "string",
        description: "Initial email body content",
      },
      cc: {
        type: ["string", "array"],
        description: "CC recipients (single or array)",
      },
      bcc: {
        type: ["string", "array"],
        description: "BCC recipients (single or array)",
      },
      replyTo: {
        type: "string",
        description: "Reply-To address",
      },
      importance: {
        type: "string",
        enum: ["low", "normal", "high"],
        description: "Email importance level",
      },
      usePlaceholders: {
        type: "boolean",
        default: true,
        description: "Use placeholder addresses (SENDER@SENDER.SEND, RECIPIENT@RECIPIENT.RECEIVE)",
      },
      notepadFilename: {
        type: "string",
        default: "email_draft",
        description:
          'Filename for notepad cross-tool access. Email content is automatically saved to notepad and can be read via notepad_read with this filename and the same sessionId.',
      },
      text: {
        type: "string",
        description: "Text to append to email body",
      },
      newline: {
        type: "boolean",
        default: true,
        description: "Add newline after appended text",
      },
      field: {
        type: "string",
        enum: ["to", "toName", "from", "fromName", "subject", "body", "cc", "bcc", "replyTo", "importance"],
        description: "Field to update",
      },
      value: {
        type: "string",
        description: "New value for the field",
      },
      format: {
        type: "string",
        enum: ["summary", "full", "eml"],
        default: "summary",
        description: "Preview format (summary or full .eml content)",
      },
      outputPath: {
        type: "string",
        description: "Output filename for .eml file (auto-generated if not provided)",
      },
      filename: {
        type: "string",
        description: "Alias for outputPath",
      },
    },
    required: ["sessionId"],
  },
  execute,
};

export default composeEmailTool;
