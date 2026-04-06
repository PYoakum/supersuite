import { parser } from './packages/shared/src/index.js';

let passed = 0;
let failed = 0;

function assert(ok, msg) {
  if (!ok) { console.error(`  FAIL: ${msg}`); failed++; }
  else { console.log(`  PASS: ${msg}`); passed++; }
}

function parse(md) {
  parser.resetHeadingIds();
  return parser.parse(md);
}

function html(md) {
  parser.resetHeadingIds();
  const ast = parser.parse(md);
  return parser.renderWithToc(ast).html;
}

function roundtrip(md) {
  parser.resetHeadingIds();
  const ast = parser.parse(md);
  return parser.serialize(ast);
}

// ─── Block parsing ─────────────────────────────────────────────────

console.log('1. Headings');
{
  const ast = parse('# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6\n');
  assert(ast.children.length === 6, `6 headings (got ${ast.children.length})`);
  assert(ast.children[0].level === 1, 'h1');
  assert(ast.children[5].level === 6, 'h6');
  assert(ast.children[0].id === 'h1', 'heading id');

  const h = html('# Hello World\n');
  assert(h.includes('<h1 id="hello-world">Hello World</h1>'), 'heading HTML');
}
console.log('');

console.log('2. Paragraphs');
{
  const ast = parse('First paragraph.\n\nSecond paragraph.\n');
  assert(ast.children.length === 2, `2 paragraphs (got ${ast.children.length})`);
  assert(ast.children[0].type === 'paragraph', 'is paragraph');
}
console.log('');

console.log('3. Unordered lists');
{
  const ast = parse('- Item A\n- Item B\n- Item C\n');
  assert(ast.children.length === 1, '1 list');
  assert(ast.children[0].ordered === false, 'unordered');
  assert(ast.children[0].items.length === 3, '3 items');

  const h = html('- One\n- Two\n');
  assert(h.includes('<ul>'), 'has <ul>');
  assert(h.includes('<li>'), 'has <li>');
}
console.log('');

console.log('4. Ordered lists');
{
  const ast = parse('1. First\n2. Second\n3. Third\n');
  assert(ast.children[0].ordered === true, 'ordered');
  assert(ast.children[0].items.length === 3, '3 items');

  const h = html('1. A\n2. B\n');
  assert(h.includes('<ol>'), 'has <ol>');
}
console.log('');

console.log('5. Task lists (checklists)');
{
  const ast = parse('- [x] Done\n- [ ] Todo\n');
  const list = ast.children[0];
  assert(list.items[0].task === true, 'checked');
  assert(list.items[1].task === false, 'unchecked');

  const h = html('- [x] Done\n- [ ] Todo\n');
  assert(h.includes('checked'), 'checked attr');
  assert(h.includes('task-list'), 'task-list class');
  assert(h.includes('task-item'), 'task-item class');
}
console.log('');

console.log('6. Code blocks');
{
  const ast = parse('```js\nconst x = 1;\n```\n');
  assert(ast.children[0].type === 'codeBlock', 'is codeBlock');
  assert(ast.children[0].lang === 'js', 'language');
  assert(ast.children[0].code === 'const x = 1;', 'code content');

  const h = html('```python\nprint("hi")\n```\n');
  assert(h.includes('language-python'), 'lang class');
  assert(h.includes('print'), 'code rendered');
  // XSS: code content should be escaped
  const h2 = html('```\n<script>alert("xss")</script>\n```\n');
  assert(!h2.includes('<script>'), 'XSS escaped in code');
  assert(h2.includes('&lt;script&gt;'), 'script tags escaped');
}
console.log('');

console.log('7. Tables');
{
  const md = '| Name | Age |\n| --- | ---: |\n| Alice | 30 |\n| Bob | 25 |\n';
  const ast = parse(md);
  assert(ast.children[0].type === 'table', 'is table');
  assert(ast.children[0].rows.length === 2, '2 data rows');
  assert(ast.children[0].alignments[1] === 'right', 'right aligned');

  const h = html(md);
  assert(h.includes('<table>'), 'has table');
  assert(h.includes('<th'), 'has th');
  assert(h.includes('text-align:right'), 'right align style');
}
console.log('');

