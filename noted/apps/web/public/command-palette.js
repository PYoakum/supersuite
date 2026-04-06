/**
 * Noted — Command Palette (Ctrl+P quick switcher)
 * Provides quick doc switching, search, and actions.
 */

class CommandPalette {
  constructor(opts = {}) {
    this.getDocuments = opts.getDocuments || (async () => []);
    this.onSelect = opts.onSelect || (() => {});
    this.overlay = null;
    this.input = null;
    this.list = null;
    this.items = [];
    this.filtered = [];
    this.selectedIdx = 0;

    // Global keyboard shortcut
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        this.open();
      }
      if (e.key === 'Escape' && this.overlay) {
        this.close();
      }
    });

    this._buildDom();
  }

  _buildDom() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'cmd-palette-overlay';
    this.overlay.style.display = 'none';
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    const panel = document.createElement('div');
    panel.className = 'cmd-palette';

    this.input = document.createElement('input');
    this.input.className = 'cmd-input';
    this.input.placeholder = 'Search documents…';
    this.input.addEventListener('input', () => this._filter());
    this.input.addEventListener('keydown', (e) => this._onKey(e));

    this.list = document.createElement('div');
    this.list.className = 'cmd-list';

    panel.appendChild(this.input);
    panel.appendChild(this.list);
    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);
  }

  async open() {
    this.overlay.style.display = 'flex';
    this.input.value = '';
    this.selectedIdx = 0;

    // Load documents
    try {
      this.items = await this.getDocuments();
    } catch { this.items = []; }

    this._filter();
    this.input.focus();
  }

  close() {
    this.overlay.style.display = 'none';
    this.input.value = '';
  }

  _filter() {
    const q = this.input.value.trim().toLowerCase();
    this.filtered = q
      ? this.items.filter(d => d.title.toLowerCase().includes(q) || d.slug.includes(q))
      : this.items;
    this.selectedIdx = 0;
    this._render();
  }

  _render() {
    if (this.filtered.length === 0) {
      this.list.innerHTML = '<div class="cmd-empty">No documents found</div>';
      return;
    }
    this.list.innerHTML = this.filtered.slice(0, 15).map((d, i) => {
      const date = new Date(d.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `<div class="cmd-item${i === this.selectedIdx ? ' selected' : ''}" data-idx="${i}">
        <span class="cmd-item-title">${this._esc(d.title)}</span>
        <span class="cmd-item-meta">${date}</span>
      </div>`;
    }).join('');

    this.list.querySelectorAll('.cmd-item').forEach(el => {
      el.addEventListener('click', () => {
        const item = this.filtered[parseInt(el.dataset.idx)];
        if (item) { this.onSelect(item); this.close(); }
      });
    });
  }

  _onKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIdx = Math.min(this.selectedIdx + 1, this.filtered.length - 1);
      this._render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIdx = Math.max(this.selectedIdx - 1, 0);
      this._render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = this.filtered[this.selectedIdx];
      if (item) { this.onSelect(item); this.close(); }
    }
  }

  _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
}

window.CommandPalette = CommandPalette;
