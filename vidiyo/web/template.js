export function buildTemplate() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vidiyo</title>
  <style>${css}</style>
</head>
<body>
  <div id="app">
    <!-- Toolbar -->
    <header class="toolbar">
      <div class="toolbar-left">
        <span class="logo">Vidiyo</span>
        <button id="btn-new">New</button>
        <button id="btn-open">Open</button>
        <button id="btn-save">Save</button>
      </div>
      <div class="toolbar-center">
        <span id="project-name" class="project-name">Untitled Project</span>
      </div>
      <div class="toolbar-right">
        <button id="btn-settings">Settings</button>
        <button id="btn-render" class="primary">Render</button>
      </div>
    </header>

    <!-- Main layout -->
    <div class="main-layout">
      <!-- File panel (left) -->
      <aside class="file-panel" id="file-panel">
        <div class="panel-header">
          <span>Media</span>
          <label class="upload-btn">
            + Add
            <input type="file" id="file-input" multiple accept="video/*,audio/*,image/*" hidden>
          </label>
        </div>
        <div class="file-list" id="file-list"></div>
        <div class="drop-zone" id="drop-zone">Drop files here</div>
      </aside>

      <!-- Center column -->
      <div class="center-column">
        <!-- Preview player -->
        <div class="preview-area" id="preview-area">
          <video id="preview-video" controls></video>
          <div class="preview-empty" id="preview-empty">Select a clip to preview</div>
        </div>

        <!-- Properties panel -->
        <div class="properties-panel" id="properties-panel">
          <div class="panel-header">Properties</div>
          <div class="props-content" id="props-content">
            <div class="props-empty">Select a timeline item to edit properties</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Timeline -->
    <div class="timeline-container" id="timeline-container">
      <div class="timeline-toolbar">
        <button id="btn-add-track" title="Add track">+ Track</button>
        <div class="timeline-zoom">
          <button id="btn-zoom-out">-</button>
          <span id="zoom-level">100%</span>
          <button id="btn-zoom-in">+</button>
        </div>
        <span id="timeline-time" class="timeline-time">0:00.000</span>
      </div>
      <div class="timeline-scroll" id="timeline-scroll">
        <div class="timeline-tracks" id="timeline-tracks"></div>
        <canvas id="timeline-canvas"></canvas>
      </div>
    </div>

    <!-- Render progress overlay -->
    <div class="overlay" id="render-overlay" hidden>
      <div class="overlay-content">
        <h3>Rendering</h3>
        <div class="progress-bar">
          <div class="progress-fill" id="render-progress-fill"></div>
        </div>
        <div class="progress-info">
          <span id="render-percent">0%</span>
          <span id="render-speed"></span>
        </div>
        <div id="render-result" hidden>
          <a id="render-download" href="#" class="primary">Download</a>
        </div>
        <button id="render-close" hidden>Close</button>
      </div>
    </div>

    <!-- Modal dialogs -->
    <div class="overlay" id="modal-overlay" hidden>
      <div class="modal" id="modal-content"></div>
    </div>
  </div>

  <script>${js}</script>
