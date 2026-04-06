import { readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import { resolve, basename, extname } from "path";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ────────────────────────────────────────────────

const DEFAULT_LIMITS = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxEmails: 20,
};

// ── Types ────────────────────────────────────────────────────

interface EmailAddress {
  name: string | null;
  email: string;
}

interface ParsedEmail {
  from: EmailAddress | EmailAddress[] | null;
  to: EmailAddress | EmailAddress[] | null;
  cc: EmailAddress | EmailAddress[] | null;
  bcc: EmailAddress | EmailAddress[] | null;
  replyTo: EmailAddress | EmailAddress[] | null;
  subject: string;
  date: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  contentType: string;
  importance: string;
  headers: Record<string, string>;
  body: string;
  bodyPreview: string;
}

interface FileEntry {
  path: string;
  content: string;
  extension: string;
  size: number;
  addedAt: string;
  source: string;
  originalPath: string;
  emailMetadata: {
    from: string;
    to: string;
    subject: string;
    date: string | null;
    hasAttachments: boolean;
  };
}

interface SessionContext {
  files: FileEntry[];
  metadata: Record<string, unknown>;
  formattedContent?: string;
}

interface Session {
  context?: SessionContext;
  sandboxPath?: string;
  [key: string]: unknown;
}

// ── Email Parsing Helpers ────────────────────────────────────

function decodeHeaderValue(value: string): string {
  if (!value) return "";

  const encodedWordRegex = /=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi;

  return value.replace(encodedWordRegex, (match, _charset: string, encoding: string, text: string) => {
    try {
      if (encoding.toUpperCase() === "B") {
        return Buffer.from(text, "base64").toString("utf-8");
      } else if (encoding.toUpperCase() === "Q") {
        return text
          .replace(/_/g, " ")
          .replace(/=([0-9A-F]{2})/gi, (_m: string, hex: string) =>
            String.fromCharCode(parseInt(hex, 16))
          );
      }
    } catch {
      // Return original if decoding fails
    }
    return match;
  });
}

function parseAddressHeader(header: string | undefined): EmailAddress | EmailAddress[] | null {
  if (!header) return null;

  const addresses: EmailAddress[] = [];
  const parts = header.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^(?:"?([^"<]*)"?\s*)?<?([^<>\s]+@[^<>\s]+)>?$/);

    if (match) {
      addresses.push({
        name: match[1]?.trim() || null,
        email: match[2].trim(),
      });
    } else {
      addresses.push({ name: null, email: trimmed });
    }
  }

  if (addresses.length === 0) return null;
  if (addresses.length === 1) return addresses[0];
  return addresses;
}

function formatAddress(addr: EmailAddress | EmailAddress[] | null): string {
  if (!addr) return "";

  if (Array.isArray(addr)) {
    return addr.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ");
  }

  return addr.name ? `${addr.name} <${addr.email}>` : addr.email;
}

function parseEmlContent(content: string): ParsedEmail {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const headerBodySplit = normalized.indexOf("\n\n");
  let headerSection: string;
  let bodySection: string;

  if (headerBodySplit === -1) {
    headerSection = normalized;
    bodySection = "";
  } else {
    headerSection = normalized.slice(0, headerBodySplit);
    bodySection = normalized.slice(headerBodySplit + 2);
  }

  const headers: Record<string, string> = {};
  const headerLines = headerSection.split("\n");
  let currentHeader: string | null = null;
  let currentValue = "";

  for (const line of headerLines) {
    if (line.match(/^\s/) && currentHeader) {
      currentValue += " " + line.trim();
    } else {
      if (currentHeader) {
        headers[currentHeader.toLowerCase()] = decodeHeaderValue(currentValue);
      }
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        currentHeader = line.slice(0, colonIndex).trim();
        currentValue = line.slice(colonIndex + 1).trim();
      }
    }
  }

  if (currentHeader) {
    headers[currentHeader.toLowerCase()] = decodeHeaderValue(currentValue);
  }

  return {
    from: parseAddressHeader(headers["from"]),
    to: parseAddressHeader(headers["to"]),
    cc: parseAddressHeader(headers["cc"]),
    bcc: parseAddressHeader(headers["bcc"]),
    replyTo: parseAddressHeader(headers["reply-to"]),
    subject: headers["subject"] || "(No Subject)",
    date: headers["date"] || null,
    messageId: headers["message-id"] || null,
    inReplyTo: headers["in-reply-to"] || null,
    references: headers["references"] || null,
    contentType: headers["content-type"] || "text/plain",
    importance: headers["importance"] || headers["x-priority"] || "normal",
    headers,
    body: bodySection,
    bodyPreview: bodySection.slice(0, 500) + (bodySection.length > 500 ? "..." : ""),
  };
}

