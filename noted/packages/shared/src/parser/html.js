/**
 * Render an AST document node to sanitized HTML.
 *
 * @param {object} ast - document AST root
 * @param {object} [opts]
 * @param {object[]} [opts.headings] - if provided, populated with {id, level, text} for TOC
 * @param {function} [opts.resolveWikiLink] - (target) => url string
 * @returns {string} HTML
 */
export function renderHtml(ast, opts = {}) {
  const headings = opts.headings || [];
  const resolveWikiLink = opts.resolveWikiLink || ((t) => `/d/${encodeURIComponent(slugifySimple(t))}`);

  return renderChildren(ast.children, { headings, resolveWikiLink });
}

function renderChildren(nodes, ctx) {
  return nodes.map((n) => renderNode(n, ctx)).join('');
}

function renderNode(node, ctx) {
  switch (node.type) {
    case 'heading':
      return renderHeading(node, ctx);
    case 'paragraph':
      return `<p>${renderInline(node.children, ctx)}</p>\n`;
    case 'list':
      return renderList(node, ctx);
    case 'codeBlock':
      return renderCodeBlock(node);
    case 'blockquote':
      return `<blockquote>\n${renderChildren(node.children, ctx)}</blockquote>\n`;
    case 'table':
      return renderTable(node, ctx);
    case 'thematicBreak':
      return '<hr>\n';
    case 'directive':
      return renderDirective(node, ctx);
    case 'toc':
      return renderToc(ctx);
    case 'document':
      return renderChildren(node.children, ctx);
    default:
      return '';
  }
}

function renderHeading(node, ctx) {
  const level = node.level;
  const id = esc(node.id);
  const text = renderInline(node.children, ctx);
  const plainText = getPlainText(node.children);

  ctx.headings.push({ id: node.id, level, text: plainText });

  return `<h${level} id="${id}">${text}</h${level}>\n`;
}

function renderList(node, ctx) {
  const tag = node.ordered ? 'ol' : 'ul';
  const startAttr = node.ordered && node.start !== 1 ? ` start="${node.start}"` : '';
  const isTasks = node.items.some((it) => it.task !== null);

  const items = node.items.map((item) => {
    if (item.task !== null) {
      const checked = item.task ? ' checked' : '';
      const inner = renderChildren(item.children, ctx);
      // Strip wrapping <p> for single-line task items
      const content = inner.replace(/^<p>(.*)<\/p>\n?$/, '$1');
      return `<li class="task-item"><input type="checkbox"${checked} disabled> ${content}</li>\n`;
    }
    return `<li>${renderChildren(item.children, ctx)}</li>\n`;
  }).join('');

  const cls = isTasks ? ` class="task-list"` : '';
  return `<${tag}${startAttr}${cls}>\n${items}</${tag}>\n`;
}

function renderCodeBlock(node) {
  const langClass = node.lang ? ` class="language-${esc(node.lang)}"` : '';
  return `<pre><code${langClass}>${esc(node.code)}</code></pre>\n`;
}

function renderTable(node, ctx) {
  let html = '<table>\n<thead>\n<tr>\n';
  node.headers.forEach((h, i) => {
    const align = node.alignments[i];
    const style = align && align !== 'left' ? ` style="text-align:${align}"` : '';
    html += `<th${style}>${renderInline(h, ctx)}</th>\n`;
  });
  html += '</tr>\n</thead>\n';

  if (node.rows.length > 0) {
    html += '<tbody>\n';
    node.rows.forEach((row) => {
      html += '<tr>\n';
      row.forEach((cell, i) => {
        const align = node.alignments[i];
        const style = align && align !== 'left' ? ` style="text-align:${align}"` : '';
        html += `<td${style}>${renderInline(cell, ctx)}</td>\n`;
      });
      html += '</tr>\n';
    });
    html += '</tbody>\n';
  }

  html += '</table>\n';
  return html;
}