</body>
</html>`;
}

const css = `
  * { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --bg: #1a1a2e;
    --bg-surface: #16213e;
    --bg-elevated: #1f2b47;
    --bg-input: #0f1629;
    --border: #2a3a5c;
    --text: #e0e0e0;
    --text-dim: #8892a6;
    --accent: #4a9eff;
    --accent-hover: #6cb3ff;
    --accent-dim: #2a5a8f;
    --danger: #e74c3c;
    --success: #27ae60;
    --warning: #f39c12;
    --track-video: #3498db;
    --track-overlay: #9b59b6;
    --track-audio: #2ecc71;
    --item-bg: rgba(52, 152, 219, 0.3);
    --item-selected: rgba(74, 158, 255, 0.5);
    --timeline-ruler: #2a3a5c;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: "SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", monospace;
  }

  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    height: 100vh;
    overflow: hidden;
    font-size: 13px;
  }

  #app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  button {
    font-family: var(--font);
    font-size: 12px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-elevated);
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
  }
  button:hover { background: var(--border); }
  button.primary { background: var(--accent-dim); border-color: var(--accent); }
  button.primary:hover { background: var(--accent); color: #fff; }
  button.danger { border-color: var(--danger); color: var(--danger); }
  button.danger:hover { background: var(--danger); color: #fff; }

  input, select {
    font-family: var(--font);
    font-size: 12px;
    padding: 3px 6px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-input);
    color: var(--text);
    outline: none;
  }
  input:focus, select:focus { border-color: var(--accent); }

  /* Toolbar */
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
    gap: 12px;
    flex-shrink: 0;
  }
  .toolbar-left, .toolbar-right { display: flex; gap: 6px; align-items: center; }
  .toolbar-center { flex: 1; text-align: center; }
  .logo { font-weight: 700; font-size: 15px; color: var(--accent); margin-right: 12px; }
  .project-name {
    font-size: 13px;
    cursor: pointer;
    padding: 2px 8px;
    border-radius: 3px;
  }
  .project-name:hover { background: var(--bg-elevated); }

  /* Main layout */
  .main-layout {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* File panel */
  .file-panel {
    width: 220px;
    min-width: 180px;
    background: var(--bg-surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 10px;
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    color: var(--text-dim);
    border-bottom: 1px solid var(--border);
  }
  .upload-btn {
    font-size: 11px;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-elevated);
    color: var(--accent);
    cursor: pointer;
  }
  .upload-btn:hover { background: var(--border); }

  .file-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px;
  }
  .file-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: grab;
    user-select: none;
    font-size: 12px;
  }
  .file-item:hover { background: var(--bg-elevated); }
  .file-item.dragging { opacity: 0.5; }
  .file-thumb {
    width: 48px;
    height: 32px;
    border-radius: 3px;
    background: var(--bg-input);
    object-fit: cover;
    flex-shrink: 0;
  }
  .file-info { flex: 1; min-width: 0; }
  .file-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11px;
  }
  .file-meta {
    font-size: 10px;
    color: var(--text-dim);
  }
  .file-delete {
    opacity: 0;
    color: var(--danger);
    cursor: pointer;
    font-size: 14px;
    padding: 2px;
  }
  .file-item:hover .file-delete { opacity: 0.7; }
  .file-delete:hover { opacity: 1 !important; }

  .drop-zone {
    padding: 20px;
    margin: 8px;
    border: 2px dashed var(--border);
    border-radius: 6px;
    text-align: center;
    color: var(--text-dim);
    font-size: 12px;
    flex-shrink: 0;
    transition: all 0.2s;
  }
  .drop-zone.active {
    border-color: var(--accent);
    color: var(--accent);
    background: rgba(74, 158, 255, 0.05);
  }

  /* Center column */
  .center-column {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  /* Preview area */
  .preview-area {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
    position: relative;
    min-height: 200px;
  }
  .preview-area video {
    max-width: 100%;
    max-height: 100%;
    display: none;
  }
  .preview-area video.visible { display: block; }
  .preview-empty {
    color: var(--text-dim);
    font-size: 14px;
  }

  /* Properties panel */
  .properties-panel {
    height: 140px;
    background: var(--bg-surface);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    overflow-y: auto;
  }
  .props-content { padding: 8px 12px; }
  .props-empty { color: var(--text-dim); font-size: 12px; padding: 10px 0; }
  .props-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .props-label {
    font-size: 11px;
    color: var(--text-dim);
    width: 70px;
    flex-shrink: 0;
    text-align: right;
  }
  .props-row input[type="number"],
  .props-row input[type="range"] {
    width: 70px;
  }
  .props-row select { width: 120px; }
  .props-row input[type="range"] {
    appearance: auto;
  }

  /* Timeline */
  .timeline-container {
    height: 220px;
    background: var(--bg-surface);
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }
  .timeline-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .timeline-zoom { display: flex; align-items: center; gap: 4px; margin-left: auto; }
  .timeline-time {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--accent);
    margin-left: 12px;
  }

  .timeline-scroll {
    flex: 1;
    overflow: auto;
    position: relative;
  }
  .timeline-tracks {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    min-width: 100%;
  }
  #timeline-canvas {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: auto;
  }

  /* Overlays */
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .overlay[hidden] { display: none; }
  .overlay-content {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 24px;
    min-width: 350px;
    max-width: 500px;
  }
  .overlay-content h3 { margin-bottom: 16px; font-size: 16px; }

  .progress-bar {
    height: 8px;
    background: var(--bg-input);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
  }
  .progress-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 4px;
    transition: width 0.3s;
    width: 0%;
  }
  .progress-info {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-dim);
    margin-bottom: 12px;
  }

  /* Modal */
  .modal {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    min-width: 350px;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
  }
  .modal h3 { margin-bottom: 12px; }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
  .modal-list {
    max-height: 300px;
    overflow-y: auto;
  }
  .modal-list-item {
    padding: 8px 10px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .modal-list-item:hover { background: var(--bg-elevated); }
  .modal-list-item .name { font-size: 13px; }
  .modal-list-item .date { font-size: 11px; color: var(--text-dim); }

  .form-row {
    margin-bottom: 10px;
  }
  .form-row label {
    display: block;
    font-size: 11px;
    color: var(--text-dim);
    margin-bottom: 3px;
  }
  .form-row input, .form-row select {
    width: 100%;
    padding: 5px 8px;
  }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }
