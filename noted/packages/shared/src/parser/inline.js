import * as N from './nodes.js';

/**
 * Parse inline markdown content into an array of inline AST nodes.
 * Handles: **bold**, *italic*, `code`, [links](url), ![images](url),
 *          [[wiki-links]], [[target|display]]
 *
 * @param {string} input
 * @returns {Array} inline nodes
 */
export function parseInline(input) {
  if (!input) return [N.text('')];

  const nodes = [];
  let pos = 0;
  let textBuf = '';

  function flush() {
    if (textBuf) {
      nodes.push(N.text(textBuf));
      textBuf = '';
    }
  }

  while (pos < input.length) {
    const ch = input[pos];
    const next = input[pos + 1];

    // ── Escaped character ──
    if (ch === '\\' && pos + 1 < input.length && /[\\`*_\[\]()!#~|]/.test(next)) {
      textBuf += next;
      pos += 2;
      continue;
    }

    // ── Inline code ──
    if (ch === '`') {
      const end = input.indexOf('`', pos + 1);
      if (end !== -1) {
        flush();
        nodes.push(N.inlineCode(input.slice(pos + 1, end)));
        pos = end + 1;
        continue;
      }
    }

    // ── Wiki-link [[target]] or [[target|display]] ──
    if (ch === '[' && next === '[') {
      const end = input.indexOf(']]', pos + 2);
      if (end !== -1) {
        flush();
        const inner = input.slice(pos + 2, end);
        const pipeIdx = inner.indexOf('|');
        if (pipeIdx !== -1) {
          nodes.push(N.wikiLink(inner.slice(0, pipeIdx).trim(), inner.slice(pipeIdx + 1).trim()));
        } else {
          nodes.push(N.wikiLink(inner.trim()));
        }
        pos = end + 2;
        continue;
      }
    }

    // ── Image ![alt](url "title") ──
    if (ch === '!' && next === '[') {
      const altEnd = input.indexOf(']', pos + 2);
      if (altEnd !== -1 && input[altEnd + 1] === '(') {
        const urlEnd = input.indexOf(')', altEnd + 2);
        if (urlEnd !== -1) {
          flush();
          const alt = input.slice(pos + 2, altEnd);
          const urlPart = input.slice(altEnd + 2, urlEnd);
          const { url, title } = parseUrlTitle(urlPart);
          nodes.push(N.image(url, alt, title));
          pos = urlEnd + 1;
          continue;
        }
      }
    }

    // ── Link [text](url "title") ──
    if (ch === '[') {
      const textEnd = findClosingBracket(input, pos);
      if (textEnd !== -1 && input[textEnd + 1] === '(') {
        const urlEnd = input.indexOf(')', textEnd + 2);
        if (urlEnd !== -1) {
          flush();
          const linkText = input.slice(pos + 1, textEnd);
          const urlPart = input.slice(textEnd + 2, urlEnd);
          const { url, title } = parseUrlTitle(urlPart);
          nodes.push(N.link(url, parseInline(linkText), title));
          pos = urlEnd + 1;
          continue;
        }
      }
    }

    // ── Bold **text** or __text__ ──
    if ((ch === '*' && next === '*') || (ch === '_' && next === '_')) {
      const marker = ch + ch;
      const end = input.indexOf(marker, pos + 2);
      if (end !== -1) {
        flush();
        const inner = input.slice(pos + 2, end);
        nodes.push(N.strong(parseInline(inner)));
        pos = end + 2;
        continue;
      }
    }

    // ── Emphasis *text* or _text_ ──
    if (ch === '*' || ch === '_') {
      // Avoid matching inside words for underscore
      if (ch === '_' && pos > 0 && /\w/.test(input[pos - 1])) {
        textBuf += ch;
        pos++;
        continue;
      }
      const end = input.indexOf(ch, pos + 1);
      if (end !== -1 && end > pos + 1) {
        flush();
        const inner = input.slice(pos + 1, end);
        nodes.push(N.emphasis(parseInline(inner)));
        pos = end + 1;
        continue;
      }
    }

    // ── Hard break (two trailing spaces + implicit from parser) ──
    // Handled at block level

    // ── Plain text ──
    textBuf += ch;
    pos++;
  }

  flush();
  return nodes;
}

/**
 * Parse URL and optional title from a link/image URL portion.
 * e.g. 'https://example.com "My Title"'
 */
function parseUrlTitle(raw) {
  const trimmed = raw.trim();
  const titleMatch = trimmed.match(/^(.+?)\s+"([^"]*)"$/);
  if (titleMatch) {
    return { url: titleMatch[1].trim(), title: titleMatch[2] };
  }
  const titleMatch2 = trimmed.match(/^(.+?)\s+'([^']*)'$/);
  if (titleMatch2) {
    return { url: titleMatch2[1].trim(), title: titleMatch2[2] };
  }
  return { url: trimmed, title: '' };
}

/**
 * Find matching closing bracket, handling nesting.
 */
function findClosingBracket(str, openPos) {
  let depth = 0;
  for (let i = openPos; i < str.length; i++) {
    if (str[i] === '[') depth++;
    else if (str[i] === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