console.log('8. Blockquotes');
{
  const ast = parse('> First line\n> Second line\n');
  assert(ast.children[0].type === 'blockquote', 'is blockquote');
  assert(ast.children[0].children.length >= 1, 'has content');

  const h = html('> Important note\n');
  assert(h.includes('<blockquote>'), 'blockquote tag');
}
console.log('');

console.log('9. Thematic breaks');
{
  const ast = parse('---\n');
  assert(ast.children[0].type === 'thematicBreak', 'is thematicBreak');

  const h = html('***\n');
  assert(h.includes('<hr>'), 'hr tag');
}
console.log('');

console.log('10. Nested lists');
{
  const ast = parse('- Parent\n  - Child\n    - Grandchild\n');
  assert(ast.children[0].items.length >= 1, 'has items');

  const h = html('- A\n  - B\n    - C\n');
  assert((h.match(/<ul>/g) || []).length >= 2, 'nested ul tags');
}
console.log('');

// ─── Inline parsing ────────────────────────────────────────────────

console.log('11. Bold and italic');
{
  const h = html('**bold** and *italic*\n');
  assert(h.includes('<strong>bold</strong>'), 'bold');
  assert(h.includes('<em>italic</em>'), 'italic');
}
console.log('');

console.log('12. Inline code');
{
  const h = html('Use `console.log()` here\n');
  assert(h.includes('<code>console.log()</code>'), 'inline code');
}
console.log('');

console.log('13. Links');
{
  const h = html('[Click](https://example.com "Title")\n');
  assert(h.includes('href="https://example.com"'), 'link href');
  assert(h.includes('title="Title"'), 'link title');
  assert(h.includes('>Click</a>'), 'link text');
}
console.log('');

console.log('14. Images');
{
  const h = html('![Alt text](image.png "Photo")\n');
  assert(h.includes('src="image.png"'), 'img src');
  assert(h.includes('alt="Alt text"'), 'img alt');
  assert(h.includes('title="Photo"'), 'img title');
}
console.log('');

console.log('15. Wiki-links');
{
  const h = html('See [[My Page]] and [[target|Display Text]]\n');
  assert(h.includes('wiki-link'), 'wiki-link class');
  assert(h.includes('My Page'), 'wiki-link text');
  assert(h.includes('Display Text'), 'custom display');
  assert(h.includes('/d/'), 'resolved URL');
}
console.log('');

// ─── Directives ────────────────────────────────────────────────────

console.log('16. Callout directive');
{
  const md = ':::callout type="warning" title="Watch out"\nDanger ahead.\n:::\n';
  const ast = parse(md);
  assert(ast.children[0].type === 'directive', 'is directive');
  assert(ast.children[0].name === 'callout', 'callout name');
  assert(ast.children[0].attrs.type === 'warning', 'type attr');
  assert(ast.children[0].attrs.title === 'Watch out', 'title attr');

  const h = html(md);
  assert(h.includes('callout-warning'), 'warning class');
  assert(h.includes('callout-title'), 'title class');
  assert(h.includes('Watch out'), 'title text');
}
console.log('');

console.log('17. Embed directive');
{
  const md = ':::embed url="https://example.com/photo.png"\n:::\n';
  const h = html(md);
  assert(h.includes('<img'), 'image embed');
  assert(h.includes('photo.png'), 'image URL');
}
console.log('');

console.log('18. TOC directive');
{
  const md = '[[toc]]\n\n# First\n## Second\n### Third\n';
  const { html: h, headings } = (() => {
    parser.resetHeadingIds();
    const ast = parser.parse(md);
    return parser.renderWithToc(ast);
  })();
  assert(headings.length === 3, `3 headings (got ${headings.length})`);
  assert(h.includes('<nav class="toc">'), 'toc nav');
  assert(h.includes('href="#first"'), 'toc link');
  assert(!h.includes('TOC_PLACEHOLDER'), 'placeholder replaced');
}
console.log('');

