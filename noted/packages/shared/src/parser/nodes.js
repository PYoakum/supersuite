/**
 * AST Node Types for Noted's markdown parser.
 *
 * Block nodes: document, heading, paragraph, list, listItem, codeBlock,
 *              blockquote, table, thematicBreak, directive, html
 * Inline nodes: text, strong, emphasis, code, link, image, softBreak, hardBreak
 */

/** Create a document root node. */
export function doc(children = []) {
  return { type: 'document', children };
}

/** Heading (level 1-6). */
export function heading(level, children = [], id = '') {
  return { type: 'heading', level, children, id };
}

/** Paragraph. */
export function paragraph(children = []) {
  return { type: 'paragraph', children };
}

/** List (ordered or unordered). */
export function list(ordered, items = [], start = 1) {
  return { type: 'list', ordered, items, start };
}

/** List item. Can be a task item with checked state. */
export function listItem(children = [], task = null) {
  // task: null (not a task), true (checked), false (unchecked)
  return { type: 'listItem', children, task };
}

/** Fenced code block. */
export function codeBlock(code = '', lang = '', meta = '') {
  return { type: 'codeBlock', code, lang, meta };
}

/** Blockquote. */
export function blockquote(children = []) {
  return { type: 'blockquote', children };
}

/** Table. */
export function table(headers = [], alignments = [], rows = []) {
  return { type: 'table', headers, alignments, rows };
}

/** Thematic break (horizontal rule). */
export function thematicBreak() {
  return { type: 'thematicBreak' };
}

/** Directive block (:::callout, :::embed, etc.). */
export function directive(name, attrs = {}, children = [], raw = '') {
  return { type: 'directive', name, attrs, children, raw };
}

/** TOC placeholder. */
export function toc() {
  return { type: 'toc' };
}

// ─── Inline nodes ──────────────────────────────────────────────────

export function text(value) {
  return { type: 'text', value };
}

export function strong(children = []) {
  return { type: 'strong', children };
}

export function emphasis(children = []) {
  return { type: 'emphasis', children };
}

export function inlineCode(value) {
  return { type: 'inlineCode', value };
}

export function link(url, children = [], title = '') {
  return { type: 'link', url, title, children };
}

export function image(url, alt = '', title = '') {
  return { type: 'image', url, alt, title };
}

export function wikiLink(target, display = '') {
  return { type: 'wikiLink', target, display: display || target };
}

export function softBreak() {
  return { type: 'softBreak' };
}

export function hardBreak() {
  return { type: 'hardBreak' };
}
