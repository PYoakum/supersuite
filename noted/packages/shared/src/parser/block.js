import * as N from './nodes.js';
import { parseInline } from './inline.js';

/**
 * Parse markdown text into a document AST.
 * @param {string} markdown
 * @returns {object} document AST node
 */
export function parse(markdown) {
  const text = (markdown || '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const children = parseBlocks(lines, 0, lines.length);
  return N.doc(children);
}

/**
 * Parse a range of lines into block nodes.
 */
function parseBlocks(lines, start, end) {
  const blocks = [];
  let i = start;

  while (i < end) {
    const line = lines[i];

    // ── Blank line ──
    if (line.trim() === '') {
      i++;
      continue;
    }

    // ── Fenced code block ──
    const fenceMatch = line.match(/^(`{3,}|~{3,})\s*(\S*)\s*(.*)$/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const lang = fenceMatch[2] || '';
      const meta = fenceMatch[3] || '';
      const fenceChar = fence[0];
      const fenceLen = fence.length;
      let codeLines = [];
      i++;
      while (i < end) {
        const cl = lines[i];
        // Closing fence must use same char and >= same length
        if (new RegExp(`^${fenceChar}{${fenceLen},}\\s*$`).test(cl)) {
          i++;
          break;
        }
        codeLines.push(cl);
        i++;
      }
      blocks.push(N.codeBlock(codeLines.join('\n'), lang, meta));
      continue;
    }

    // ── Directive block :::name attrs ──
    const directiveMatch = line.match(/^:::(\w+)\s*(.*)?$/);
    if (directiveMatch) {
      const name = directiveMatch[1];
      const attrStr = directiveMatch[2] || '';
      const attrs = parseDirectiveAttrs(attrStr);
      let contentLines = [];
      i++;
      while (i < end && lines[i].trim() !== ':::') {
        contentLines.push(lines[i]);
        i++;
      }
      if (i < end) i++; // skip closing :::

      // Parse content inside directive as blocks
      const innerBlocks = parseBlocks(contentLines, 0, contentLines.length);
      blocks.push(N.directive(name, attrs, innerBlocks, contentLines.join('\n')));
      continue;
    }

    // ── TOC directive [[toc]] ──
    if (/^\[\[toc\]\]\s*$/i.test(line.trim())) {
      blocks.push(N.toc());
      i++;
      continue;
    }

    // ── Thematic break ──
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(N.thematicBreak());
      i++;
      continue;
    }

    // ── ATX heading ──
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const id = slugifyHeading(content);
      blocks.push(N.heading(level, parseInline(content), id));
      i++;
      continue;
    }

    // ── Blockquote ──
    if (line.startsWith('>')) {
      const bqLines = [];
      while (i < end && (lines[i].startsWith('>') || (lines[i].trim() !== '' && bqLines.length > 0 && !isBlockStart(lines[i])))) {
        let l = lines[i];
        if (l.startsWith('> ')) l = l.slice(2);
        else if (l.startsWith('>')) l = l.slice(1);
        bqLines.push(l);
        i++;
      }
      const innerBlocks = parseBlocks(bqLines, 0, bqLines.length);
      blocks.push(N.blockquote(innerBlocks));
      continue;
    }

    // ── Table ──
    if (isTableStart(lines, i)) {
      const tableNode = parseTable(lines, i);
      if (tableNode) {
        blocks.push(tableNode.node);
        i = tableNode.end;
        continue;
      }
    }

    // ── List ──
    if (isListItem(line)) {
      const listResult = parseList(lines, i, end);
      blocks.push(listResult.node);
      i = listResult.end;
      continue;
    }

    // ── Paragraph (default) ──
    const paraLines = [];
    while (i < end && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push(N.paragraph(parseInline(paraLines.join('\n'))));
    }
  }

  return blocks;
}

// ─── List parsing ──────────────────────────────────────────────────

const LIST_BULLET_RE = /^(\s*)([-*+])\s+(.*)/;
const LIST_ORDERED_RE = /^(\s*)(\d+)\.\s+(.*)/;
const LIST_TASK_RE = /^\[([ xX])\]\s+(.*)/;

function isListItem(line) {
  return LIST_BULLET_RE.test(line) || LIST_ORDERED_RE.test(line);
}

function parseList(lines, start, end) {
  const firstLine = lines[start];
  const orderedMatch = LIST_ORDERED_RE.exec(firstLine);
  const ordered = !!orderedMatch;
  const listStart = orderedMatch ? parseInt(orderedMatch[2]) : 1;
  const baseIndent = getIndent(firstLine);

  const items = [];
  let i = start;

  while (i < end) {
    const line = lines[i];
    if (line.trim() === '') {
      // Blank line within list — check if next line continues
      if (i + 1 < end && getIndent(lines[i + 1]) > baseIndent) {
        i++;
        continue;
      }
      if (i + 1 < end && isListItem(lines[i + 1]) && getIndent(lines[i + 1]) === baseIndent) {
        i++;
        continue;
      }
      break;
    }

    const bulletMatch = LIST_BULLET_RE.exec(line);
    const ordMatch = LIST_ORDERED_RE.exec(line);
    const match = ordered ? ordMatch : (bulletMatch || null);

    if (match && getIndent(line) === baseIndent) {
      // New item at this level
      let content = match[3];

      // Check for task item
      let task = null;
      const taskMatch = LIST_TASK_RE.exec(content);
      if (taskMatch) {
        task = taskMatch[1] !== ' ';
        content = taskMatch[2];
      }

      i++;

      // Gather continuation lines and sub-items
      const subLines = [];
      while (i < end) {
        const subLine = lines[i];
        if (subLine.trim() === '') {
          // Check if list continues
          if (i + 1 < end && (getIndent(lines[i + 1]) > baseIndent || (isListItem(lines[i + 1]) && getIndent(lines[i + 1]) === baseIndent))) {
            subLines.push('');
            i++;
            continue;
          }
          break;
        }
        if (isListItem(subLine) && getIndent(subLine) === baseIndent) break;
        if (getIndent(subLine) > baseIndent) {
          // Dedent continuation lines
          subLines.push(subLine.slice(baseIndent + 2));
        } else if (!isListItem(subLine)) {
          // Continuation paragraph
          subLines.push(subLine);
        } else {
          break;
        }
        i++;
      }

      // Parse item content
      let children;
      if (subLines.length > 0) {
        // Combine first line with sub-content
        const allContent = [content, ...subLines].join('\n');
        const contentLines = allContent.split('\n');
        children = parseBlocks(contentLines, 0, contentLines.length);
      } else {
        children = [N.paragraph(parseInline(content))];
      }

      items.push(N.listItem(children, task));
    } else if (getIndent(line) > baseIndent) {
      // Continuation of previous item — skip (handled above)
      i++;
    } else {
      break;
    }
  }

  return { node: N.list(ordered, items, listStart), end: i };
}

// ─── Table parsing ─────────────────────────────────────────────────

function isTableStart(lines, i) {
  if (i + 1 >= lines.length) return false;
  const line = lines[i];
  const sep = lines[i + 1];
  if (!line.includes('|')) return false;
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(sep);
}

function parseTable(lines, start) {
  const headerLine = lines[start];
  const sepLine = lines[start + 1];

  const headers = parseCells(headerLine);
  const alignments = parseSeparator(sepLine);

  const rows = [];
  let i = start + 2;
  while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
    rows.push(parseCells(lines[i]));
    i++;
  }

  // Parse inline content in headers and cells
  const headerNodes = headers.map((h) => parseInline(h.trim()));
  const rowNodes = rows.map((row) => row.map((c) => parseInline(c.trim())));

  return {
    node: N.table(headerNodes, alignments, rowNodes),
    end: i,
  };
}

function parseCells(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|');
}

function parseSeparator(line) {
  const cells = parseCells(line);
  return cells.map((c) => {
    const t = c.trim();
    if (t.startsWith(':') && t.endsWith(':')) return 'center';
    if (t.endsWith(':')) return 'right';
    if (t.startsWith(':')) return 'left';
    return 'left';
  });
}

// ─── Heading ID generation ─────────────────────────────────────────

const headingIds = new Map();

export function resetHeadingIds() {
  headingIds.clear();
}

function slugifyHeading(text) {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!headingIds.has(base)) {
    headingIds.set(base, 0);
    return base;
  }

  const count = headingIds.get(base) + 1;
  headingIds.set(base, count);
  return `${base}-${count}`;
}

// ─── Helpers ───────────────────────────────────────────────────────

function getIndent(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

function isBlockStart(line) {
  if (/^#{1,6}\s/.test(line)) return true;
  if (/^(`{3,}|~{3,})/.test(line)) return true;
  if (/^:::/.test(line)) return true;
  if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) return true;
  if (line.startsWith('>')) return true;
  if (isListItem(line)) return true;
  if (/^\[\[toc\]\]/i.test(line.trim())) return true;
  return false;
}

/** Parse directive attributes: key="value" pairs */
function parseDirectiveAttrs(str) {
  const attrs = {};
  const re = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}