// ─── Sanitization / XSS ───────────────────────────────────────────

console.log('19. XSS prevention');
{
  const h = html('[Click](javascript:alert(1))\n');
  assert(!h.includes('javascript:'), 'blocks javascript: URLs');

  const h2 = html('![img](data:text/html,<script>alert(1)</script>)\n');
  assert(!h2.includes('data:'), 'blocks data: URLs');

  const h3 = html('<script>alert("xss")</script>\n');
  assert(!h3.includes('<script>'), 'escapes raw HTML');
}
console.log('');

// ─── Heading IDs ───────────────────────────────────────────────────

console.log('20. Heading ID disambiguation');
{
  parser.resetHeadingIds();
  const ast = parser.parse('# Same\n## Same\n### Same\n');
  assert(ast.children[0].id === 'same', 'first id: same');
  assert(ast.children[1].id === 'same-1', 'second id: same-1');
  assert(ast.children[2].id === 'same-2', 'third id: same-2');
}
console.log('');

// ─── Round-trip serialization ──────────────────────────────────────

console.log('21. Round-trip: headings');
{
  const rt = roundtrip('# Hello\n\n## World\n');
  assert(rt.includes('# Hello'), 'h1 preserved');
  assert(rt.includes('## World'), 'h2 preserved');
}
console.log('');

console.log('22. Round-trip: lists');
{
  const rt = roundtrip('- A\n- B\n- C\n');
  assert(rt.includes('- A'), 'item A');
  assert(rt.includes('- C'), 'item C');
}
console.log('');

console.log('23. Round-trip: code block');
{
  const rt = roundtrip('```js\nconst x = 1;\n```\n');
  assert(rt.includes('```js'), 'fence + lang');
  assert(rt.includes('const x = 1;'), 'code content');
  assert(rt.includes('```\n'), 'closing fence');
}
console.log('');

console.log('24. Round-trip: table');
{
  const md = '| A | B |\n| --- | ---: |\n| 1 | 2 |\n';
  const rt = roundtrip(md);
  assert(rt.includes('| A | B |'), 'header preserved');
  assert(rt.includes('---:'), 'alignment preserved');
  assert(rt.includes('| 1 | 2 |'), 'data preserved');
}
console.log('');

console.log('25. Round-trip: task list');
{
  const rt = roundtrip('- [x] Done\n- [ ] Todo\n');
  assert(rt.includes('[x]'), 'checked preserved');
  assert(rt.includes('[ ]'), 'unchecked preserved');
}
console.log('');

console.log('26. Round-trip: blockquote');
{
  const rt = roundtrip('> Some quote\n');
  assert(rt.includes('> '), 'quote marker');
}
console.log('');

console.log('27. Round-trip: directive');
{
  const md = ':::callout type="info" title="Note"\nContent here.\n:::\n';
  const rt = roundtrip(md);
  assert(rt.includes(':::callout'), 'directive open');
  assert(rt.includes('type="info"'), 'attrs');
  assert(rt.includes(':::\n'), 'directive close');
}
console.log('');

console.log('28. Round-trip: wiki-links and inline');
{
  const rt = roundtrip('Hello **bold** and [[wiki]] link.\n');
  assert(rt.includes('**bold**'), 'bold preserved');
  assert(rt.includes('[[wiki]]'), 'wiki-link preserved');
}
console.log('');

console.log('29. Round-trip: TOC');
{
  const rt = roundtrip('[[toc]]\n\n# H\n');
  assert(rt.includes('[[toc]]'), 'toc preserved');
}
console.log('');

// ─── Edge cases ────────────────────────────────────────────────────

console.log('30. Empty document');
{
  const ast = parse('');
  assert(ast.type === 'document', 'is document');
  assert(ast.children.length === 0, 'no children');

  const h = html('');
  assert(h === '', 'empty html');
}
console.log('');

console.log('31. Only whitespace');
{
  const ast = parse('   \n\n  \n');
  assert(ast.children.length === 0, 'no children');
}
console.log('');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
