/**
 * Noted — Block-based WYSIWYG Editor
 *
 * Architecture:
 *   Model (array of blocks) ↔ DOM (contentEditable) ↔ Markdown
 *
 * Block types: paragraph, heading, bulletList, orderedList, taskList,
 *              codeBlock, blockquote, divider
 */

// ─── Block Model ────────────────────────────────────────────────────

let _nextId = 1;
function uid() { return 'b' + (_nextId++); }

/**
 * Create a block object.
 */
function createBlock(type, content = '', attrs = {}) {
  return { id: uid(), type, content, attrs: { ...attrs } };
}

function paragraph(content = '')   { return createBlock('paragraph', content); }
function heading(content, level=1) { return createBlock('heading', content, { level }); }
function bulletItem(content = '')  { return createBlock('bulletList', content); }
function orderedItem(content = '', start = 1) { return createBlock('orderedList', content, { start }); }
function taskItem(content = '', checked = false) { return createBlock('taskList', content, { checked }); }
function codeBlock(content = '', lang = '') { return createBlock('codeBlock', content, { lang }); }
function blockquoteBlock(content = '') { return createBlock('blockquote', content); }
function divider() { return createBlock('divider', ''); }

// ─── Markdown → Model ──────────────────────────────────────────────

function markdownToModel(md) {
  if (!md || !md.trim()) return [paragraph('')];

  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (line.trim() === '') { i++; continue; }

    // Fenced code block
    const fenceMatch = line.match(/^(`{3,}|~{3,})\s*(\S*)/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const lang = fenceMatch[2] || '';
      const fenceChar = fence[0];
      const fenceLen = fence.length;
      const codeLines = [];
      i++;
      while (i < lines.length) {
        if (new RegExp(`^\\${fenceChar}{${fenceLen},}\\s*$`).test(lines[i])) { i++; break; }
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push(codeBlock(codeLines.join('\n'), lang));
      continue;
    }

    // Thematic break
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(divider());
      i++;
      continue;
    }

    // ATX heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
    if (headingMatch) {
      blocks.push(heading(headingMatch[2], headingMatch[1].length));
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      const bqLines = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        let l = lines[i];
        if (l.startsWith('> ')) l = l.slice(2);
        else if (l.startsWith('>')) l = l.slice(1);
        bqLines.push(l);
        i++;
      }
      blocks.push(blockquoteBlock(bqLines.join('\n')));
      continue;
    }

    // Task list
    const taskMatch = line.match(/^[-*+]\s+\[([ xX])\]\s+(.*)/);
    if (taskMatch) {
      blocks.push(taskItem(taskMatch[2], taskMatch[1] !== ' '));
      i++;
      continue;
    }

    // Unordered list
    const bulletMatch = line.match(/^[-*+]\s+(.*)/);
    if (bulletMatch) {
      blocks.push(bulletItem(bulletMatch[1]));
      i++;
      continue;
    }

    // Ordered list
    const orderedMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (orderedMatch) {
      blocks.push(orderedItem(orderedMatch[2], parseInt(orderedMatch[1])));
      i++;
      continue;
    }

    // Directive blocks — store as paragraphs with raw marker for now
    if (line.startsWith(':::')) {
      const directiveLines = [line];
      i++;
      while (i < lines.length && lines[i].trim() !== ':::') {
        directiveLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) { directiveLines.push(lines[i]); i++; }
      blocks.push(paragraph(directiveLines.join('\n')));
      continue;
    }

    // TOC directive
    if (/^\[\[toc\]\]\s*$/i.test(line.trim())) {
      blocks.push(paragraph('[[toc]]'));
      i++;
      continue;
    }

    // Paragraph (collect continuation lines)
    const paraLines = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(paragraph(paraLines.join('\n')));
  }

  return blocks.length > 0 ? blocks : [paragraph('')];
}

function isBlockStart(line) {
  if (/^#{1,6}\s/.test(line)) return true;
  if (/^(`{3,}|~{3,})/.test(line)) return true;
  if (/^:::/.test(line)) return true;
  if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) return true;
  if (line.startsWith('>')) return true;
  if (/^[-*+]\s/.test(line)) return true;
  if (/^\d+\.\s/.test(line)) return true;
  if (/^\[\[toc\]\]/i.test(line.trim())) return true;
  return false;
}

