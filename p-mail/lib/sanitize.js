import { simpleParser } from "mailparser";

export async function parseMessage(source, { external = false, folder = "", uid = "" } = {}) {
  const parsed = await simpleParser(source);

  let htmlContent = parsed.html || "";
  let textContent = parsed.text || "";

  if (htmlContent) {
    htmlContent = sanitizeHtml(htmlContent, { external, folder, uid });
  }

  const attachments = (parsed.attachments || []).map((att) => ({
    filename: att.filename || "unnamed",
    contentType: att.contentType || "application/octet-stream",
    size: att.size,
    partId: att.contentId ? att.contentId.replace(/[<>]/g, "") : null,
    cid: att.contentId || null,
    contentDisposition: att.contentDisposition || "attachment",
  }));

  return {
    from: parsed.from?.value || [],
    to: parsed.to?.value || [],
    cc: parsed.cc?.value || [],
    bcc: parsed.bcc?.value || [],
    subject: parsed.subject || "(no subject)",
    date: parsed.date || null,
    messageId: parsed.messageId || null,
    inReplyTo: parsed.inReplyTo || null,
    references: parsed.references || [],
    html: htmlContent,
    text: textContent,
    attachments,
  };
}

const DANGEROUS_TAGS = /(<\s*\/?\s*(script|iframe|object|embed|form|link|meta|base|applet)(\s[^>]*)?>)/gi;
const EVENT_HANDLERS = /\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi;
const JAVASCRIPT_URIS = /(href|src|action)\s*=\s*["']?\s*javascript\s*:/gi;
const STYLE_EXPRESSIONS = /expression\s*\(/gi;
const STYLE_JAVASCRIPT = /javascript\s*:/gi;

export function sanitizeHtml(html, { external = false, folder = "", uid = "" } = {}) {
  // Remove dangerous tags
  let safe = html.replace(DANGEROUS_TAGS, "");

  // Remove event handlers
  safe = safe.replace(EVENT_HANDLERS, "");

  // Remove javascript: URIs
  safe = safe.replace(JAVASCRIPT_URIS, '$1=""');

  // Remove CSS expressions
  safe = safe.replace(STYLE_EXPRESSIONS, "/* blocked */");
  safe = safe.replace(STYLE_JAVASCRIPT, "/* blocked */");

  // Handle CID references — rewrite to proxy URL
  safe = safe.replace(/src\s*=\s*["']cid:([^"']+)["']/gi, (match, cid) => {
    return `src="/api/attachment/${encodeURIComponent(folder)}/${uid}/${encodeURIComponent(cid)}"`;
  });

  // Handle external images
  if (!external) {
    safe = safe.replace(
      /(<img\s[^>]*?)src\s*=\s*["'](https?:\/\/[^"']+)["']/gi,
      (match, prefix, url) => {
        return `${prefix}data-blocked-src="${escapeAttr(url)}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect fill='%23333' width='20' height='20'/%3E%3Ctext x='4' y='14' fill='%23999' font-size='10'%3Eimg%3C/text%3E%3C/svg%3E"`;
      }
    );
  }

  return safe;
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function getBodyStructureParts(structure, parts = [], path = "") {
  if (!structure) return parts;

  const currentPath = path || structure.part || "";

  if (structure.disposition === "attachment" || (structure.type && !structure.type.startsWith("multipart/"))) {
    if (structure.disposition === "attachment" || structure.contentId) {
      parts.push({
        partId: currentPath,
        type: structure.type,
        encoding: structure.encoding,
        size: structure.size,
        filename: structure.dispositionParameters?.filename || structure.parameters?.name || null,
        contentId: structure.contentId || null,
        disposition: structure.disposition || null,
      });
    }
  }

  if (structure.childNodes) {
    for (let i = 0; i < structure.childNodes.length; i++) {
      const childPath = currentPath ? `${currentPath}.${i + 1}` : `${i + 1}`;
      getBodyStructureParts(structure.childNodes[i], parts, childPath);
    }
  }

  return parts;
}