function renderDirective(node, ctx) {
  switch (node.name) {
    case 'callout': {
      const type = esc(node.attrs.type || 'info');
      const title = node.attrs.title ? `<div class="callout-title">${esc(node.attrs.title)}</div>` : '';
      const inner = renderChildren(node.children, ctx);
      return `<div class="callout callout-${type}">\n${title}\n${inner}</div>\n`;
    }
    case 'embed': {
      const url = node.attrs.url || '';
      if (isImageUrl(url)) {
        return `<figure class="embed"><img src="${escUrl(url)}" alt="Embedded image"><figcaption>${esc(url)}</figcaption></figure>\n`;
      }
      if (isVideoUrl(url)) {
        return `<figure class="embed"><video src="${escUrl(url)}" controls></video></figure>\n`;
      }
      return `<div class="embed"><a href="${escUrl(url)}">${esc(url)}</a></div>\n`;
    }
    default: {
      // Unknown directive — render as a styled block with raw content
      const inner = renderChildren(node.children, ctx);
      return `<div class="directive directive-${esc(node.name)}">\n${inner}</div>\n`;
    }
  }
}

function renderToc(ctx) {
  // TOC is rendered as a placeholder; actual content filled post-render
  return '<!--TOC_PLACEHOLDER-->';
}

/**
 * Generate TOC HTML from collected headings.
 * @param {object[]} headings - [{id, level, text}]
 * @returns {string} HTML
 */
export function generateTocHtml(headings) {
  if (headings.length === 0) return '';

  let html = '<nav class="toc"><ul>\n';
  const minLevel = Math.min(...headings.map((h) => h.level));

  for (const h of headings) {
    const indent = '  '.repeat(h.level - minLevel);
    html += `${indent}<li class="toc-h${h.level}"><a href="#${esc(h.id)}">${esc(h.text)}</a></li>\n`;
  }

  html += '</ul></nav>\n';
  return html;
}

/**
 * Full render pipeline: parse headings, render HTML, insert TOC.
 */
export function renderWithToc(ast, opts = {}) {
  const headings = [];
  let html = renderHtml(ast, { ...opts, headings });

  if (html.includes('<!--TOC_PLACEHOLDER-->')) {
    const tocHtml = generateTocHtml(headings);
    html = html.replace('<!--TOC_PLACEHOLDER-->', tocHtml);
  }

  return { html, headings };
}

// ─── Inline rendering ──────────────────────────────────────────────

function renderInline(nodes, ctx) {
  return nodes.map((n) => renderInlineNode(n, ctx)).join('');
}

function renderInlineNode(node, ctx) {
  switch (node.type) {
    case 'text':
      return esc(node.value);
    case 'strong':
      return `<strong>${renderInline(node.children, ctx)}</strong>`;
    case 'emphasis':
      return `<em>${renderInline(node.children, ctx)}</em>`;
    case 'inlineCode':
      return `<code>${esc(node.value)}</code>`;
    case 'link':
      return `<a href="${escUrl(node.url)}"${node.title ? ` title="${esc(node.title)}"` : ''}>${renderInline(node.children, ctx)}</a>`;
    case 'image':
      return `<img src="${escUrl(node.url)}" alt="${esc(node.alt)}"${node.title ? ` title="${esc(node.title)}"` : ''}>`;
    case 'wikiLink': {
      const url = ctx.resolveWikiLink(node.target);
      return `<a href="${escUrl(url)}" class="wiki-link">${esc(node.display)}</a>`;
    }
    case 'softBreak':
      return '\n';
    case 'hardBreak':
      return '<br>\n';
    default:
      return '';
  }
}

// ─── Sanitization helpers ──────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escUrl(url) {
  const s = String(url).trim();
  // Block javascript: and data: URLs (XSS vectors)
  if (/^(javascript|data|vbscript):/i.test(s)) return '';
  return esc(s);
}

function getPlainText(nodes) {
  return nodes.map((n) => {
    if (n.type === 'text') return n.value;
    if (n.children) return getPlainText(n.children);
    if (n.value) return n.value;
    return '';
  }).join('');
}

function slugifySimple(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function isImageUrl(url) {
  return /\.(png|jpg|jpeg|gif|webp|svg|avif)(\?.*)?$/i.test(url);
}

function isVideoUrl(url) {
  return /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url);
}