// ── Context Formatting Helpers ───────────────────────────────

function formatEmailForContext(email: ParsedEmail, includeRawHeaders = false): string {
  const lines: string[] = [
    "=== EMAIL ===",
    `From: ${formatAddress(email.from)}`,
    `To: ${formatAddress(email.to)}`,
  ];

  if (email.cc) lines.push(`Cc: ${formatAddress(email.cc)}`);
  if (email.bcc) lines.push(`Bcc: ${formatAddress(email.bcc)}`);

  lines.push(`Subject: ${email.subject}`);
  if (email.date) lines.push(`Date: ${email.date}`);
  if (email.messageId) lines.push(`Message-ID: ${email.messageId}`);
  if (email.inReplyTo) lines.push(`In-Reply-To: ${email.inReplyTo}`);

  lines.push("");
  lines.push("--- BODY ---");
  lines.push(email.body);
  lines.push("--- END ---");

  if (includeRawHeaders) {
    lines.push("");
    lines.push("--- RAW HEADERS ---");
    for (const [key, value] of Object.entries(email.headers)) {
      lines.push(`${key}: ${value}`);
    }
    lines.push("--- END HEADERS ---");
  }

  return lines.join("\n");
}

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatContextAsXml(files: FileEntry[]): string {
  const lines = ["<context>"];

  for (const file of files) {
    const ext = file.extension || "txt";
    lines.push(`  <file path="${escapeXml(file.path)}" extension="${ext}">`);
    lines.push(`    <content><![CDATA[${file.content}]]></content>`);
    lines.push("  </file>");
  }

  lines.push("</context>");
  return lines.join("\n");
}

// ── Tool Handlers ────────────────────────────────────────────

async function executeReadEmail(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  const filePath = args.path as string | undefined;
  const alias = args.alias as string | undefined;
  const includeRawHeaders = (args.includeRawHeaders as boolean) ?? false;

  const maxFileSize = (ctx.config.maxFileSize as number) ?? DEFAULT_LIMITS.maxFileSize;
  const maxEmails = (ctx.config.maxEmails as number) ?? DEFAULT_LIMITS.maxEmails;
  const allowedPaths = (ctx.config.allowedPaths as string[]) ?? [];
  const allowAbsolutePaths = (ctx.config.allowAbsolutePaths as boolean) !== false;

  if (!sessionId) return formatError("sessionId is required");
  if (!filePath) return formatError("path is required");

  const resolvedPath =
    allowAbsolutePaths && filePath.startsWith("/")
      ? filePath
      : resolve(process.cwd(), filePath);

  if (allowedPaths.length > 0) {
    const isAllowed = allowedPaths.some((allowed) =>
      resolvedPath.startsWith(resolve(process.cwd(), allowed))
    );
    if (!isAllowed) return formatError(`Path not allowed: ${filePath}`);
  }

  if (!existsSync(resolvedPath)) return formatError(`File not found: ${filePath}`);

  const ext = extname(resolvedPath).toLowerCase();
  if (ext !== ".eml" && ext !== ".msg" && ext !== ".email" && ext !== ".txt") {
    return formatError(`Unsupported email format: ${ext}. Supported: .eml, .msg, .email, .txt`);
  }

  try {
    const stats = await stat(resolvedPath);
    if (stats.size > maxFileSize) {
      return formatError(`File too large: ${stats.size} bytes (max: ${maxFileSize} bytes)`);
    }

    const content = await readFile(resolvedPath, "utf-8");
    const fileName = alias || basename(resolvedPath);
    const email = parseEmlContent(content);

    // Access session from config (session manager injects it)
    const session = (ctx.config._session as Session | undefined);
    if (!session) return formatError(`Session not found: ${sessionId}`);

    const currentEmailCount =
      session.context?.files?.filter((f) => f.source === "read_email_tool").length || 0;
    if (currentEmailCount >= maxEmails) {
      return formatError(`Maximum emails reached: ${maxEmails}. Cannot add more emails to context.`);
    }

    const formattedContent = formatEmailForContext(email, includeRawHeaders);

    const fileEntry: FileEntry = {
      path: `emails/${fileName}`,
      content: formattedContent,
      extension: "email",
      size: stats.size,
      addedAt: new Date().toISOString(),
      source: "read_email_tool",
      originalPath: filePath,
      emailMetadata: {
        from: formatAddress(email.from),
        to: formatAddress(email.to),
        subject: email.subject,
        date: email.date,
        hasAttachments: email.contentType?.includes("multipart") ?? false,
      },
    };

    if (!session.context) {
      session.context = { files: [], metadata: {} };
    }
    if (!session.context.files) {
      session.context.files = [];
    }

    const existingIndex = session.context.files.findIndex((f) => f.path === fileEntry.path);
    if (existingIndex >= 0) {
      session.context.files[existingIndex] = fileEntry;
    } else {
      session.context.files.push(fileEntry);
    }

    session.context.formattedContent = formatContextAsXml(session.context.files);

    return formatResponse({
      success: true,
      action: "read_email",
      email: {
        path: fileEntry.path,
        originalPath: filePath,
        from: formatAddress(email.from),
        to: formatAddress(email.to),
        cc: email.cc ? formatAddress(email.cc) : null,
        subject: email.subject,
        date: email.date,
        bodyPreview: email.bodyPreview,
        bodyLength: email.body.length,
        hasAttachments: email.contentType?.includes("multipart") ?? false,
      },
      contextFiles: session.context.files.length,
      message: `Email added to session context: ${fileName}`,
    });
  } catch (err) {
    return formatError(`Failed to read email: ${(err as Error).message}`);
  }
}

