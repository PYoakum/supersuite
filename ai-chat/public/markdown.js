/**
 * Lightweight markdown → HTML renderer for chat messages.
 * Escapes HTML first (XSS-safe), then applies markdown transforms.
 */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ESC[c]);

export function renderMarkdown(raw) {
  // Extract fenced code blocks before escaping so backticks aren't mangled
  const codeBlocks = [];
  let src = raw.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const i = codeBlocks.length;
    codeBlocks.push(
      `<pre class="md-pre"><code class="md-code-block${lang ? ` lang-${escapeHtml(lang)}` : ""}">${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`
    );
    return `\x00CB${i}\x00`;
  });

  // Extract inline code before escaping
  const inlineCode = [];
  src = src.replace(/`([^`\n]+)`/g, (_, code) => {
    const i = inlineCode.length;
    inlineCode.push(`<code class="md-code">${escapeHtml(code)}</code>`);
    return `\x00IC${i}\x00`;
  });

  // Now escape remaining HTML
  src = escapeHtml(src);

  // Split into blocks on double newline
  const blocks = src.split(/\n{2,}/);
  const out = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Code block placeholder
    const cbMatch = trimmed.match(/^\x00CB(\d+)\x00$/);
    if (cbMatch) {
      out.push(codeBlocks[+cbMatch[1]]);
      continue;
    }

    // Heading
    const hMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      out.push(`<h${level + 2} class="md-heading">${inlineFormat(hMatch[2], inlineCode)}</h${level + 2}>`);
      continue;
    }

    // Blockquote
    if (/^&gt;\s/.test(trimmed)) {
      const lines = trimmed.split("\n").map((l) => l.replace(/^&gt;\s?/, ""));
      out.push(`<blockquote class="md-blockquote">${inlineFormat(lines.join("<br>"), inlineCode)}</blockquote>`);
      continue;
    }

    // Unordered list (- or * at start of lines)
    if (/^[-*]\s/.test(trimmed)) {
      const items = trimmed.split("\n").filter((l) => /^[-*]\s/.test(l));
      if (items.length > 0) {
        out.push("<ul class=\"md-list\">" + items.map((l) => `<li>${inlineFormat(l.replace(/^[-*]\s+/, ""), inlineCode)}</li>`).join("") + "</ul>");
        continue;
      }
    }

    // Ordered list
    if (/^\d+\.\s/.test(trimmed)) {
      const items = trimmed.split("\n").filter((l) => /^\d+\.\s/.test(l));
      if (items.length > 0) {
        out.push("<ol class=\"md-list\">" + items.map((l) => `<li>${inlineFormat(l.replace(/^\d+\.\s+/, ""), inlineCode)}</li>`).join("") + "</ol>");
        continue;
      }
    }

    // Paragraph (may contain code block placeholders inline with text)
    const html = trimmed.split("\n").map((l) => inlineFormat(l, inlineCode)).join("<br>");
    out.push(`<p class="md-p">${html}</p>`);
  }

  // Restore any code block placeholders that ended up inside paragraphs
  let result = out.join("");
  result = result.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[+i]);
  return result;
}

/** Apply inline formatting: bold, italic, links, inline code placeholders */
function inlineFormat(text, inlineCode) {
  let s = text;
  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__(.+?)__/g, "<strong>$1</strong>");
  // Italic
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
  s = s.replace(/_(.+?)_/g, "<em>$1</em>");
  // Links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noopener">$1</a>');
  // Auto-link sandbox file paths (e.g. sandbox/lyric/file.txt or /path/to/sandbox/agent/file.ext)
  s = s.replace(/(?:^|\s)((?:sandbox\/|\/[^\s]*?\/sandbox\/)[a-zA-Z0-9_\-./]+\.\w+)/g,
    (match, path) => {
      const sandboxPath = path.includes("/sandbox/")
        ? "/sandbox/" + path.split("/sandbox/").pop()
        : "/" + path;
      return match.replace(path, `<a class="md-link sandbox-link" href="${sandboxPath}" target="_blank" rel="noopener">📎 ${path.split("/").pop()}</a>`);
    }
  );
  // Restore inline code placeholders
  s = s.replace(/\x00IC(\d+)\x00/g, (_, i) => inlineCode[+i]);
  return s;
}

/** Quick check: does this text contain any markdown syntax worth rendering? */
export function hasMarkdown(text) {
  return /```|\*\*|__|`[^`]+`|^#{1,3}\s|^[-*]\s|^\d+\.\s|^>|sandbox\/\S+\.\w+/m.test(text);
}
