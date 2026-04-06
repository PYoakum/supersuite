function buildThemeVars(theme = {}) {
  const defaults = {
    bg: "#0d1117",
    bg_secondary: "#161b22",
    bg_hover: "#1c2128",
    bg_surface: "#21262d",
    border: "#30363d",
    border_subtle: "#21262d",
    text: "#c9d1d9",
    text_bright: "#f0f6fc",
    text_secondary: "#8b949e",
    text_muted: "#484f58",
    accent: "#58a6ff",
    success: "#238636",
    danger: "#f85149",
  };
  const merged = { ...defaults, ...theme };
  return `:root {\n${Object.entries(merged).map(([k, v]) => `    --pm-${k.replace(/_/g, "-")}: ${v};`).join("\n")}\n  }`;
}

export function buildTemplate(config) {
  const themeVars = buildThemeVars(config.theme);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>p-mail</title>
  <link href="https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.snow.css" rel="stylesheet">
  <style>${themeVars}\n${css}</style>
</head>
<body>
  <div id="app">
    <aside id="sidebar">
      <div class="sidebar-header">
        <h1>p-mail</h1>
        <button id="btn-compose" title="Compose">+</button>
      </div>
      <nav id="folder-list"></nav>
    </aside>
    <main id="content">
      <header id="toolbar">
        <div class="toolbar-left">
          <button id="btn-back" class="hidden">&larr;</button>
          <span id="toolbar-title">Inbox</span>
        </div>
        <div class="toolbar-right">
          <input type="text" id="search-box" placeholder="Search..." />
        </div>
      </header>

      <!-- Message List View -->
      <div id="view-list" class="view">
        <div id="message-list"></div>
        <div id="pagination"></div>
      </div>

      <!-- Message Detail View -->
      <div id="view-detail" class="view hidden">
        <div id="msg-header"></div>
        <div id="msg-actions">
          <button id="btn-reply">Reply</button>
          <button id="btn-reply-all">Reply All</button>
          <button id="btn-forward">Forward</button>
          <button id="btn-trash">Delete</button>
          <label id="lbl-external"><input type="checkbox" id="chk-external"> Load external images</label>
        </div>
        <div id="msg-attachments"></div>
        <iframe id="msg-body" sandbox="allow-same-origin"></iframe>
      </div>

      <!-- Compose View -->
      <div id="view-compose" class="view hidden">
        <div class="compose-fields">
          <div class="field-row"><label>To</label><input type="text" id="compose-to" /></div>
          <div class="field-row"><label>Cc</label><input type="text" id="compose-cc" /></div>
          <div class="field-row"><label>Bcc</label><input type="text" id="compose-bcc" /></div>
          <div class="field-row"><label>Subject</label><input type="text" id="compose-subject" /></div>
        </div>
        <div id="compose-editor"></div>
        <div class="compose-bottom">
          <div class="compose-attachments">
            <input type="file" id="compose-files" multiple />
            <div id="file-list"></div>
          </div>
          <div class="compose-actions">
            <button id="btn-save-draft">Save Draft</button>
            <button id="btn-save-template">Save as Template</button>
            <button id="btn-load-template">Load Template</button>
            <button id="btn-send" class="primary">Send</button>
          </div>
        </div>
      </div>

      <!-- Templates View -->
      <div id="view-templates" class="view hidden">
        <div id="template-list"></div>
      </div>
    </main>
  </div>

  <!-- Template Picker Modal -->
  <div id="modal-overlay" class="hidden">
    <div id="modal">
      <div id="modal-header">
        <span id="modal-title">Select Template</span>
        <button id="modal-close">&times;</button>
      </div>
      <div id="modal-body"></div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.js"></script>
  <script>${js}</script>
</body>
</html>`;
}

const css = `
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    background: var(--pm-bg);
    color: var(--pm-text);
    height: 100vh;
    overflow: hidden;
  }

  #app {
    display: flex;
    height: 100vh;
  }

  /* Sidebar */
  #sidebar {
    width: 220px;
    min-width: 220px;
    background: var(--pm-bg-secondary);
    border-right: 1px solid var(--pm-border);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    border-bottom: 1px solid var(--pm-border);
  }

  .sidebar-header h1 {
    font-size: 18px;
    font-weight: 600;
    color: var(--pm-accent);
  }

  .sidebar-header button {
    background: var(--pm-accent);
    color: var(--pm-bg);
    border: none;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    font-size: 20px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
  }

  .sidebar-header button:hover { background: color-mix(in srgb, var(--pm-accent) 80%, white); }

  #folder-list {
    padding: 8px 0;
  }

  .folder-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    cursor: pointer;
    color: var(--pm-text);
    font-size: 14px;
    border-left: 3px solid transparent;
  }

  .folder-item:hover { background: var(--pm-bg-hover); }
  .folder-item.active { background: var(--pm-bg-hover); border-left-color: var(--pm-accent); color: var(--pm-accent); }

  .folder-item .badge {
    background: var(--pm-accent);
    color: var(--pm-bg);
    font-size: 11px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 10px;
    min-width: 18px;
    text-align: center;
  }

  .folder-divider {
    border-top: 1px solid var(--pm-border);
    margin: 8px 16px;
  }

  .folder-item.templates-link { color: var(--pm-text-secondary); font-style: italic; }

  /* Main content */
  #content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  #toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--pm-border);
    background: var(--pm-bg-secondary);
    min-height: 52px;
  }

  .toolbar-left { display: flex; align-items: center; gap: 12px; }
  .toolbar-right { display: flex; align-items: center; gap: 8px; }

  #btn-back {
    background: none;
    border: 1px solid var(--pm-border);
    color: var(--pm-text);
    padding: 4px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 16px;
  }

  #btn-back:hover { border-color: var(--pm-accent); color: var(--pm-accent); }

  #toolbar-title { font-size: 16px; font-weight: 600; }

  #search-box {
    background: var(--pm-bg);
    border: 1px solid var(--pm-border);
    color: var(--pm-text);
    padding: 6px 12px;
    border-radius: 6px;
    width: 260px;
    font-size: 13px;
  }

  #search-box:focus { outline: none; border-color: var(--pm-accent); }

  .view { flex: 1; overflow-y: auto; }
  .hidden { display: none !important; }

  /* Message List */
  #message-list { }

  .msg-row {
    display: flex;
    align-items: center;
    padding: 10px 16px;
    border-bottom: 1px solid var(--pm-border-subtle);
    cursor: pointer;
    gap: 12px;
  }

  .msg-row:hover { background: var(--pm-bg-secondary); }
  .msg-row.unread { font-weight: 600; }
  .msg-row.unread .msg-from { color: var(--pm-text-bright); }

  .msg-row .msg-from {
    width: 200px;
    min-width: 200px;
    font-size: 13px;
    color: var(--pm-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .msg-row .msg-subject {
    flex: 1;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .msg-row .msg-subject .msg-preview {
    color: var(--pm-text-muted);
    margin-left: 6px;
  }

  .msg-row .msg-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--pm-text-muted);
    white-space: nowrap;
  }

  .msg-row .msg-attachment { color: var(--pm-accent); font-size: 14px; }

  #pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    gap: 8px;
    border-top: 1px solid var(--pm-border-subtle);
  }

  #pagination button {
    background: var(--pm-bg-surface);
    border: 1px solid var(--pm-border);
    color: var(--pm-text);
    padding: 4px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
  }

  #pagination button:hover { border-color: var(--pm-accent); }
  #pagination button:disabled { opacity: 0.4; cursor: default; }
  #pagination span { font-size: 13px; color: var(--pm-text-secondary); }

  /* Message Detail */
  #msg-header {
    padding: 16px;
    border-bottom: 1px solid var(--pm-border-subtle);
  }

  #msg-header .msg-subject-line {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 8px;
  }

  #msg-header .msg-meta-line {
    font-size: 13px;
    color: var(--pm-text-secondary);
    line-height: 1.6;
  }

  #msg-header .msg-meta-line strong { color: var(--pm-text); }

  #msg-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--pm-border-subtle);
    flex-wrap: wrap;
  }

  #msg-actions button, #msg-actions label {
    background: var(--pm-bg-surface);
    border: 1px solid var(--pm-border);
    color: var(--pm-text);
    padding: 5px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
  }

  #msg-actions button:hover { border-color: var(--pm-accent); color: var(--pm-accent); }
  #btn-trash { border-color: var(--pm-danger) !important; color: var(--pm-danger) !important; }
  #btn-trash:hover { background: color-mix(in srgb, var(--pm-danger) 13%, transparent); }

  #lbl-external {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    font-size: 12px;
    color: var(--pm-text-secondary);
  }

  #msg-attachments {
    padding: 8px 16px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .att-chip {
    background: var(--pm-bg-surface);
    border: 1px solid var(--pm-border);
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--pm-accent);
    text-decoration: none;
    cursor: pointer;
  }

  .att-chip:hover { border-color: var(--pm-accent); }

  #msg-body {
    width: 100%;
    flex: 1;
    border: none;
    background: #fff;
    min-height: 400px;
  }

  /* Compose */
  .compose-fields {
    padding: 12px 16px 0;
  }

  .field-row {
    display: flex;
    align-items: center;
    margin-bottom: 8px;
    gap: 8px;
  }

  .field-row label {
    width: 60px;
    min-width: 60px;
    font-size: 13px;
    color: var(--pm-text-secondary);
    text-align: right;
  }

  .field-row input {
    flex: 1;
    background: var(--pm-bg);
    border: 1px solid var(--pm-border);
    color: var(--pm-text);
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 13px;
  }

  .field-row input:focus { outline: none; border-color: var(--pm-accent); }

  #compose-editor {
    margin: 8px 16px;
    background: #fff;
    border-radius: 6px;
    min-height: 300px;
  }

  #compose-editor .ql-toolbar { border-color: var(--pm-border); background: #f0f0f0; border-radius: 6px 6px 0 0; }
  #compose-editor .ql-container { border-color: var(--pm-border); border-radius: 0 0 6px 6px; min-height: 250px; }

  .compose-bottom {
    padding: 8px 16px 16px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
  }

  .compose-attachments { flex: 1; }

  #compose-files {
    font-size: 13px;
    color: var(--pm-text-secondary);
  }

  #file-list {
    margin-top: 4px;
    font-size: 12px;
    color: var(--pm-text-secondary);
  }

  .compose-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .compose-actions button {
    background: var(--pm-bg-surface);
    border: 1px solid var(--pm-border);
    color: var(--pm-text);
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
  }

  .compose-actions button:hover { border-color: var(--pm-accent); }
  .compose-actions button.primary { background: var(--pm-success); border-color: var(--pm-success); color: #fff; }
  .compose-actions button.primary:hover { background: color-mix(in srgb, var(--pm-success) 80%, white); }

  /* Templates View */
  #template-list {
    padding: 16px;
  }

  .tmpl-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border: 1px solid var(--pm-border-subtle);
    border-radius: 6px;
    margin-bottom: 8px;
    cursor: pointer;
  }

  .tmpl-row:hover { border-color: var(--pm-accent); }

  .tmpl-row .tmpl-name { font-size: 14px; }
  .tmpl-row .tmpl-subject { font-size: 12px; color: var(--pm-text-secondary); margin-left: 12px; }

  .tmpl-row .tmpl-actions { display: flex; gap: 6px; }
  .tmpl-row .tmpl-actions button {
    background: none;
    border: 1px solid var(--pm-border);
    color: var(--pm-text);
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  .tmpl-row .tmpl-actions button:hover { border-color: var(--pm-accent); }
  .tmpl-row .tmpl-actions button.del { color: var(--pm-danger); border-color: var(--pm-danger); }

  /* Modal */
  #modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  #modal {
    background: var(--pm-bg-secondary);
    border: 1px solid var(--pm-border);
    border-radius: 8px;
    width: 500px;
    max-width: 90vw;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
  }

  #modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--pm-border);
  }

  #modal-title { font-weight: 600; }

  #modal-close {
    background: none;
    border: none;
    color: var(--pm-text-secondary);
    font-size: 20px;
    cursor: pointer;
  }

  #modal-body {
    padding: 12px 16px;
    overflow-y: auto;
    flex: 1;
  }

  .modal-item {
    padding: 8px 10px;
    border: 1px solid var(--pm-border-subtle);
    border-radius: 6px;
    margin-bottom: 6px;
    cursor: pointer;
    font-size: 13px;
  }

  .modal-item:hover { border-color: var(--pm-accent); }

  /* Empty state */
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
    color: var(--pm-text-muted);
    font-size: 14px;
  }

  /* Loading */
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
    color: var(--pm-text-secondary);
  }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-track { background: var(--pm-bg); }
  ::-webkit-scrollbar-thumb { background: var(--pm-border); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--pm-text-muted); }