async function executeListEmails(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;

  if (!sessionId) return formatError("sessionId is required");

  const session = (ctx.config._session as Session | undefined);
  if (!session) return formatError(`Session not found: ${sessionId}`);

  const files = session.context?.files || [];
  const emailFiles = files.filter((f) => f.source === "read_email_tool");

  return formatResponse({
    success: true,
    action: "list",
    totalContextFiles: files.length,
    emails: emailFiles.map((f) => ({
      path: f.path,
      originalPath: f.originalPath,
      ...f.emailMetadata,
      addedAt: f.addedAt,
    })),
  });
}

async function executeRemoveEmail(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  const filePath = args.path as string | undefined;

  if (!sessionId) return formatError("sessionId is required");
  if (!filePath) return formatError("path is required");

  const session = (ctx.config._session as Session | undefined);
  if (!session) return formatError(`Session not found: ${sessionId}`);

  const files = session.context?.files || [];
  const targetPath = filePath.startsWith("emails/") ? filePath : `emails/${filePath}`;
  const index = files.findIndex((f) => f.path === targetPath);

  if (index < 0) return formatError(`Email not found in context: ${filePath}`);

  if (files[index].source !== "read_email_tool") {
    return formatError("Cannot remove non-email context files");
  }

  const removed = files.splice(index, 1)[0];
  if (session.context) {
    session.context.formattedContent = formatContextAsXml(files);
  }

  return formatResponse({
    success: true,
    action: "remove",
    removed: {
      path: removed.path,
      originalPath: removed.originalPath,
      subject: removed.emailMetadata?.subject,
    },
    contextFiles: files.length,
    message: `Email removed from context: ${removed.path}`,
  });
}

// ── Tool Definitions ─────────────────────────────────────────

const readEmailTool: Tool = {
  name: "read_email",
  description: `Read an email file (.eml format) and add its content to the session context.

Use this tool when you need to:
- Import email content for processing or analysis
- Extract information from emails (sender, recipient, subject, body)
- Include email context for composing replies
- Process email templates or examples

The email is parsed and its content becomes available to subsequent tasks in the session.
Supported formats: .eml, .msg, .email, .txt (RFC 5322 format)

The parsed email includes:
- Headers: From, To, Cc, Bcc, Subject, Date, Message-ID
- Body: Full email body text
- Metadata: Attachments indicator, importance level`,
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID (required)",
      },
      path: {
        type: "string",
        description: "Path to the email file (.eml, .msg, .email, .txt)",
      },
      alias: {
        type: "string",
        description: "Optional alias name for the email in context (defaults to filename)",
      },
      includeRawHeaders: {
        type: "boolean",
        default: false,
        description: "Include all raw headers in the context (for debugging/analysis)",
      },
    },
    required: ["sessionId", "path"],
  },
  execute: executeReadEmail,
};

const readEmailListTool: Tool = {
  name: "read_email_list",
  description: "List all emails in the session context that were added via read_email tool",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID (required)",
      },
    },
    required: ["sessionId"],
  },
  execute: executeListEmails,
};

const readEmailRemoveTool: Tool = {
  name: "read_email_remove",
  description: "Remove an email from the session context",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID (required)",
      },
      path: {
        type: "string",
        description: "Path of the email to remove (as shown in read_email_list)",
      },
    },
    required: ["sessionId", "path"],
  },
  execute: executeRemoveEmail,
};

export default [readEmailTool, readEmailListTool, readEmailRemoveTool] as Tool[];
