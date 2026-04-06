import { layout, escapeHtml } from "../template.js";

export function editPage(config, loggedIn, page, { error, isNew = false } = {}) {
  const title = isNew ? "New Page" : `Editing: ${page.title}`;
  const actionUrl = isNew ? "/new" : `/wiki/${escapeHtml(page.slug)}/edit`;

  const errorHtml = error ? `<div class="alert alert-error">${escapeHtml(error)}</div>` : "";

  const slugField = isNew
    ? `<div class="form-group">
         <label for="slug">Page Slug</label>
         <input type="text" id="slug" name="slug" value="${escapeHtml(page.slug)}" pattern="[a-z0-9\\-]+" required
                placeholder="my-page-name">
       </div>`
    : "";

  const body = `
    <h1>${escapeHtml(title)}</h1>
    ${errorHtml}
    <form method="POST" action="${actionUrl}">
      ${slugField}
      <div class="editor-container">
        <div class="editor-pane">
          <div class="form-group">
            <label for="content">Content (Markdown)</label>
            <textarea id="content" name="content">${escapeHtml(page.content)}</textarea>
          </div>
        </div>
        <div class="preview-pane wiki-body" id="preview">
          <p class="meta">Preview will appear here...</p>
        </div>
      </div>
      <div style="margin-top: 0.5rem; display: flex; gap: 0.5rem;">
        <button type="submit" class="btn">Save</button>
        ${isNew ? '' : `<a href="/wiki/${escapeHtml(page.slug)}" class="btn btn-secondary">Cancel</a>`}
      </div>
    </form>
    <script src="https://cdn.jsdelivr.net/npm/marked@17/marked.min.js"></script>
    <script>
      (function() {
        const textarea = document.getElementById('content');
        const preview = document.getElementById('preview');
        let timer;
        function update() {
          preview.innerHTML = marked.parse(textarea.value || '');
        }
        textarea.addEventListener('input', function() {
          clearTimeout(timer);
          timer = setTimeout(update, 200);
        });
        update();
      })();
    </script>
  `;
  return layout(config, loggedIn, title, body);
}