`;

const js = `
(function() {
  "use strict";

  // ==================== STATE ====================
  const state = {
    project: null,
    files: [],
    selectedItemId: null,
    selectedTrackId: null,
    zoom: 100,           // pixels per second
    scrollX: 0,
    playheadTime: 0,
    isDragging: false,
    dragType: null,       // 'move' | 'trim-left' | 'trim-right' | 'playhead'
    dragData: null,
  };

  const SANS_FONT = "-apple-system, BlinkMacSystemFont, sans-serif";
  const MONO_FONT = "SF Mono, Fira Code, monospace";

  // ==================== API ====================
  const api = {
    async uploadFile(file) {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/files/upload", { method: "POST", body: fd });
      return res.json();
    },
    async listFiles() {
      const res = await fetch("/api/files");
      return res.json();
    },
    async deleteFile(id) {
      const res = await fetch("/api/files/" + id, { method: "DELETE" });
      return res.json();
    },
    async createProject(name) {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      return res.json();
    },
    async listProjects() {
      const res = await fetch("/api/projects");
      return res.json();
    },
    async getProject(id) {
      const res = await fetch("/api/projects/" + id);
      return res.json();
    },
    async saveProject(id, data) {
      const res = await fetch("/api/projects/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    async deleteProject(id) {
      const res = await fetch("/api/projects/" + id, { method: "DELETE" });
      return res.json();
    },
    async startRender(projectId) {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      return res.json();
    },
  };

  // ==================== DOM REFS ====================
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const fileList = $("#file-list");
  const fileInput = $("#file-input");
  const dropZone = $("#drop-zone");
  const previewVideo = $("#preview-video");
  const previewEmpty = $("#preview-empty");
  const propsContent = $("#props-content");
  const projectNameEl = $("#project-name");
  const timelineScroll = $("#timeline-scroll");
  const canvas = $("#timeline-canvas");
  const ctx = canvas.getContext("2d");
  const timeDisplay = $("#timeline-time");
  const zoomLabel = $("#zoom-level");

  // ==================== FILE PANEL ====================
  async function refreshFiles() {
    state.files = await api.listFiles();
    renderFileList();
  }

  function renderFileList() {
    fileList.innerHTML = "";
    for (const f of state.files) {
      const el = document.createElement("div");
      el.className = "file-item";
      el.draggable = true;
      el.dataset.fileId = f.id;

      const meta = f.metadata || {};
      const dur = meta.duration ? formatTime(meta.duration) : "";
      const res = meta.video ? meta.video.width + "x" + meta.video.height : "";
      const info = [dur, res].filter(Boolean).join(" | ");

      el.innerHTML =
        '<img class="file-thumb" src="/api/files/' + f.id + '/thumbnail" onerror="this.style.display=&quot;none&quot;">' +
        '<div class="file-info">' +
          '<div class="file-name" title="' + esc(f.name) + '">' + esc(f.name) + '</div>' +
          '<div class="file-meta">' + esc(info) + '</div>' +
        '</div>' +
        '<span class="file-delete" data-id="' + f.id + '" title="Delete">&times;</span>';

      el.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/vidiyo-file", f.id);
        el.classList.add("dragging");
      });
      el.addEventListener("dragend", () => el.classList.remove("dragging"));
      el.addEventListener("click", () => previewFile(f));

      el.querySelector(".file-delete").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (confirm("Delete " + f.name + "?")) {
          await api.deleteFile(f.id);
          refreshFiles();
        }
      });

      fileList.appendChild(el);
    }
  }

  function previewFile(f) {
    const filename = f.filename || f.name;
    previewVideo.src = "/media/" + filename;
    previewVideo.currentTime = 0;
    previewVideo.classList.add("visible");
    previewEmpty.style.display = "none";
  }

  function previewItem(item) {
    const file = state.files.find(f => f.id === item.fileId);
    if (!file) return;
    const filename = file.filename || file.name;
    const src = "/media/" + filename;
    if (previewVideo.src !== location.origin + src) {
      previewVideo.src = src;
    }
    previewVideo.classList.add("visible");
    previewEmpty.style.display = "none";
    previewVideo.addEventListener("loadedmetadata", function seek() {
      previewVideo.currentTime = item.trimIn || 0;
      previewVideo.removeEventListener("loadedmetadata", seek);
    });
    if (previewVideo.readyState >= 1) {
      previewVideo.currentTime = item.trimIn || 0;
    }
  }

  // File input and drag-drop
  fileInput.addEventListener("change", async () => {
    for (const file of fileInput.files) {
      await api.uploadFile(file);
    }
    fileInput.value = "";
    refreshFiles();
  });

  document.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("active");
  });
  document.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
      dropZone.classList.remove("active");
    }
  });
  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropZone.classList.remove("active");

    // If dropping onto timeline, handle separately
    if (e.target === canvas || canvas.contains(e.target)) return;

    if (e.dataTransfer.files.length > 0) {
      for (const file of e.dataTransfer.files) {
        await api.uploadFile(file);
      }
      refreshFiles();
    }
  });

  // ==================== PROJECT MANAGEMENT ====================
  async function newProject() {
    const name = prompt("Project name:", "Untitled Project");
    if (!name) return;
    state.project = await api.createProject(name);
    projectNameEl.textContent = state.project.name;
    state.selectedItemId = null;
    renderTimeline();
    renderProperties();
  }

  async function openProject() {
    const projects = await api.listProjects();
    if (projects.length === 0) {
      alert("No projects found. Create a new one first.");
      return;
    }

    const modal = $("#modal-content");
    modal.innerHTML =
      '<h3>Open Project</h3>' +
      '<div class="modal-list">' +
        projects.map(p =>
          '<div class="modal-list-item" data-id="' + p.id + '">' +
            '<span class="name">' + esc(p.name) + '</span>' +
            '<span class="date">' + new Date(p.updatedAt).toLocaleDateString() + '</span>' +
          '</div>'
        ).join("") +
      '</div>' +
      '<div class="modal-actions">' +
        '<button id="modal-cancel">Cancel</button>' +
      '</div>';

    $("#modal-overlay").hidden = false;

    modal.querySelectorAll(".modal-list-item").forEach(el => {
      el.addEventListener("click", async () => {
        state.project = await api.getProject(el.dataset.id);
        projectNameEl.textContent = state.project.name;
        state.selectedItemId = null;
        renderTimeline();
        renderProperties();
        $("#modal-overlay").hidden = true;
      });
    });
    $("#modal-cancel").addEventListener("click", () => {
      $("#modal-overlay").hidden = true;
    });
  }

  async function saveProject() {
    if (!state.project) {
      alert("No project open. Create or open a project first.");
      return;
    }
    await api.saveProject(state.project.id, state.project);
  }

  function showSettings() {
    if (!state.project) return;
    const s = state.project.settings;
    const modal = $("#modal-content");
    modal.innerHTML =
      '<h3>Project Settings</h3>' +
      '<div class="form-row"><label>Width</label><input type="number" id="s-width" value="' + s.width + '"></div>' +
      '<div class="form-row"><label>Height</label><input type="number" id="s-height" value="' + s.height + '"></div>' +
      '<div class="form-row"><label>FPS</label><input type="number" id="s-fps" value="' + s.fps + '"></div>' +
      '<div class="form-row"><label>Format</label>' +
        '<select id="s-format">' +
          '<option value="mp4"' + (s.format === "mp4" ? " selected" : "") + '>MP4</option>' +
          '<option value="webm"' + (s.format === "webm" ? " selected" : "") + '>WebM</option>' +
          '<option value="mov"' + (s.format === "mov" ? " selected" : "") + '>MOV</option>' +
        '</select>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button id="modal-cancel">Cancel</button>' +
        '<button id="modal-ok" class="primary">Apply</button>' +
      '</div>';

    $("#modal-overlay").hidden = false;
    $("#modal-cancel").addEventListener("click", () => { $("#modal-overlay").hidden = true; });
    $("#modal-ok").addEventListener("click", () => {
      s.width = parseInt($("#s-width").value) || 1920;
      s.height = parseInt($("#s-height").value) || 1080;
      s.fps = parseInt($("#s-fps").value) || 30;
      s.format = $("#s-format").value;
      $("#modal-overlay").hidden = true;
    });
  }

  projectNameEl.addEventListener("click", () => {
    if (!state.project) return;
    const name = prompt("Rename project:", state.project.name);
    if (name) {
      state.project.name = name;
      projectNameEl.textContent = name;
    }
  });

  // ==================== TIMELINE (CANVAS) ====================
  const TRACK_HEIGHT = 40;
  const HEADER_WIDTH = 100;
  const RULER_HEIGHT = 24;
  const TRIM_HANDLE = 6;

  function getTimelineTracks() {
    return state.project ? state.project.timeline.tracks : [];
  }

  function totalDuration() {
    let max = 30; // minimum 30s visible
    for (const track of getTimelineTracks()) {
      for (const item of track.items || []) {
        const end = (item.startTime || 0) + ((item.trimOut || item.duration || 0) - (item.trimIn || 0));
        if (end > max) max = end;
      }
    }
    return max + 10; // extra padding
  }

  function resizeCanvas() {
    const rect = timelineScroll.getBoundingClientRect();
    canvas.width = Math.max(rect.width, HEADER_WIDTH + totalDuration() * (state.zoom / 100) * 10);
    canvas.height = Math.max(rect.height, RULER_HEIGHT + getTimelineTracks().length * TRACK_HEIGHT + 20);
    canvas.style.width = canvas.width + "px";
    canvas.style.height = canvas.height + "px";
  }

  function renderTimeline() {
    resizeCanvas();
    const tracks = getTimelineTracks();
    const pxPerSec = state.zoom / 100 * 10;
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, W, H);

    // Ruler
    ctx.fillStyle = "#1a2236";
    ctx.fillRect(0, 0, W, RULER_HEIGHT);

    ctx.fillStyle = "#4b5563";
    ctx.strokeStyle = "#2a3a5c";
    ctx.font = "10px " + MONO_FONT;
    ctx.textAlign = "center";

    // Draw time markers
    const step = getTimeStep(pxPerSec);
    const startT = Math.floor(state.scrollX / pxPerSec / step) * step;
    for (let t = startT; t < totalDuration(); t += step) {
      const x = HEADER_WIDTH + t * pxPerSec;
      if (x < HEADER_WIDTH) continue;

      ctx.beginPath();
      ctx.moveTo(x, RULER_HEIGHT - 6);
      ctx.lineTo(x, RULER_HEIGHT);
      ctx.stroke();

      ctx.fillText(formatTimeShort(t), x, RULER_HEIGHT - 9);

      // Grid line
      ctx.strokeStyle = "rgba(42, 58, 92, 0.3)";
      ctx.beginPath();
      ctx.moveTo(x, RULER_HEIGHT);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.strokeStyle = "#2a3a5c";
    }

    // Track headers and backgrounds
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const y = RULER_HEIGHT + i * TRACK_HEIGHT;

      // Track bg
      ctx.fillStyle = i % 2 === 0 ? "#141c2e" : "#161e32";
      ctx.fillRect(HEADER_WIDTH, y, W - HEADER_WIDTH, TRACK_HEIGHT);

      // Header bg
      ctx.fillStyle = "#1a2236";
      ctx.fillRect(0, y, HEADER_WIDTH, TRACK_HEIGHT);
      ctx.strokeStyle = var_border;
      ctx.strokeRect(0, y, HEADER_WIDTH, TRACK_HEIGHT);

      // Track label
      ctx.fillStyle = getTrackColor(track.type);
      ctx.font = "bold 11px " + SANS_FONT;
      ctx.textAlign = "left";
      ctx.fillText(track.label || track.type, 8, y + 16);

      // Track type indicator
      ctx.font = "9px " + SANS_FONT;
      ctx.fillStyle = "#6b7280";
      ctx.fillText(track.type, 8, y + 30);

      // Draw items
      for (const item of track.items || []) {
        drawItem(item, track, y, pxPerSec);
      }
    }

    // Playhead
    const phX = HEADER_WIDTH + state.playheadTime * pxPerSec;
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(phX, 0);
    ctx.lineTo(phX, H);
    ctx.stroke();
    ctx.lineWidth = 1;

    // Playhead triangle
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath();
    ctx.moveTo(phX - 6, 0);
    ctx.lineTo(phX + 6, 0);
    ctx.lineTo(phX, 8);
    ctx.closePath();
    ctx.fill();
  }

  const var_border = "#2a3a5c";

  function drawItem(item, track, trackY, pxPerSec) {
    const clipDuration = (item.trimOut || item.duration || 10) - (item.trimIn || 0);
    const x = HEADER_WIDTH + (item.startTime || 0) * pxPerSec;
    const w = clipDuration * pxPerSec;
    const y = trackY + 4;
    const h = TRACK_HEIGHT - 8;

    const selected = item.id === state.selectedItemId;
    const color = getTrackColor(track.type);

    // Item background
    ctx.fillStyle = selected ? hexToRgba(color, 0.5) : hexToRgba(color, 0.25);
    ctx.strokeStyle = selected ? color : hexToRgba(color, 0.6);
    ctx.lineWidth = selected ? 2 : 1;

    roundRect(ctx, x, y, w, h, 3);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1;

    // Clip name
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 2, y, w - 4, h);
    ctx.clip();
    ctx.fillStyle = selected ? "#fff" : "#d1d5db";
    ctx.font = "11px " + SANS_FONT;
    ctx.textAlign = "left";

    // Find file name
    const file = state.files.find(f => f.id === item.fileId);
    const label = file ? file.name : "Unknown";
    ctx.fillText(label, x + 6, y + h / 2 + 4);
    ctx.restore();

    // Trim handles
    if (selected) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, TRIM_HANDLE, h);
      ctx.fillRect(x + w - TRIM_HANDLE, y, TRIM_HANDLE, h);
    }

    // Fade indicators
    if (item.fadeIn > 0) {
      const fadeW = item.fadeIn * pxPerSec;
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.lineTo(x + fadeW, y);
      ctx.stroke();
    }
    if (item.fadeOut > 0) {
      const fadeW = item.fadeOut * pxPerSec;
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.beginPath();
      ctx.moveTo(x + w - fadeW, y);
      ctx.lineTo(x + w, y + h);
      ctx.stroke();
    }
  }

  function getTrackColor(type) {
    switch (type) {
      case "video": return "#3498db";
      case "overlay": return "#9b59b6";
      case "audio": return "#2ecc71";
      default: return "#6b7280";
    }
  }

  function getTimeStep(pxPerSec) {
    if (pxPerSec >= 50) return 1;
    if (pxPerSec >= 20) return 2;
    if (pxPerSec >= 10) return 5;
    if (pxPerSec >= 5) return 10;
    return 30;
  }

  // ==================== TIMELINE INTERACTION ====================
  canvas.addEventListener("mousedown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pxPerSec = state.zoom / 100 * 10;

    // Click on ruler = move playhead
    if (my < RULER_HEIGHT) {
      state.dragType = "playhead";
      state.playheadTime = Math.max(0, (mx - HEADER_WIDTH) / pxPerSec);
      timeDisplay.textContent = formatTime(state.playheadTime);
      renderTimeline();
      state.isDragging = true;
      return;
    }

    // Find clicked item
    const tracks = getTimelineTracks();
    const trackIdx = Math.floor((my - RULER_HEIGHT) / TRACK_HEIGHT);
    if (trackIdx < 0 || trackIdx >= tracks.length) {
      state.selectedItemId = null;
      state.selectedTrackId = null;
      renderTimeline();
      renderProperties();
      return;
    }

    const track = tracks[trackIdx];
    state.selectedTrackId = track.id;
    let hitItem = null;

    for (const item of track.items || []) {
      const clipDur = (item.trimOut || item.duration || 10) - (item.trimIn || 0);
      const ix = HEADER_WIDTH + (item.startTime || 0) * pxPerSec;
      const iw = clipDur * pxPerSec;
      const iy = RULER_HEIGHT + trackIdx * TRACK_HEIGHT + 4;
      const ih = TRACK_HEIGHT - 8;

      if (mx >= ix && mx <= ix + iw && my >= iy && my <= iy + ih) {
        hitItem = item;

        // Check trim handles
        if (mx <= ix + TRIM_HANDLE) {
          state.dragType = "trim-left";
        } else if (mx >= ix + iw - TRIM_HANDLE) {
          state.dragType = "trim-right";
        } else {
          state.dragType = "move";
        }

        state.dragData = {
          itemId: item.id,
          trackId: track.id,
          startX: mx,
          origStartTime: item.startTime || 0,
          origTrimIn: item.trimIn || 0,
          origTrimOut: item.trimOut || item.duration || 10,
        };
        break;
      }
    }

    if (hitItem) {
      state.selectedItemId = hitItem.id;
      state.isDragging = true;
      previewItem(hitItem);
    } else {
      state.selectedItemId = null;
      state.dragType = null;
    }

    renderTimeline();
    renderProperties();
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!state.isDragging) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const pxPerSec = state.zoom / 100 * 10;

    if (state.dragType === "playhead") {
      state.playheadTime = Math.max(0, (mx - HEADER_WIDTH) / pxPerSec);
      timeDisplay.textContent = formatTime(state.playheadTime);
      renderTimeline();
      return;
    }

    if (!state.dragData) return;
    const item = findItem(state.dragData.itemId);
    if (!item) return;

    const dx = mx - state.dragData.startX;
    const dt = dx / pxPerSec;

    if (state.dragType === "move") {
      item.startTime = Math.max(0, state.dragData.origStartTime + dt);
    } else if (state.dragType === "trim-left") {
      const newTrimIn = Math.max(0, state.dragData.origTrimIn + dt);
      if (newTrimIn < (item.trimOut || item.duration || 10)) {
        const trimDelta = newTrimIn - (item.trimIn || 0);
        item.trimIn = newTrimIn;
        item.startTime = Math.max(0, (item.startTime || 0) + trimDelta);
      }
    } else if (state.dragType === "trim-right") {
      const file = state.files.find(f => f.id === item.fileId);
      const maxDur = file?.metadata?.duration || 999;
      item.trimOut = Math.min(maxDur, Math.max(item.trimIn + 0.1, state.dragData.origTrimOut + dt));
    }

    renderTimeline();
  });

  window.addEventListener("mouseup", () => {
    state.isDragging = false;
    state.dragType = null;
    state.dragData = null;
  });

  // Drop files onto timeline
  canvas.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });

  canvas.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("active");

    const fileId = e.dataTransfer.getData("application/vidiyo-file");
    if (!fileId || !state.project) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pxPerSec = state.zoom / 100 * 10;
    const dropTime = Math.max(0, (mx - HEADER_WIDTH) / pxPerSec);

    const tracks = getTimelineTracks();
    const trackIdx = Math.floor((my - RULER_HEIGHT) / TRACK_HEIGHT);

    if (trackIdx < 0 || trackIdx >= tracks.length) return;

    const file = state.files.find(f => f.id === fileId);
    if (!file) return;

    const duration = file.metadata?.duration || 10;
    const track = tracks[trackIdx];

    const newItem = {
      id: crypto.randomUUID(),
      fileId: fileId,
      startTime: snapTime(dropTime),
      duration: duration,
      trimIn: 0,
      trimOut: duration,
      position: { x: 0, y: 0 },
      size: { w: state.project.settings.width, h: state.project.settings.height },
      opacity: 1.0,
      blendMode: "normal",
      volume: 1.0,
      fadeIn: 0,
      fadeOut: 0,
    };

    track.items.push(newItem);
    state.selectedItemId = newItem.id;
    state.selectedTrackId = track.id;
    renderTimeline();
    renderProperties();
  });

  // Zoom
  $("#btn-zoom-in").addEventListener("click", () => {
    state.zoom = Math.min(500, state.zoom + 25);
    zoomLabel.textContent = state.zoom + "%";
    renderTimeline();
  });
  $("#btn-zoom-out").addEventListener("click", () => {
    state.zoom = Math.max(25, state.zoom - 25);
    zoomLabel.textContent = state.zoom + "%";
    renderTimeline();
  });

  // Add track
  $("#btn-add-track").addEventListener("click", () => {
    if (!state.project) return;
    const modal = $("#modal-content");
    modal.innerHTML =
      '<h3>Add Track</h3>' +
      '<div class="form-row"><label>Track Type</label>' +
        '<select id="track-type">' +
          '<option value="video">Video</option>' +
          '<option value="overlay">Overlay</option>' +
          '<option value="audio">Audio</option>' +
        '</select>' +
      '</div>' +
      '<div class="form-row"><label>Label</label>' +
        '<input type="text" id="track-label" placeholder="Track name">' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button id="modal-cancel">Cancel</button>' +
        '<button id="modal-ok" class="primary">Add</button>' +
      '</div>';
    $("#modal-overlay").hidden = false;

    $("#modal-cancel").addEventListener("click", () => { $("#modal-overlay").hidden = true; });
    $("#modal-ok").addEventListener("click", () => {
      const type = $("#track-type").value;
      const label = $("#track-label").value || type.charAt(0).toUpperCase() + type.slice(1);
      state.project.timeline.tracks.push({
        id: "track-" + crypto.randomUUID().slice(0, 8),
        type: type,
        label: label,
        items: [],
      });
      $("#modal-overlay").hidden = true;
      renderTimeline();
    });
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;

    if (e.key === "Delete" || e.key === "Backspace") {
      deleteSelectedItem();
    }
    if (e.key === " ") {
      e.preventDefault();
      togglePlayback();
    }
    if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveProject();
    }
  });

  function deleteSelectedItem() {
    if (!state.selectedItemId || !state.project) return;
    for (const track of state.project.timeline.tracks) {
      const idx = track.items.findIndex(i => i.id === state.selectedItemId);
      if (idx >= 0) {
        track.items.splice(idx, 1);
        state.selectedItemId = null;
        renderTimeline();
        renderProperties();
        return;
      }
    }
  }

  let playbackInterval = null;
  function togglePlayback() {
    if (playbackInterval) {
      clearInterval(playbackInterval);
      playbackInterval = null;
    } else {
      playbackInterval = setInterval(() => {
        state.playheadTime += 1 / 30;
        timeDisplay.textContent = formatTime(state.playheadTime);
        renderTimeline();
      }, 1000 / 30);
    }
  }

  // ==================== PROPERTIES PANEL ====================
  function renderProperties() {
    if (!state.selectedItemId) {
      propsContent.innerHTML = '<div class="props-empty">Select a timeline item to edit properties</div>';
      return;
    }

    const item = findItem(state.selectedItemId);
    if (!item) {
      propsContent.innerHTML = '<div class="props-empty">Item not found</div>';
      return;
    }

    const file = state.files.find(f => f.id === item.fileId);
    const isVideo = file && getFileType(file) !== "audio";
    const isAudio = file && (getFileType(file) === "audio" || getFileType(file) === "video");

    let html = '';

    if (isVideo) {
      html +=
        '<div class="props-row">' +
          '<span class="props-label">Position X</span>' +
          '<input type="number" id="prop-x" value="' + (item.position?.x || 0) + '" step="1">' +
          '<span class="props-label">Y</span>' +
          '<input type="number" id="prop-y" value="' + (item.position?.y || 0) + '" step="1">' +
        '</div>' +
        '<div class="props-row">' +
          '<span class="props-label">Size W</span>' +
          '<input type="number" id="prop-w" value="' + (item.size?.w || 1920) + '" step="1">' +
          '<span class="props-label">H</span>' +
          '<input type="number" id="prop-h" value="' + (item.size?.h || 1080) + '" step="1">' +
        '</div>' +
        '<div class="props-row">' +
          '<span class="props-label">Opacity</span>' +
          '<input type="range" id="prop-opacity" min="0" max="1" step="0.05" value="' + (item.opacity ?? 1) + '">' +
          '<span id="prop-opacity-val">' + ((item.opacity ?? 1) * 100).toFixed(0) + '%</span>' +
        '</div>' +
        '<div class="props-row">' +
          '<span class="props-label">Blend</span>' +
          '<select id="prop-blend">' +
            blendOptions(item.blendMode || "normal") +
          '</select>' +
        '</div>';
    }

    if (isAudio) {
      html +=
        '<div class="props-row">' +
          '<span class="props-label">Volume</span>' +
          '<input type="range" id="prop-volume" min="0" max="2" step="0.05" value="' + (item.volume ?? 1) + '">' +
          '<span id="prop-volume-val">' + ((item.volume ?? 1) * 100).toFixed(0) + '%</span>' +
        '</div>' +
        '<div class="props-row">' +
          '<span class="props-label">Fade In</span>' +
          '<input type="number" id="prop-fadein" value="' + (item.fadeIn || 0) + '" min="0" step="0.1" style="width:50px">s' +
          '<span class="props-label">Fade Out</span>' +
          '<input type="number" id="prop-fadeout" value="' + (item.fadeOut || 0) + '" min="0" step="0.1" style="width:50px">s' +
        '</div>';
    }

    html +=
      '<div class="props-row" style="margin-top:8px">' +
        '<button class="danger" id="prop-delete">Delete Item</button>' +
      '</div>';

    propsContent.innerHTML = html;

    // Bind property changes
    const bind = (id, key, parse) => {
      const el = propsContent.querySelector("#" + id);
      if (!el) return;
      el.addEventListener("input", () => {
        const val = parse ? parse(el.value) : el.value;
        setItemProp(item, key, val);
        renderTimeline();
      });
    };

    bind("prop-x", "position.x", Number);
    bind("prop-y", "position.y", Number);
    bind("prop-w", "size.w", Number);
    bind("prop-h", "size.h", Number);
    bind("prop-blend", "blendMode");
    bind("prop-fadein", "fadeIn", Number);
    bind("prop-fadeout", "fadeOut", Number);

    const opacityEl = propsContent.querySelector("#prop-opacity");
    if (opacityEl) {
      opacityEl.addEventListener("input", () => {
        item.opacity = parseFloat(opacityEl.value);
        propsContent.querySelector("#prop-opacity-val").textContent = (item.opacity * 100).toFixed(0) + "%";
        renderTimeline();
      });
    }
    const volumeEl = propsContent.querySelector("#prop-volume");
    if (volumeEl) {
      volumeEl.addEventListener("input", () => {
        item.volume = parseFloat(volumeEl.value);
        propsContent.querySelector("#prop-volume-val").textContent = (item.volume * 100).toFixed(0) + "%";
      });
    }

    propsContent.querySelector("#prop-delete")?.addEventListener("click", deleteSelectedItem);
  }

  function setItemProp(item, key, val) {
    const parts = key.split(".");
    if (parts.length === 2) {
      item[parts[0]] = item[parts[0]] || {};
      item[parts[0]][parts[1]] = val;
    } else {
      item[key] = val;
    }
  }

  function blendOptions(current) {
    const modes = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "difference", "exclusion"];
    return modes.map(m =>
      '<option value="' + m + '"' + (m === current ? " selected" : "") + '>' + m + '</option>'
    ).join("");
  }

  // ==================== RENDER ====================
  async function startRender() {
    if (!state.project) {
      alert("No project open.");
      return;
    }

    // Save first
    await api.saveProject(state.project.id, state.project);

    const overlay = $("#render-overlay");
    const fill = $("#render-progress-fill");
    const percent = $("#render-percent");
    const speed = $("#render-speed");
    const result = $("#render-result");
    const closeBtn = $("#render-close");
    const download = $("#render-download");

    overlay.hidden = false;
    fill.style.width = "0%";
    percent.textContent = "0%";
    speed.textContent = "";
    result.hidden = true;
    closeBtn.hidden = true;

    try {
      const { jobId, error } = await api.startRender(state.project.id);
      if (error) {
        percent.textContent = "Error: " + error;
        closeBtn.hidden = false;
        return;
      }

      // Connect SSE
      const es = new EventSource("/api/render/" + jobId + "/progress");
      es.addEventListener("message", (e) => {
        const data = JSON.parse(e.data);
        if (data.type === "progress") {
          const p = data.progress || 0;
          fill.style.width = p.toFixed(1) + "%";
          percent.textContent = p.toFixed(1) + "%";
          if (data.speed) speed.textContent = data.speed.toFixed(1) + "x";
        } else if (data.type === "complete") {
          fill.style.width = "100%";
          percent.textContent = "100%";
          speed.textContent = "Done!";
          download.href = "/output/" + data.outputFile;
          download.download = data.outputFile;
          result.hidden = false;
          closeBtn.hidden = false;
          es.close();
        } else if (data.type === "error") {
          percent.textContent = "Error";
          speed.textContent = data.error;
          closeBtn.hidden = false;
          es.close();
        }
      });
      es.addEventListener("error", () => {
        es.close();
        // Poll for final status
        setTimeout(async () => {
          const res = await fetch("/api/render/" + jobId);
          const job = await res.json();
          if (job.status === "complete") {
            fill.style.width = "100%";
            percent.textContent = "100%";
            download.href = "/output/" + job.outputFile;
            result.hidden = false;
          } else if (job.status === "error") {
            percent.textContent = "Error";
            speed.textContent = job.error || "Unknown error";
          }
          closeBtn.hidden = false;
        }, 1000);
      });
    } catch (err) {
      percent.textContent = "Error";
      speed.textContent = err.message;
      closeBtn.hidden = false;
    }
  }

  $("#render-close").addEventListener("click", () => {
    $("#render-overlay").hidden = true;
  });

  // ==================== TOOLBAR EVENTS ====================
  $("#btn-new").addEventListener("click", newProject);
  $("#btn-open").addEventListener("click", openProject);
  $("#btn-save").addEventListener("click", saveProject);
  $("#btn-settings").addEventListener("click", showSettings);
  $("#btn-render").addEventListener("click", startRender);
  $("#modal-overlay").addEventListener("click", (e) => {
    if (e.target === $("#modal-overlay")) {
      $("#modal-overlay").hidden = true;
    }
  });

  // ==================== HELPERS ====================
  function findItem(itemId) {
    if (!state.project) return null;
    for (const track of state.project.timeline.tracks) {
      const item = (track.items || []).find(i => i.id === itemId);
      if (item) return item;
    }
    return null;
  }

  function snapTime(t) {
    return Math.round(t * 10) / 10; // snap to 0.1s
  }

  function formatTime(s) {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return mins + ":" + secs.toFixed(3).padStart(6, "0");
  }

  function formatTimeShort(s) {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return mins + ":" + String(secs).padStart(2, "0");
  }

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function getFileType(f) {
    const ext = (f.name || "").split(".").pop().toLowerCase();
    const video = ["mp4", "webm", "mov", "avi", "mkv", "m4v", "ogv"];
    const audio = ["mp3", "wav", "ogg", "aac", "flac", "m4a", "wma"];
    const image = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];
    if (video.includes(ext)) return "video";
    if (audio.includes(ext)) return "audio";
    if (image.includes(ext)) return "image";
    return "other";
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // ==================== INIT ====================
  async function init() {
    await refreshFiles();

    // Load most recent project, or auto-create one
    const projects = await api.listProjects();
    if (projects.length > 0) {
      state.project = await api.getProject(projects[0].id);
    } else {
      state.project = await api.createProject("Untitled Project");
    }
    projectNameEl.textContent = state.project.name;

    renderTimeline();

    // Resize observer
    const ro = new ResizeObserver(() => renderTimeline());
    ro.observe(timelineScroll);
  }

  init();
})();
`;