// ─── Model → Markdown ──────────────────────────────────────────────

function modelToMarkdown(blocks) {
  const parts = [];
  let prevType = '';

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const nextBlock = blocks[i + 1];

    // Add blank line between different block types or between non-list blocks
    if (i > 0 && needsBlankLine(prevType, b.type)) {
      parts.push('');
    }

    switch (b.type) {
      case 'paragraph':
        parts.push(b.content);
        break;
      case 'heading':
        parts.push('#'.repeat(b.attrs.level || 1) + ' ' + b.content);
        break;
      case 'bulletList':
        parts.push('- ' + b.content);
        break;
      case 'orderedList': {
        // Compute sequential number
        let num = 1;
        for (let j = i - 1; j >= 0 && blocks[j].type === 'orderedList'; j--) num++;
        parts.push(num + '. ' + b.content);
        break;
      }
      case 'taskList':
        parts.push('- [' + (b.attrs.checked ? 'x' : ' ') + '] ' + b.content);
        break;
      case 'codeBlock':
        parts.push('```' + (b.attrs.lang || ''));
        parts.push(b.content);
        parts.push('```');
        break;
      case 'blockquote':
        parts.push(b.content.split('\n').map(l => '> ' + l).join('\n'));
        break;
      case 'divider':
        parts.push('---');
        break;
    }

    prevType = b.type;
  }

  return parts.join('\n') + '\n';
}

function needsBlankLine(prevType, currType) {
  // No blank line between consecutive list items of the same type
  if (prevType === currType && ['bulletList', 'orderedList', 'taskList'].includes(currType)) {
    return false;
  }
  return true;
}

// ─── Editor Class ───────────────────────────────────────────────────

class NotedEditor {
  constructor(container, opts = {}) {
    this.container = container;
    this.blocks = [paragraph('')];
    this.onChange = opts.onChange || (() => {});
    this.activeBlockId = null;

    // Setup container
    this.container.classList.add('noted-editor');
    this.container.setAttribute('role', 'textbox');
    this.container.setAttribute('aria-multiline', 'true');

    // Event listeners
    this.container.addEventListener('input', (e) => this._onInput(e));
    this.container.addEventListener('keydown', (e) => this._onKeyDown(e));
    this.container.addEventListener('click', (e) => this._onClick(e));
    this.container.addEventListener('paste', (e) => this._onPaste(e));
    this.container.addEventListener('focus', () => this._onFocus(), true);

    this._render();
  }

  // ─── Public API ──────────────────────────────────

  /** Load markdown content into the editor. */
  load(markdown) {
    this.blocks = markdownToModel(markdown);
    this._render();
    this._focusBlock(this.blocks[0]?.id);
  }

  /** Get markdown content from the editor. */
  getMarkdown() {
    this._syncAllFromDom();
    return modelToMarkdown(this.blocks);
  }

  /** Focus the editor. */
  focus() {
    const first = this.container.querySelector('[data-block-id]');
    if (first) {
      const editable = first.querySelector('[contenteditable]') || first;
      editable.focus();
    }
  }

  /** Insert a block after the currently active block. */
  insertBlockAfter(type, content = '', attrs = {}) {
    const idx = this._activeIndex();
    const block = createBlock(type, content, attrs);
    this.blocks.splice(idx + 1, 0, block);
    this._render();
    this._focusBlock(block.id);
    this._emitChange();
    return block;
  }

  // ─── DOM Rendering ───────────────────────────────

