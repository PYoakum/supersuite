/**
 * Serialize an AST document node back to canonical markdown.
 * This produces stable output suitable for hashing/versioning.
 *
 * @param {object} ast - document AST root
 * @returns {string} canonical markdown
 */
export function serialize(ast) {
  if (!ast || ast.type !== 'document') return '';
  return serializeBlocks(ast.children).replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

function serializeBlocks(nodes) {
  return nodes.map((n) => serializeBlock(n)).join('\n');
}

function serializeBlock(node) {
  switch (node.type) {
    case 'heading':
      return `${'#'.repeat(node.level)} ${serializeInline(node.children)}\n`;

    case 'paragraph':
      return `${serializeInline(node.children)}\n`;

    case 'list':
      return serializeList(node);

    case 'codeBlock': {
      const lang = node.lang || '';
      return `\`\`\`${lang}\n${node.code}\n\`\`\`\n`;
    }

    case 'blockquote': {
      const inner = serializeBlocks(node.children);
      return inner.split('\n').map((l) => l ? `> ${l}` : '>').join('\n') + '\n';
    }

    case 'table':
      return serializeTable(node);

    case 'thematicBreak':
      return '---\n';

    case 'directive':
      return serializeDirective(node);

    case 'toc':
      return '[[toc]]\n';

    default:
      return '';
  }
}

function serializeList(node) {
  const lines = node.items.map((item, idx) => {
    const marker = node.ordered ? `${node.start + idx}.` : '-';
    const prefix = `${marker} `;

    // Task prefix
    let taskPrefix = '';
    if (item.task !== null) {
      taskPrefix = item.task ? '[x] ' : '[ ] ';
    }

    // Serialize item content
    const innerBlocks = item.children;
    if (innerBlocks.length === 1 && innerBlocks[0].type === 'paragraph') {
      // Simple single-line item
      return `${prefix}${taskPrefix}${serializeInline(innerBlocks[0].children)}`;
    }

    // Multi-block item
    const inner = serializeBlocks(innerBlocks);
    const indentedLines = inner.split('\n');
    const first = indentedLines[0];
    const rest = indentedLines.slice(1).map((l) => l ? `  ${l}` : '').join('\n');
    return `${prefix}${taskPrefix}${first}${rest ? '\n' + rest : ''}`;
  });

  return lines.join('\n') + '\n';
}

function serializeTable(node) {
  const headerCells = node.headers.map((h) => serializeInline(h));
  const sepCells = node.alignments.map((a) => {
    if (a === 'center') return ':---:';
    if (a === 'right') return '---:';
    return '---';
  });

  const rows = node.rows.map((row) =>
    '| ' + row.map((cell) => serializeInline(cell)).join(' | ') + ' |'
  );

  return [
    '| ' + headerCells.join(' | ') + ' |',
    '| ' + sepCells.join(' | ') + ' |',
    ...rows,
  ].join('\n') + '\n';
}

function serializeDirective(node) {
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  const attrStr = attrs ? ' ' + attrs : '';
  const inner = node.children.length > 0
    ? serializeBlocks(node.children)
    : node.raw || '';

  return `:::${node.name}${attrStr}\n${inner}\n:::\n`;
}

// ─── Inline serialization ──────────────────────────────────────────

function serializeInline(nodes) {
  return nodes.map(serializeInlineNode).join('');
}

function serializeInlineNode(node) {
  switch (node.type) {
    case 'text':
      return node.value;
    case 'strong':
      return `**${serializeInline(node.children)}**`;
    case 'emphasis':
      return `*${serializeInline(node.children)}*`;
    case 'inlineCode':
      return `\`${node.value}\``;
    case 'link': {
      const title = node.title ? ` "${node.title}"` : '';
      return `[${serializeInline(node.children)}](${node.url}${title})`;
    }
    case 'image': {
      const title = node.title ? ` "${node.title}"` : '';
      return `![${node.alt}](${node.url}${title})`;
    }
    case 'wikiLink':
      if (node.display && node.display !== node.target) {
        return `[[${node.target}|${node.display}]]`;
      }
      return `[[${node.target}]]`;
    case 'softBreak':
      return '\n';
    case 'hardBreak':
      return '  \n';
    default:
      return '';
  }
}
