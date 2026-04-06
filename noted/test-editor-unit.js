/**
 * Tests for editor markdown ↔ model conversion.
 * Since the editor is client-side with DOM dependencies, we extract
 * the pure conversion functions and test them directly.
 */

import { readFileSync } from 'node:fs';

// Parse the editor-core.js file and extract the conversion functions
// by evaluating them in an isolated scope with minimal mocks
const src = readFileSync('./apps/web/public/editor-core.js', 'utf-8');

// Minimal globals needed for the module to load
globalThis.window = undefined;
globalThis.document = {
  createElement: (tag) => ({
    textContent: '',
    get innerHTML() { return this.textContent.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  })
};
globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
globalThis.NodeFilter = { SHOW_TEXT: 4 };

// Evaluate to get exports
const module = { exports: {} };
const fn = new Function('module', 'exports', 'window', 'document', 'Node', 'NodeFilter',
  src + '\n; module.exports = { markdownToModel, modelToMarkdown };');
fn(module, module.exports, undefined, globalThis.document, globalThis.Node, globalThis.NodeFilter);

const { markdownToModel, modelToMarkdown } = module.exports;

let passed = 0;
let failed = 0;

function assert(ok, msg) {
  if (!ok) { console.error(`  FAIL: ${msg}`); failed++; }
  else { console.log(`  PASS: ${msg}`); passed++; }
}

// ─── Markdown → Model ──────────────────────────────

console.log('1. Parse heading');
{
  const blocks = markdownToModel('# Hello World\n');
  assert(blocks.length === 1, `1 block (got ${blocks.length})`);
  assert(blocks[0].type === 'heading', `type = heading (got ${blocks[0].type})`);
  assert(blocks[0].attrs.level === 1, 'level 1');
  assert(blocks[0].content === 'Hello World', 'content');
}
console.log('');

console.log('2. Parse multiple headings');
{
  const blocks = markdownToModel('# H1\n\n## H2\n\n### H3\n');
  assert(blocks.length === 3, `3 blocks (got ${blocks.length})`);
  assert(blocks[0].attrs.level === 1, 'h1');
  assert(blocks[1].attrs.level === 2, 'h2');
  assert(blocks[2].attrs.level === 3, 'h3');
}
console.log('');

console.log('3. Parse paragraphs');
{
  const blocks = markdownToModel('First paragraph.\n\nSecond paragraph.\n');
  assert(blocks.length === 2, `2 blocks (got ${blocks.length})`);
  assert(blocks[0].type === 'paragraph', 'paragraph');
  assert(blocks[0].content === 'First paragraph.', 'content');
}
console.log('');

console.log('4. Parse bullet list');
{
  const blocks = markdownToModel('- Item A\n- Item B\n- Item C\n');
  assert(blocks.length === 3, `3 blocks (got ${blocks.length})`);
  assert(blocks[0].type === 'bulletList', 'bulletList');
  assert(blocks[0].content === 'Item A', 'content A');
  assert(blocks[2].content === 'Item C', 'content C');
}
console.log('');

console.log('5. Parse ordered list');
{
  const blocks = markdownToModel('1. First\n2. Second\n3. Third\n');
  assert(blocks.length === 3, `3 blocks (got ${blocks.length})`);
  assert(blocks[0].type === 'orderedList', 'orderedList');
  assert(blocks[0].content === 'First', 'content');
}
console.log('');

console.log('6. Parse task list');
{
  const blocks = markdownToModel('- [x] Done\n- [ ] Todo\n');
  assert(blocks.length === 2, `2 blocks (got ${blocks.length})`);
  assert(blocks[0].type === 'taskList', 'taskList');
  assert(blocks[0].attrs.checked === true, 'checked');
  assert(blocks[1].attrs.checked === false, 'unchecked');
  assert(blocks[0].content === 'Done', 'content');
}
console.log('');

console.log('7. Parse code block');
{
  const blocks = markdownToModel('```js\nconst x = 1;\nconsole.log(x);\n```\n');
  assert(blocks.length === 1, `1 block (got ${blocks.length})`);
  assert(blocks[0].type === 'codeBlock', 'codeBlock');
  assert(blocks[0].attrs.lang === 'js', 'lang = js');
  assert(blocks[0].content.includes('const x = 1;'), 'code content');
}
console.log('');

console.log('8. Parse blockquote');
{
  const blocks = markdownToModel('> Quote text\n');
  assert(blocks.length === 1, `1 block (got ${blocks.length})`);
  assert(blocks[0].type === 'blockquote', 'blockquote');
  assert(blocks[0].content === 'Quote text', 'content');
}
console.log('');

console.log('9. Parse divider');
{
  const blocks = markdownToModel('---\n');
  assert(blocks.length === 1, `1 block (got ${blocks.length})`);
  assert(blocks[0].type === 'divider', 'divider');
}
console.log('');

console.log('10. Parse mixed content');
{
  const md = '# Title\n\nSome text.\n\n- Item 1\n- Item 2\n\n```python\nprint("hi")\n```\n\n---\n\n> A quote\n';
  const blocks = markdownToModel(md);
  const types = blocks.map(b => b.type);
  assert(types.includes('heading'), 'has heading');
  assert(types.includes('paragraph'), 'has paragraph');
  assert(types.includes('bulletList'), 'has bulletList');
  assert(types.includes('codeBlock'), 'has codeBlock');
  assert(types.includes('divider'), 'has divider');
  assert(types.includes('blockquote'), 'has blockquote');
}
console.log('');

console.log('11. Empty document');
{
  const blocks = markdownToModel('');
  assert(blocks.length === 1, 'default block');
  assert(blocks[0].type === 'paragraph', 'empty paragraph');
}
console.log('');

// ─── Model → Markdown ──────────────────────────────

console.log('12. Serialize heading');
{
  const md = modelToMarkdown([{ id: '1', type: 'heading', content: 'Test', attrs: { level: 2 } }]);
  assert(md.includes('## Test'), `got: ${md.trim()}`);
}
console.log('');

console.log('13. Serialize bullet list');
{
  const md = modelToMarkdown([
    { id: '1', type: 'bulletList', content: 'A', attrs: {} },
    { id: '2', type: 'bulletList', content: 'B', attrs: {} },
  ]);
  assert(md.includes('- A'), 'item A');
  assert(md.includes('- B'), 'item B');
}
console.log('');

console.log('14. Serialize ordered list');
{
  const md = modelToMarkdown([
    { id: '1', type: 'orderedList', content: 'First', attrs: {} },
    { id: '2', type: 'orderedList', content: 'Second', attrs: {} },
    { id: '3', type: 'orderedList', content: 'Third', attrs: {} },
  ]);
  assert(md.includes('1. First'), 'item 1');
  assert(md.includes('2. Second'), 'item 2');
  assert(md.includes('3. Third'), 'item 3');
}
console.log('');

console.log('15. Serialize task list');
{
  const md = modelToMarkdown([
    { id: '1', type: 'taskList', content: 'Done', attrs: { checked: true } },
    { id: '2', type: 'taskList', content: 'Todo', attrs: { checked: false } },
  ]);
  assert(md.includes('- [x] Done'), 'checked');
  assert(md.includes('- [ ] Todo'), 'unchecked');
}
console.log('');

console.log('16. Serialize code block');
{
  const md = modelToMarkdown([{ id: '1', type: 'codeBlock', content: 'const x = 1;', attrs: { lang: 'js' } }]);
  assert(md.includes('```js'), 'fence + lang');
  assert(md.includes('const x = 1;'), 'code');
  assert(md.trim().endsWith('```'), 'closing fence');
}
console.log('');

console.log('17. Serialize divider');
{
  const md = modelToMarkdown([{ id: '1', type: 'divider', content: '', attrs: {} }]);
  assert(md.includes('---'), 'divider');
}
console.log('');

console.log('18. Serialize blockquote');
{
  const md = modelToMarkdown([{ id: '1', type: 'blockquote', content: 'Quote text', attrs: {} }]);
  assert(md.includes('> Quote text'), 'blockquote');
}
console.log('');

// ─── Round-trip ─────────────────────────────────────

console.log('19. Round-trip: heading');
{
  const original = '# Hello World\n';
  const blocks = markdownToModel(original);
  const result = modelToMarkdown(blocks);
  assert(result.trim() === original.trim(), `roundtrip: "${result.trim()}" === "${original.trim()}"`);
}
console.log('');

console.log('20. Round-trip: list items');
{
  const original = '- A\n- B\n- C';
  const blocks = markdownToModel(original + '\n');
  const result = modelToMarkdown(blocks);
  assert(result.includes('- A') && result.includes('- B') && result.includes('- C'), 'items preserved');
}
console.log('');

console.log('21. Round-trip: task list');
{
  const blocks = markdownToModel('- [x] Done\n- [ ] Todo\n');
  const result = modelToMarkdown(blocks);
  assert(result.includes('- [x] Done'), 'checked preserved');
  assert(result.includes('- [ ] Todo'), 'unchecked preserved');
}
console.log('');

console.log('22. Round-trip: code block');
{
  const original = '```python\nprint("hello")\n```';
  const blocks = markdownToModel(original + '\n');
  const result = modelToMarkdown(blocks);
  assert(result.includes('```python'), 'lang preserved');
  assert(result.includes('print("hello")'), 'code preserved');
}
console.log('');

console.log('23. Round-trip: complex document');
{
  const md = `# My Doc

Some paragraph text.

- Bullet one
- Bullet two

1. Ordered one
2. Ordered two

- [x] Task done
- [ ] Task todo

\`\`\`js
const x = 42;
\`\`\`

---

> A quote
`;
  const blocks = markdownToModel(md);
  const result = modelToMarkdown(blocks);

  assert(result.includes('# My Doc'), 'heading');
  assert(result.includes('Some paragraph text.'), 'paragraph');
  assert(result.includes('- Bullet one'), 'bullet');
  assert(result.includes('1. Ordered one'), 'ordered');
  assert(result.includes('- [x] Task done'), 'task checked');
  assert(result.includes('- [ ] Task todo'), 'task unchecked');
  assert(result.includes('```js'), 'code fence');
  assert(result.includes('const x = 42;'), 'code body');
  assert(result.includes('---'), 'divider');
  assert(result.includes('> A quote'), 'blockquote');
}
console.log('');

console.log('24. Blank line handling between different types');
{
  const blocks = markdownToModel('# Title\n\nParagraph.\n\n- List item\n');
  const result = modelToMarkdown(blocks);
  // Should have blank lines between different block types
  assert(result.includes('# Title\n\nParagraph.'), 'blank between heading and para');
}
console.log('');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