  _render() {
    const frag = document.createDocumentFragment();

    for (const block of this.blocks) {
      const el = this._renderBlock(block);
      frag.appendChild(el);
    }

    this.container.innerHTML = '';
    this.container.appendChild(frag);
  }

  _renderBlock(block) {
    const wrapper = document.createElement('div');
    wrapper.className = 'block block-' + block.type;
    wrapper.dataset.blockId = block.id;

    switch (block.type) {
      case 'paragraph':
        wrapper.innerHTML = this._editableHtml(block.content, 'p');
        break;

      case 'heading': {
        const tag = 'h' + (block.attrs.level || 1);
        wrapper.innerHTML = this._editableHtml(block.content, tag);
        break;
      }

      case 'bulletList':
        wrapper.classList.add('block-list');
        wrapper.innerHTML = `<span class="list-marker">•</span>${this._editableHtml(block.content, 'div')}`;
        break;

      case 'orderedList': {
        wrapper.classList.add('block-list');
        // Compute sequential number
        const idx = this.blocks.indexOf(block);
        let num = 1;
        for (let j = idx - 1; j >= 0 && this.blocks[j].type === 'orderedList'; j--) num++;
        wrapper.innerHTML = `<span class="list-marker list-marker-num">${num}.</span>${this._editableHtml(block.content, 'div')}`;
        break;
      }

      case 'taskList': {
        wrapper.classList.add('block-list', 'block-task');
        const checked = block.attrs.checked ? ' checked' : '';
        wrapper.innerHTML = `<input type="checkbox" class="task-checkbox"${checked}>${this._editableHtml(block.content, 'div')}`;
        // Checkbox handler
        setTimeout(() => {
          const cb = wrapper.querySelector('.task-checkbox');
          if (cb) cb.addEventListener('change', () => {
            block.attrs.checked = cb.checked;
            this._emitChange();
          });
        });
        break;
      }

      case 'codeBlock': {
        wrapper.classList.add('block-code');
        const langLabel = block.attrs.lang ? `<span class="code-lang">${this._esc(block.attrs.lang)}</span>` : '';
        wrapper.innerHTML = `<div class="code-header">${langLabel}<button class="code-lang-btn" title="Change language">lang</button></div><pre><code contenteditable="true" spellcheck="false" data-editable="true">${this._esc(block.content)}</code></pre>`;
        // Language button handler
        setTimeout(() => {
          const btn = wrapper.querySelector('.code-lang-btn');
          if (btn) btn.addEventListener('click', () => {
            const lang = prompt('Language:', block.attrs.lang || '');
            if (lang !== null) {
              block.attrs.lang = lang;
              this._render();
              this._focusBlock(block.id);
              this._emitChange();
            }
          });
        });
        break;
      }

      case 'blockquote':
        wrapper.classList.add('block-bq');
        wrapper.innerHTML = this._editableHtml(block.content, 'div');
        break;

      case 'divider':
        wrapper.innerHTML = '<hr>';
        wrapper.classList.add('block-divider');
        // Make it selectable
        wrapper.tabIndex = 0;
        break;

      default:
        wrapper.innerHTML = this._editableHtml(block.content, 'div');
    }

    return wrapper;
  }

  _editableHtml(content, tag) {
    const rendered = this._renderInlineForEdit(content);
    return `<${tag} contenteditable="true" data-editable="true">${rendered || '<br>'}</${tag}>`;
  }

