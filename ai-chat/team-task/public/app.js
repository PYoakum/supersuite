const App = {
  init() {
    // Tab switching
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => this.switchTab(btn.dataset.tab));
    });

    // Task form buttons
    document.getElementById("btn-new-task").addEventListener("click", () => Tasks.showForm(null));
    document.getElementById("btn-cancel-task").addEventListener("click", () => Tasks.hideForm());
    document.getElementById("btn-save-task").addEventListener("click", () => Tasks.save());
    document.getElementById("btn-filter").addEventListener("click", () => Tasks.load(this.currentFilters()));
    document.getElementById("btn-export").addEventListener("click", () => Tasks.exportTasks());
    document.getElementById("btn-clear").addEventListener("click", () => Tasks.clearAll());

    // Enter key on search
    document.getElementById("filter-search").addEventListener("keydown", (e) => {
      if (e.key === "Enter") Tasks.load(this.currentFilters());
    });

    // Gantt filters
    document.getElementById("gantt-filter-group").addEventListener("change", () => this.refreshViz());
    document.getElementById("gantt-filter-status").addEventListener("change", () => this.refreshViz());

    // Import
    Import.init();

    // WebSocket
    WS.connect();
    WS.on("connection:status", (p) => {
      const el = document.getElementById("conn-status");
      el.textContent = p.status;
      el.className = "conn " + p.status;
    });

    WS.on("task:created", (p) => Tasks.applyWsEvent("task:created", p));
    WS.on("task:updated", (p) => Tasks.applyWsEvent("task:updated", p));
    WS.on("task:deleted", (p) => Tasks.applyWsEvent("task:deleted", p));
    WS.on("tasks:imported", (p) => Tasks.applyWsEvent("tasks:imported", p));
    WS.on("tasks:cleared", (p) => Tasks.applyWsEvent("tasks:cleared", p));

    // Initial load
    Tasks.load();
    this.refreshStats();
    setInterval(() => this.refreshStats(), 10000);
  },

  switchTab(name) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === name + "-tab"));

    if (name === "visualize") this.refreshViz();
  },

  refreshViz() {
    const filters = {};
    const group = document.getElementById("gantt-filter-group").value;
    const status = document.getElementById("gantt-filter-status").value;
    if (group) filters.group = group;
    if (status) filters.status = status;
    Gantt.render(filters);
    CompletionChart.render();
  },

  async refreshStats() {
    const res = await API.getStats();
    if (res.ok) {
      document.getElementById("task-count").textContent = `${res.total} task${res.total === 1 ? "" : "s"}`;
    }
  },

  currentFilters() {
    return {
      status: document.getElementById("filter-status").value || undefined,
      priority: document.getElementById("filter-priority").value || undefined,
      q: document.getElementById("filter-search").value || undefined,
    };
  },
};

// Task detail panel
function showTaskDetail(taskId) {
  fetch(`/api/tasks/${taskId}`)
    .then(r => r.json())
    .then(data => {
      if (!data.ok || !data.task) return;
      const t = data.task;

      document.getElementById("detail-title").textContent = t.title;

      // Meta badges
      const meta = document.getElementById("detail-meta");
      meta.innerHTML = `
        <span class="task-status-badge status-${t.status}">${t.status}</span>
        <span class="task-status-badge priority-${t.priority}">${t.priority}</span>
        ${t.assignee ? `<span class="detail-field">Assignee: ${t.assignee}</span>` : ""}
        ${t.group ? `<span class="detail-field">Group: ${t.group}</span>` : ""}
        ${t.tags?.length ? `<span class="detail-field">Tags: ${t.tags.join(", ")}</span>` : ""}
        ${t.dependencies?.length ? `<span class="detail-field">Depends on: ${t.dependencies.join(", ")}</span>` : ""}
      `;

      // Description
      document.getElementById("detail-description").textContent = t.description || "No description.";

      // Token usage
      const tokensEl = document.getElementById("detail-tokens");
      const used = t.tokensUsed || 0;
      const budget = t.tokenBudget || 0;
      if (budget > 0) {
        const pct = Math.min(100, Math.round((used / budget) * 100));
        const color = pct > 90 ? "var(--red)" : pct > 70 ? "var(--orange)" : "var(--green)";
        tokensEl.innerHTML = `
          <div class="token-bar">
            <div class="token-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
          <span class="token-label">${used.toLocaleString()} / ${budget.toLocaleString()} tokens (${pct}%)</span>
        `;
      } else if (used > 0) {
        tokensEl.innerHTML = `<span class="token-label">${used.toLocaleString()} tokens used (no budget set)</span>`;
      } else {
        tokensEl.innerHTML = `<span class="token-label dim">No token data</span>`;
      }

      // Status history timeline
      const historyEl = document.getElementById("detail-history");
      const history = t.statusHistory || [];
      if (history.length > 0) {
        historyEl.innerHTML = history.map(h => {
          const time = new Date(h.timestamp).toLocaleString();
          return `<div class="timeline-entry">
            <span class="timeline-dot status-bg-${h.status}"></span>
            <span class="timeline-status">${h.status}</span>
            <span class="timeline-time">${time}</span>
            ${h.changedBy ? `<span class="timeline-by">by ${h.changedBy}</span>` : ""}
          </div>`;
        }).join("");
      } else {
        historyEl.innerHTML = `<span class="dim">No status history</span>`;
      }

      // Timestamps
      const tsEl = document.getElementById("detail-timestamps");
      const fmt = (s) => s ? new Date(s).toLocaleString() : "\u2014";
      tsEl.innerHTML = `
        <div class="ts-row"><span class="ts-label">Created:</span> ${fmt(t.createdAt)}</div>
        <div class="ts-row"><span class="ts-label">Updated:</span> ${fmt(t.updatedAt)}</div>
        <div class="ts-row"><span class="ts-label">Start Date:</span> ${t.startDate || "\u2014"}</div>
        <div class="ts-row"><span class="ts-label">Due Date:</span> ${t.dueDate || "\u2014"}</div>
        <div class="ts-row"><span class="ts-label">Completed:</span> ${fmt(t.completedAt)}</div>
      `;

      // Show panel
      document.getElementById("task-detail").classList.remove("task-detail-hidden");
    });
}

function hideTaskDetail() {
  document.getElementById("task-detail").classList.add("task-detail-hidden");
}

document.addEventListener("DOMContentLoaded", () => {
  App.init();

  // Task detail: click on task card to show detail
  document.addEventListener("click", (e) => {
    const card = e.target.closest(".task-card");
    if (card && !e.target.closest(".task-actions")) {
      const taskId = card.dataset.id;
      if (taskId) showTaskDetail(taskId);
    }
  });

  // Close detail panel
  document.getElementById("detail-close")?.addEventListener("click", hideTaskDetail);
});