`;

const js = `
(function() {
  // -- State --
  let currentFolder = "INBOX";
  let currentPage = 1;
  let currentMessage = null;
  let folders = [];
  let quill = null;
  let composeState = { draftUid: null, draftFolder: null, inReplyTo: null, references: null };

  // -- Init --
  document.addEventListener("DOMContentLoaded", () => {
    initQuill();
    loadFolders();
    bindEvents();
  });

  function initQuill() {
    quill = new Quill("#compose-editor", {
      theme: "snow",
      modules: {
        toolbar: [
          [{ header: [1, 2, 3, false] }],
          ["bold", "italic", "underline", "strike"],
          [{ list: "ordered" }, { list: "bullet" }],
          ["blockquote", "code-block"],
          ["link", "image"],
          ["clean"],
        ],
      },
      placeholder: "Write your email...",
    });
  }

  function bindEvents() {
    $("btn-compose").addEventListener("click", () => openCompose());
    $("btn-back").addEventListener("click", goBack);
    $("search-box").addEventListener("keydown", (e) => {
      if (e.key === "Enter") searchMessages(e.target.value);
    });
    $("btn-reply").addEventListener("click", () => replyMessage(false));
    $("btn-reply-all").addEventListener("click", () => replyMessage(true));
    $("btn-forward").addEventListener("click", forwardMessage);
    $("btn-trash").addEventListener("click", trashMessage);
    $("chk-external").addEventListener("change", reloadWithExternal);
    $("btn-send").addEventListener("click", sendMessage);
    $("btn-save-draft").addEventListener("click", saveDraft);
    $("btn-save-template").addEventListener("click", saveTemplate);
    $("btn-load-template").addEventListener("click", openTemplatePicker);
    $("modal-close").addEventListener("click", closeModal);
    $("modal-overlay").addEventListener("click", (e) => {
      if (e.target === $("modal-overlay")) closeModal();
    });
    $("compose-files").addEventListener("change", updateFileList);
  }

  // -- API helpers --
  async function api(path, opts) {
    const res = await fetch(path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Request failed");
    }
    return res.json();
  }

  function $(id) { return document.getElementById(id); }

  // -- Views --
  function showView(name) {
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    $("view-" + name).classList.remove("hidden");
    $("btn-back").classList.toggle("hidden", name === "list");
  }

  // -- Folders --
  async function loadFolders() {
    await refreshFolders();
    loadMessages();
  }

  async function refreshFolders() {
    folders = await api("/api/folders");
    renderFolders();
  }

  function renderFolders() {
    const nav = $("folder-list");
    const specialOrder = ["\\\\Inbox", "\\\\Sent", "\\\\Drafts", "\\\\Trash", "\\\\Junk"];

    // Sort: special folders first in order, then others
    const sorted = [...folders].sort((a, b) => {
      const ai = specialOrder.indexOf(a.specialUse);
      const bi = specialOrder.indexOf(b.specialUse);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.name.localeCompare(b.name);
    });

    let html = "";
    for (const f of sorted) {
      const active = f.path === currentFolder ? "active" : "";
      const badge = f.unseen > 0 ? '<span class="badge">' + f.unseen + "</span>" : "";
      const displayName = f.name === "INBOX" ? "Inbox" : f.name;
      html += '<div class="folder-item ' + active + '" data-folder="' + esc(f.path) + '">'
        + esc(displayName) + badge + "</div>";
    }

    html += '<div class="folder-divider"></div>';
    html += '<div class="folder-item templates-link" data-action="templates">Templates</div>';

    nav.innerHTML = html;
    nav.querySelectorAll(".folder-item").forEach((el) => {
      el.addEventListener("click", () => {
        if (el.dataset.action === "templates") {
          showTemplatesView();
          return;
        }
        currentFolder = el.dataset.folder;
        currentPage = 1;
        $("search-box").value = "";
        renderFolders();
        loadMessages();
      });
    });
  }

  // -- Messages --
  async function loadMessages() {
    showView("list");
    $("toolbar-title").textContent = folderDisplayName(currentFolder);
    $("message-list").innerHTML = '<div class="loading">Loading...</div>';
    $("pagination").innerHTML = "";

    const search = $("search-box").value;
    const qs = search ? "&search=" + encodeURIComponent(search) : "";
    const data = await api("/api/messages/" + encodeURIComponent(currentFolder) + "?page=" + currentPage + qs);

    if (!data.messages.length) {
      $("message-list").innerHTML = '<div class="empty-state">No messages</div>';
      return;
    }

    let html = "";
    for (const m of data.messages) {
      const env = m.envelope;
      const from = env.from?.[0]?.name || env.from?.[0]?.address || "Unknown";
      const subj = env.subject || "(no subject)";
      const date = formatDate(env.date);
      const unread = !m.flags.includes("\\\\Seen") ? "unread" : "";
      const att = m.hasAttachments ? '<span class="msg-attachment">&#128206;</span>' : "";

      html += '<div class="msg-row ' + unread + '" data-uid="' + m.uid + '">'
        + '<div class="msg-from">' + esc(from) + "</div>"
        + '<div class="msg-subject">' + esc(subj) + "</div>"
        + '<div class="msg-meta">' + att + '<span>' + esc(date) + "</span></div>"
        + "</div>";
    }

    $("message-list").innerHTML = html;

    // Pagination
    if (data.pages > 1) {
      let pg = '<button id="pg-prev" ' + (currentPage <= 1 ? "disabled" : "") + '>&laquo; Prev</button>';
      pg += "<span>Page " + data.page + " of " + data.pages + "</span>";
      pg += '<button id="pg-next" ' + (currentPage >= data.pages ? "disabled" : "") + '>Next &raquo;</button>';
      $("pagination").innerHTML = pg;
      $("pg-prev")?.addEventListener("click", () => { currentPage--; loadMessages(); });
      $("pg-next")?.addEventListener("click", () => { currentPage++; loadMessages(); });
    }

    // Click handlers
    $("message-list").querySelectorAll(".msg-row").forEach((row) => {
      row.addEventListener("click", () => openMessage(row.dataset.uid));
    });
  }

  function searchMessages(query) {
    currentPage = 1;
    loadMessages();
  }

  async function openMessage(uid) {
    // Check if draft folder — if so, open in compose mode
    const draftFolder = folders.find((f) => f.specialUse === "\\\\Drafts");
    if (draftFolder && currentFolder === draftFolder.path) {
      return openDraftInCompose(uid);
    }

    showView("detail");
    $("msg-header").innerHTML = '<div class="loading">Loading...</div>';
    $("msg-attachments").innerHTML = "";
    $("chk-external").checked = false;

    currentMessage = await api("/api/message/" + encodeURIComponent(currentFolder) + "/" + uid);

    // Mark as read
    if (!currentMessage.flags.includes("\\\\Seen")) {
      api("/api/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: currentFolder, uids: [uid], read: true }),
      }).then(() => refreshFolders().catch(() => {})).catch(() => {});
    }

    renderMessageDetail();
  }

  function renderMessageDetail() {
    const m = currentMessage;
    const from = m.from.map((a) => a.name ? a.name + " <" + a.address + ">" : a.address).join(", ");
    const to = m.to.map((a) => a.name ? a.name + " <" + a.address + ">" : a.address).join(", ");
    const cc = m.cc.length ? m.cc.map((a) => a.name ? a.name + " <" + a.address + ">" : a.address).join(", ") : "";
    const date = m.date ? new Date(m.date).toLocaleString() : "";

    let header = '<div class="msg-subject-line">' + esc(m.subject) + "</div>";
    header += '<div class="msg-meta-line"><strong>From:</strong> ' + esc(from) + "</div>";
    header += '<div class="msg-meta-line"><strong>To:</strong> ' + esc(to) + "</div>";
    if (cc) header += '<div class="msg-meta-line"><strong>Cc:</strong> ' + esc(cc) + "</div>";
    header += '<div class="msg-meta-line"><strong>Date:</strong> ' + esc(date) + "</div>";

    $("msg-header").innerHTML = header;

    // Attachments
    const atts = (m.attachmentParts || []).filter((a) => a.disposition === "attachment" || (a.filename && a.disposition !== "inline"));
    if (atts.length) {
      $("msg-attachments").innerHTML = atts.map((a) =>
        '<a class="att-chip" href="/api/attachment/' + encodeURIComponent(currentFolder) + "/" + m.uid + "/" + encodeURIComponent(a.partId) + '" target="_blank">'
        + esc(a.filename || "attachment") + " (" + formatSize(a.size) + ")</a>"
      ).join("");
    } else {
      $("msg-attachments").innerHTML = "";
    }

    // Body iframe
    const iframe = $("msg-body");
    const content = m.html || "<pre>" + esc(m.text) + "</pre>";
    iframe.srcdoc = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:sans-serif;font-size:14px;color:#222;padding:12px;margin:0;word-wrap:break-word;}img{max-width:100%;height:auto;}blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #ccc;color:#555;}pre{white-space:pre-wrap;}</style></head><body>' + content + "</body></html>";
  }

  async function reloadWithExternal() {
    if (!currentMessage) return;
    const ext = $("chk-external").checked ? "1" : "0";
    currentMessage = await api("/api/message/" + encodeURIComponent(currentFolder) + "/" + currentMessage.uid + "?external=" + ext);
    renderMessageDetail();
  }

  // -- Compose --
  function openCompose(opts = {}) {
    showView("compose");
    $("toolbar-title").textContent = "Compose";
    composeState = { draftUid: null, draftFolder: null, inReplyTo: null, references: null, ...opts };
    $("compose-to").value = opts.to || "";
    $("compose-cc").value = opts.cc || "";
    $("compose-bcc").value = opts.bcc || "";
    $("compose-subject").value = opts.subject || "";
    quill.root.innerHTML = opts.html || "";
    $("compose-files").value = "";
    $("file-list").innerHTML = "";
  }

  async function openDraftInCompose(uid) {
    const msg = await api("/api/message/" + encodeURIComponent(currentFolder) + "/" + uid);
    openCompose({
      to: msg.to.map((a) => a.address).join(", "),
      cc: msg.cc.map((a) => a.address).join(", "),
      bcc: msg.bcc.map((a) => a.address).join(", "),
      subject: msg.subject,
      html: msg.html || msg.text,
      draftUid: uid,
      draftFolder: currentFolder,
    });
  }

  function replyMessage(all) {
    if (!currentMessage) return;
    const m = currentMessage;
    const from = m.from[0]?.address || "";
    const to = all ? [from, ...m.to.map((a) => a.address)].filter((v, i, arr) => arr.indexOf(v) === i).join(", ") : from;
    const cc = all ? m.cc.map((a) => a.address).join(", ") : "";
    const subj = m.subject.startsWith("Re:") ? m.subject : "Re: " + m.subject;
    const date = m.date ? new Date(m.date).toLocaleString() : "";
    const quote = "<br><br><div>On " + esc(date) + ", " + esc(from) + " wrote:<blockquote>" + (m.html || esc(m.text)) + "</blockquote></div>";

    openCompose({
      to, cc, subject: subj, html: quote,
      inReplyTo: m.messageId,
      references: m.messageId,
    });
  }

  function forwardMessage() {
    if (!currentMessage) return;
    const m = currentMessage;
    const subj = m.subject.startsWith("Fwd:") ? m.subject : "Fwd: " + m.subject;
    const from = m.from.map((a) => a.name ? a.name + " <" + a.address + ">" : a.address).join(", ");
    const to = m.to.map((a) => a.name ? a.name + " <" + a.address + ">" : a.address).join(", ");
    const date = m.date ? new Date(m.date).toLocaleString() : "";

    let fwd = "<br><br><div>---------- Forwarded message ----------<br>";
    fwd += "From: " + esc(from) + "<br>";
    fwd += "Date: " + esc(date) + "<br>";
    fwd += "Subject: " + esc(m.subject) + "<br>";
    fwd += "To: " + esc(to) + "<br><br>";
    fwd += (m.html || esc(m.text));
    fwd += "</div>";

    openCompose({ subject: subj, html: fwd });
  }

  async function trashMessage() {
    if (!currentMessage) return;
    try {
      await api("/api/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: currentFolder, uids: [currentMessage.uid] }),
      });
      goBack();
      loadMessages();
      loadFolders();
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  }

  async function sendMessage() {
    const to = $("compose-to").value.trim();
    if (!to) { alert("Please enter a recipient."); return; }

    const btn = $("btn-send");
    btn.disabled = true;
    btn.textContent = "Sending...";

    try {
      const form = new FormData();
      form.append("to", to);
      form.append("cc", $("compose-cc").value.trim());
      form.append("bcc", $("compose-bcc").value.trim());
      form.append("subject", $("compose-subject").value.trim());
      form.append("html", quill.root.innerHTML);
      form.append("text", quill.getText());
      if (composeState.inReplyTo) form.append("inReplyTo", composeState.inReplyTo);
      if (composeState.references) form.append("references", composeState.references);
      if (composeState.draftUid) form.append("draftUid", composeState.draftUid);
      if (composeState.draftFolder) form.append("draftFolder", composeState.draftFolder);

      const files = $("compose-files").files;
      for (let i = 0; i < files.length; i++) {
        form.append("attachments", files[i]);
      }

      await fetch("/api/send", { method: "POST", body: form }).then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Send failed");
        }
      });

      currentFolder = "INBOX";
      loadFolders();
      loadMessages();
    } catch (err) {
      alert("Send failed: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Send";
    }
  }

  async function saveDraft() {
    const data = {
      to: $("compose-to").value.trim(),
      cc: $("compose-cc").value.trim(),
      bcc: $("compose-bcc").value.trim(),
      subject: $("compose-subject").value.trim(),
      html: quill.root.innerHTML,
      text: quill.getText(),
    };

    try {
      let result;
      if (composeState.draftUid && composeState.draftFolder) {
        result = await api("/api/drafts/" + encodeURIComponent(composeState.draftFolder) + "/" + composeState.draftUid, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      } else {
        result = await api("/api/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      }

      if (result.uid) {
        composeState.draftUid = result.uid;
        composeState.draftFolder = result.folder;
      }

      alert("Draft saved.");
    } catch (err) {
      alert("Save draft failed: " + err.message);
    }
  }

  // -- Templates --
  async function showTemplatesView() {
    showView("templates");
    $("toolbar-title").textContent = "Templates";

    const templates = await api("/api/templates");

    if (!templates.length) {
      $("template-list").innerHTML = '<div class="empty-state">No templates — save one from compose</div>';
      return;
    }

    $("template-list").innerHTML = templates.map((t) =>
      '<div class="tmpl-row" data-id="' + t.id + '">'
        + '<div><span class="tmpl-name">' + esc(t.name) + '</span><span class="tmpl-subject">' + esc(t.subject) + "</span></div>"
        + '<div class="tmpl-actions">'
          + '<button class="use" data-id="' + t.id + '">Use</button>'
          + '<button class="del" data-id="' + t.id + '">Delete</button>'
        + "</div></div>"
    ).join("");

    $("template-list").querySelectorAll(".use").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const tmpl = await api("/api/templates/" + btn.dataset.id);
        openCompose({ to: tmpl.to, cc: tmpl.cc, subject: tmpl.subject, html: tmpl.html });
      });
    });

    $("template-list").querySelectorAll(".del").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (confirm("Delete this template?")) {
          await api("/api/templates/" + btn.dataset.id, { method: "DELETE" });
          showTemplatesView();
        }
      });
    });
  }

  async function saveTemplate() {
    const name = prompt("Template name:");
    if (!name) return;

    try {
      await api("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          subject: $("compose-subject").value.trim(),
          to: $("compose-to").value.trim(),
          cc: $("compose-cc").value.trim(),
          html: quill.root.innerHTML,
        }),
      });
      alert("Template saved.");
    } catch (err) {
      alert("Save failed: " + err.message);
    }
  }

  async function openTemplatePicker() {
    const templates = await api("/api/templates");
    if (!templates.length) {
      alert("No templates saved yet.");
      return;
    }

    $("modal-title").textContent = "Select Template";
    $("modal-body").innerHTML = templates.map((t) =>
      '<div class="modal-item" data-id="' + t.id + '">' + esc(t.name) + " — " + esc(t.subject) + "</div>"
    ).join("");

    $("modal-body").querySelectorAll(".modal-item").forEach((el) => {
      el.addEventListener("click", async () => {
        const tmpl = await api("/api/templates/" + el.dataset.id);
        $("compose-to").value = tmpl.to || $("compose-to").value;
        $("compose-cc").value = tmpl.cc || $("compose-cc").value;
        $("compose-subject").value = tmpl.subject || $("compose-subject").value;
        quill.root.innerHTML = tmpl.html || "";
        closeModal();
      });
    });

    $("modal-overlay").classList.remove("hidden");
  }

  function closeModal() {
    $("modal-overlay").classList.add("hidden");
  }

  function updateFileList() {
    const files = $("compose-files").files;
    if (!files.length) { $("file-list").innerHTML = ""; return; }
    $("file-list").innerHTML = Array.from(files).map((f) =>
      esc(f.name) + " (" + formatSize(f.size) + ")"
    ).join("<br>");
  }

  // -- Navigation --
  function goBack() {
    showView("list");
    $("toolbar-title").textContent = folderDisplayName(currentFolder);
    currentMessage = null;
  }

  // -- Helpers --
  function esc(str) {
    if (!str) return "";
    const d = document.createElement("div");
    d.textContent = String(str);
    return d.innerHTML;
  }

  function formatDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    }
    return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
  }

  function formatSize(bytes) {
    if (!bytes) return "0 B";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  function folderDisplayName(path) {
    if (path === "INBOX") return "Inbox";
    const parts = path.split("/");
    return parts[parts.length - 1];
  }
})();
`;