  /** Render inline markdown as HTML for the editor (live preview). */
  _renderInlineForEdit(text) {
    if (!text) return '';
    return this._esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:4px">')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, target, display) =>
        `<a class="wiki-link" href="/d/${encodeURIComponent(target.trim().toLowerCase().replace(/\s+/g,'-'))}">${this._esc(display || target)}</a>`
      );
  }

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ─── DOM → Model Sync ──────────────────────────

  /** Sync a single block's content from DOM to model. */
  _syncBlockFromDom(blockId) {
    const block = this.blocks.find(b => b.id === blockId);
    if (!block) return;

    const wrapper = this.container.querySelector(`[data-block-id="${blockId}"]`);
    if (!wrapper) return;

    const editable = wrapper.querySelector('[data-editable]');
    if (!editable) return;

    if (block.type === 'codeBlock') {
      block.content = editable.textContent || '';
    } else {
      block.content = this._domToInlineMarkdown(editable);
    }
  }

  /** Sync all blocks from DOM. */
  _syncAllFromDom() {
    for (const block of this.blocks) {
      this._syncBlockFromDom(block.id);
    }
  }

  /** Extract inline markdown from a contenteditable element. */
  _domToInlineMarkdown(el) {
    let result = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        result += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();
        const inner = this._domToInlineMarkdown(node);
        switch (tag) {
          case 'strong': case 'b': result += `**${inner}**`; break;
          case 'em': case 'i': result += `*${inner}*`; break;
          case 'code': result += `\`${inner}\``; break;
          case 'a': {
            const href = node.getAttribute('href') || '';
            if (node.classList.contains('wiki-link')) {
              result += `[[${inner}]]`;
            } else {
              result += `[${inner}](${href})`;
            }
            break;
          }
          case 'img': {
            const src = node.getAttribute('src') || '';
            const alt = node.getAttribute('alt') || '';
            result += `![${alt}](${src})`;
            break;
          }
          case 'br': result += '\n'; break;
          default: result += inner;
        }
      }
    }
    return result;
  }

  // ─── Selection & Focus ───────────────────────────

  _activeIndex() {
    const idx = this.blocks.findIndex(b => b.id === this.activeBlockId);
    return idx >= 0 ? idx : 0;
  }

  _focusBlock(blockId, atEnd = false) {
    this.activeBlockId = blockId;
    const wrapper = this.container.querySelector(`[data-block-id="${blockId}"]`);
    if (!wrapper) return;

    const editable = wrapper.querySelector('[data-editable]');
    if (!editable) { wrapper.focus(); return; }

    editable.focus();

    if (atEnd) {
      this._setCursorEnd(editable);
    } else {
      this._setCursorStart(editable);
    }
  }

  _setCursorStart(el) {
    const sel = window.getSelection();
    const range = document.createRange();
    if (el.childNodes.length > 0 && el.childNodes[0].nodeType === Node.ELEMENT_NODE && el.childNodes[0].tagName === 'BR') {
      range.setStart(el, 0);
    } else if (el.childNodes.length > 0) {
      range.setStart(el.childNodes[0], 0);
    } else {
      range.setStart(el, 0);
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  _setCursorEnd(el) {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  _getCursorOffset(el) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return 0;
    const range = sel.getRangeAt(0).cloneRange();
    range.selectNodeContents(el);
    range.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
    return range.toString().length;
  }

  _getBlockIdFromEl(el) {
    const wrapper = el.closest('[data-block-id]');
    return wrapper ? wrapper.dataset.blockId : null;
  }

  // ─── Event Handlers ──────────────────────────────

  _onFocus() {
    const sel = window.getSelection();
    if (sel.anchorNode) {
      const id = this._getBlockIdFromEl(sel.anchorNode.nodeType === Node.ELEMENT_NODE ? sel.anchorNode : sel.anchorNode.parentElement);
      if (id) this.activeBlockId = id;
    }
  }

  _onClick(e) {
    // Handle task checkbox
    if (e.target.classList?.contains('task-checkbox')) return;

    // Handle divider selection
    const divBlock = e.target.closest('.block-divider');
    if (divBlock) {
      this.activeBlockId = divBlock.dataset.blockId;
      return;
    }

    // Track active block
    const wrapper = e.target.closest('[data-block-id]');
    if (wrapper) {
      this.activeBlockId = wrapper.dataset.blockId;
    }
  }

  _onInput(e) {
    const id = this._getBlockIdFromEl(e.target);
    if (id) {
      this._syncBlockFromDom(id);
      this._checkAutoFormat(id);
      this._emitChange();
    }
  }

  _onKeyDown(e) {
    const id = this._getBlockIdFromEl(e.target);
    if (!id) return;
    this.activeBlockId = id;
    const block = this.blocks.find(b => b.id === id);
    if (!block) return;

    const editable = e.target.closest('[data-editable]');

    // ─── Enter ───
    if (e.key === 'Enter' && !e.shiftKey) {
      if (block.type === 'codeBlock') return; // allow newlines in code

      e.preventDefault();
      this._syncBlockFromDom(id);

      // If empty list item, convert to paragraph (exit list)
      if (['bulletList', 'orderedList', 'taskList'].includes(block.type) && !block.content.trim()) {
        block.type = 'paragraph';
        block.content = '';
        block.attrs = {};
        this._render();
        this._focusBlock(block.id);
        this._emitChange();
        return;
      }

      // Split block at cursor
      const offset = editable ? this._getCursorOffset(editable) : block.content.length;
      const before = block.content.slice(0, offset);
      const after = block.content.slice(offset);

      block.content = before;

      // New block inherits list type
      let newBlock;
      if (block.type === 'bulletList') {
        newBlock = bulletItem(after);
      } else if (block.type === 'orderedList') {
        newBlock = orderedItem(after);
      } else if (block.type === 'taskList') {
        newBlock = taskItem(after, false);
      } else {
        newBlock = paragraph(after);
      }

      const idx = this.blocks.indexOf(block);
      this.blocks.splice(idx + 1, 0, newBlock);
      this._render();
      this._focusBlock(newBlock.id);
      this._emitChange();
      return;
    }

    // ─── Backspace at start ───
    if (e.key === 'Backspace') {
      const offset = editable ? this._getCursorOffset(editable) : 0;
      if (offset === 0) {
        // If non-paragraph, convert to paragraph first
        if (block.type !== 'paragraph' && block.type !== 'divider') {
          e.preventDefault();
          this._syncBlockFromDom(id);
          block.type = 'paragraph';
          block.attrs = {};
          this._render();
          this._focusBlock(block.id);
          this._emitChange();
          return;
        }

        // Merge with previous block
        const idx = this.blocks.indexOf(block);
        if (idx > 0) {
          e.preventDefault();
          this._syncBlockFromDom(id);
          const prev = this.blocks[idx - 1];

          if (prev.type === 'divider') {
            // Just delete the divider
            this.blocks.splice(idx - 1, 1);
            this._render();
            this._focusBlock(block.id);
            this._emitChange();
            return;
          }

          const prevLen = prev.content.length;
          prev.content += block.content;
          this.blocks.splice(idx, 1);
          this._render();

          // Place cursor at merge point
          this._focusBlockAtOffset(prev.id, prevLen);
          this._emitChange();
          return;
        }
      }
    }

    // ─── Delete on divider ───
    if ((e.key === 'Backspace' || e.key === 'Delete') && block.type === 'divider') {
      e.preventDefault();
      const idx = this.blocks.indexOf(block);
      this.blocks.splice(idx, 1);
      if (this.blocks.length === 0) this.blocks.push(paragraph(''));
      this._render();
      const focusIdx = Math.min(idx, this.blocks.length - 1);
      this._focusBlock(this.blocks[focusIdx].id);
      this._emitChange();
      return;
    }

    // ─── Tab / Shift+Tab — indent/outdent ───
    if (e.key === 'Tab') {
      if (['bulletList', 'orderedList', 'taskList'].includes(block.type)) {
        e.preventDefault();
        // For MVP, Tab converts between list types
        if (e.shiftKey) {
          // Outdent: convert to paragraph
          this._syncBlockFromDom(id);
          block.type = 'paragraph';
          block.attrs = {};
          this._render();
          this._focusBlock(block.id, true);
          this._emitChange();
        }
        return;
      }
      if (block.type === 'codeBlock') return; // allow tab in code
      e.preventDefault();
      return;
    }

    // ─── Ctrl+B — Bold ───
    if (e.key === 'b' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this._wrapSelection('**');
      return;
    }

    // ─── Ctrl+I — Italic ───
    if (e.key === 'i' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this._wrapSelection('*');
      return;
    }

    // ─── Ctrl+E — Inline code ───
    if (e.key === 'e' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this._wrapSelection('`');
      return;
    }

    // ─── Ctrl+K — Link ───
    if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const sel = window.getSelection();
      const text = sel.toString();
      const url = prompt('URL:', 'https://');
      if (url) {
        this._syncBlockFromDom(id);
        const linkMd = `[${text || 'link'}](${url})`;
        document.execCommand('insertText', false, linkMd);
        this._syncBlockFromDom(id);
        this._emitChange();
      }
      return;
    }

    // ─── Arrow keys between blocks ───
    if (e.key === 'ArrowUp' && editable) {
      const offset = this._getCursorOffset(editable);
      if (offset === 0) {
        const idx = this.blocks.indexOf(block);
        if (idx > 0) {
          e.preventDefault();
          this._focusBlock(this.blocks[idx - 1].id, true);
        }
      }
    }

    if (e.key === 'ArrowDown' && editable) {
      const content = block.type === 'codeBlock' ? editable.textContent : block.content;
      const offset = this._getCursorOffset(editable);
      if (offset >= (editable.textContent || '').length) {
        const idx = this.blocks.indexOf(block);
        if (idx < this.blocks.length - 1) {
          e.preventDefault();
          this._focusBlock(this.blocks[idx + 1].id);
        }
      }
    }

    // ─── Slash commands ───
    if (e.key === '/' && editable && block.type === 'paragraph') {
      const offset = this._getCursorOffset(editable);
      if (offset === 0 && !block.content.trim()) {
        e.preventDefault();
        this._showSlashMenu(block);
        return;
      }
    }
  }

  // ─── Auto-formatting ─────────────────────────────

  _checkAutoFormat(blockId) {
    const block = this.blocks.find(b => b.id === blockId);
    if (!block || block.type !== 'paragraph') return;

    const content = block.content;

    // Heading: # through ######
    const headingMatch = content.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      block.type = 'heading';
      block.attrs.level = headingMatch[1].length;
      block.content = headingMatch[2];
      this._render();
      this._focusBlock(block.id, true);
      return;
    }

    // Bullet list: - or * or +
    if (/^[-*+]\s+(.*)/.test(content)) {
      const match = content.match(/^[-*+]\s+(.*)/);
      block.type = 'bulletList';
      block.content = match[1];
      this._render();
      this._focusBlock(block.id, true);
      return;
    }

    // Ordered list: 1.
    if (/^\d+\.\s+(.*)/.test(content)) {
      const match = content.match(/^\d+\.\s+(.*)/);
      block.type = 'orderedList';
      block.content = match[1];
      this._render();
      this._focusBlock(block.id, true);
      return;
    }

    // Task list: - [ ] or - [x]
    if (/^[-*+]\s+\[([ xX])\]\s+(.*)/.test(content)) {
      const match = content.match(/^[-*+]\s+\[([ xX])\]\s+(.*)/);
      block.type = 'taskList';
      block.attrs.checked = match[1] !== ' ';
      block.content = match[2];
      this._render();
      this._focusBlock(block.id, true);
      return;
    }

    // Code block: ```
    if (/^```(\w*)$/.test(content.trim())) {
      const match = content.trim().match(/^```(\w*)$/);
      block.type = 'codeBlock';
      block.attrs.lang = match[1] || '';
      block.content = '';
      this._render();
      this._focusBlock(block.id);
      return;
    }

    // Blockquote: >
    if (/^>\s+(.*)/.test(content)) {
      const match = content.match(/^>\s+(.*)/);
      block.type = 'blockquote';
      block.content = match[1];
      this._render();
      this._focusBlock(block.id, true);
      return;
    }

    // Divider: --- or *** or ___
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(content.trim())) {
      block.type = 'divider';
      block.content = '';
      // Insert paragraph after
      const idx = this.blocks.indexOf(block);
      const next = paragraph('');
      this.blocks.splice(idx + 1, 0, next);
      this._render();
      this._focusBlock(next.id);
      return;
    }
  }

  // ─── Slash Menu ──────────────────────────────────

  _showSlashMenu(block) {
    const existing = document.querySelector('.slash-menu');
    if (existing) existing.remove();

    const commands = [
      { label: 'Heading 1', icon: 'H1', action: () => this._convertBlock(block, 'heading', { level: 1 }) },
      { label: 'Heading 2', icon: 'H2', action: () => this._convertBlock(block, 'heading', { level: 2 }) },
      { label: 'Heading 3', icon: 'H3', action: () => this._convertBlock(block, 'heading', { level: 3 }) },
      { label: 'Bullet List', icon: '•', action: () => this._convertBlock(block, 'bulletList') },
      { label: 'Numbered List', icon: '1.', action: () => this._convertBlock(block, 'orderedList') },
      { label: 'Task List', icon: '☐', action: () => this._convertBlock(block, 'taskList', { checked: false }) },
      { label: 'Code Block', icon: '<>', action: () => this._convertBlock(block, 'codeBlock', { lang: '' }) },
      { label: 'Blockquote', icon: '❝', action: () => this._convertBlock(block, 'blockquote') },
      { label: 'Divider', icon: '—', action: () => {
        this._convertBlock(block, 'divider');
        const idx = this.blocks.indexOf(block);
        const next = paragraph('');
        this.blocks.splice(idx + 1, 0, next);
        this._render();
        this._focusBlock(next.id);
      }},
    ];

    const menu = document.createElement('div');
    menu.className = 'slash-menu';

    // Position near the block
    const wrapper = this.container.querySelector(`[data-block-id="${block.id}"]`);
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect();
      const containerRect = this.container.getBoundingClientRect();
      menu.style.top = (rect.bottom - containerRect.top + 4) + 'px';
      menu.style.left = (rect.left - containerRect.left) + 'px';
    }

    let selectedIdx = 0;

    const renderItems = (filter = '') => {
      const filtered = commands.filter(c => c.label.toLowerCase().includes(filter.toLowerCase()));
      menu.innerHTML = filtered.map((c, i) =>
        `<div class="slash-item${i === selectedIdx ? ' selected' : ''}" data-idx="${i}">
          <span class="slash-icon">${c.icon}</span>
          <span>${c.label}</span>
        </div>`
      ).join('');

      menu.querySelectorAll('.slash-item').forEach(el => {
        el.addEventListener('click', () => {
          const cmd = filtered[parseInt(el.dataset.idx)];
          if (cmd) cmd.action();
          closeMenu();
        });
      });

      return filtered;
    };

    const closeMenu = () => {
      menu.remove();
      document.removeEventListener('keydown', menuKeyHandler);
      document.removeEventListener('click', outsideClick);
    };

    let filtered = renderItems();

    const menuKeyHandler = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, filtered.length - 1); renderItems(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); renderItems(); return; }
      if (e.key === 'Enter') { e.preventDefault(); if (filtered[selectedIdx]) filtered[selectedIdx].action(); closeMenu(); return; }
    };

    const outsideClick = (e) => {
      if (!menu.contains(e.target)) closeMenu();
    };

    document.addEventListener('keydown', menuKeyHandler);
    setTimeout(() => document.addEventListener('click', outsideClick), 10);

    this.container.style.position = 'relative';
    this.container.appendChild(menu);
  }

  _convertBlock(block, type, attrs = {}) {
    block.type = type;
    block.attrs = { ...block.attrs, ...attrs };
    this._render();
    this._focusBlock(block.id);
    this._emitChange();
  }

  // ─── Inline Formatting ───────────────────────────

  _wrapSelection(marker) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const text = sel.toString();
    if (text) {
      document.execCommand('insertText', false, marker + text + marker);
    } else {
      document.execCommand('insertText', false, marker + marker);
    }
    // Sync
    if (this.activeBlockId) {
      this._syncBlockFromDom(this.activeBlockId);
      this._emitChange();
    }
  }

  // ─── Paste ───────────────────────────────────────

  _onPaste(e) {
    const id = this._getBlockIdFromEl(e.target);
    if (!id) return;
    const block = this.blocks.find(b => b.id === id);
    if (!block) return;

    // In code blocks, paste as plain text
    if (block.type === 'codeBlock') {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
      this._syncBlockFromDom(id);
      this._emitChange();
      return;
    }

    // Try to paste as markdown
    const text = e.clipboardData.getData('text/plain');
    if (text && text.includes('\n')) {
      e.preventDefault();

      // Parse the pasted markdown into blocks
      const pastedBlocks = markdownToModel(text);

      // Merge first pasted block with current
      this._syncBlockFromDom(id);
      const offset = this._getCursorOffset(e.target.closest('[data-editable]') || e.target);
      const before = block.content.slice(0, offset);
      const after = block.content.slice(offset);

      if (pastedBlocks.length === 1) {
        block.content = before + pastedBlocks[0].content + after;
      } else {
        block.content = before + pastedBlocks[0].content;
        const lastPasted = pastedBlocks[pastedBlocks.length - 1];
        lastPasted.content += after;

        const idx = this.blocks.indexOf(block);
        this.blocks.splice(idx + 1, 0, ...pastedBlocks.slice(1));
      }

      this._render();
      const lastBlock = pastedBlocks.length > 1 ? pastedBlocks[pastedBlocks.length - 1] : block;
      this._focusBlock(lastBlock.id, true);
      this._emitChange();
      return;
    }

    // Single-line paste: check for URL → auto-link
    if (text && /^https?:\/\/\S+$/.test(text.trim())) {
      e.preventDefault();
      const url = text.trim();
      // If image URL, create image block
      if (/\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$/i.test(url)) {
        document.execCommand('insertText', false, `![](${url})`);
      } else {
        const sel = window.getSelection();
        const selectedText = sel.toString();
        document.execCommand('insertText', false, `[${selectedText || url}](${url})`);
      }
      this._syncBlockFromDom(id);
      this._emitChange();
      return;
    }
  }

  // ─── Helpers ─────────────────────────────────────

  _focusBlockAtOffset(blockId, charOffset) {
    this.activeBlockId = blockId;
    const wrapper = this.container.querySelector(`[data-block-id="${blockId}"]`);
    if (!wrapper) return;

    const editable = wrapper.querySelector('[data-editable]');
    if (!editable) return;

    editable.focus();

    // Walk text nodes to find the right offset
    const sel = window.getSelection();
    const range = document.createRange();
    let remaining = charOffset;

    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (remaining <= node.textContent.length) {
        range.setStart(node, remaining);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      remaining -= node.textContent.length;
    }

    // Fallback: end
    this._setCursorEnd(editable);
  }

  _emitChange() {
    this.onChange();
  }
}

// Export for use
if (typeof window !== 'undefined') {
  window.NotedEditor = NotedEditor;
  window.NotedEditor.markdownToModel = markdownToModel;
  window.NotedEditor.modelToMarkdown = modelToMarkdown;
}
// Node.js / test export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NotedEditor, markdownToModel, modelToMarkdown };
}
