const Tasks = {
  tasks: [],
  editingId: null,

  async load(filters = {}) {
    const res = await API.getTasks(filters);
    if (res.ok) {
      this.tasks = res.tasks;
      this.render();
    }
  },

  render() {
    const list = document.getElementById("task-list");
    if (this.tasks.length === 0) {
      list.innerHTML = '<div style="padding:20px;color:var(--fg-dim);text-align:center">No tasks found</div>';
      return;
    }

    list.innerHTML = this.tasks.map((t) => {
      const statusCls = `status-${t.status}`;
      const prioCls = `priority-${t.priority}`;

      let meta = "";
      if (t.assignee) meta += `<span>@${this.esc(t.assignee)}</span>`;
      if (t.group) meta += `<span>[${this.esc(t.group)}]</span>`;
      if (t.priority) meta += `<span>${t.priority}</span>`;
      if (t.startDate || t.dueDate) meta += `<span>${t.startDate || "?"} → ${t.dueDate || "?"}</span>`;
      if (t.tags.length) meta += t.tags.map((tag) => `<span class="task-tag">#${this.esc(tag)}</span>`).join("");
      if (t.dependencies.length) meta += t.dependencies.map((d) => `<span class="task-dep">⤷ ${this.esc(d.slice(-8))}</span>`).join("");

      return `
        <div class="task-card ${prioCls}" data-id="${t.id}">
          <span class="task-status-badge ${statusCls}">${t.status}</span>
          <div class="task-info">
            <div class="task-title">${this.esc(t.title)}</div>
            ${meta ? `<div class="task-meta">${meta}</div>` : ""}
          </div>
          <div class="task-actions">
            <button class="btn btn-sm" onclick="Tasks.edit('${t.id}')" title="Edit">edit</button>
            <button class="btn btn-sm" onclick="Tasks.cycleStatus('${t.id}')" title="Advance status">→</button>
            <button class="btn btn-sm" onclick="Tasks.sendNotify('${t.id}')" title="Notify chat">📢</button>
            <button class="btn btn-sm btn-danger" onclick="Tasks.remove('${t.id}')" title="Delete">×</button>
          </div>
        </div>`;
    }).join("");
  },

  showForm(task) {
    this.editingId = task ? task.id : null;
    document.getElementById("form-title").textContent = task ? "Edit Task" : "New Task";
    document.getElementById("form-task-id").value = task ? task.id : "";
    document.getElementById("form-name").value = task ? task.title : "";
    document.getElementById("form-desc").value = task ? task.description : "";
    document.getElementById("form-status").value = task ? task.status : "todo";
    document.getElementById("form-priority").value = task ? task.priority : "medium";
    document.getElementById("form-assignee").value = task ? task.assignee : "";
    document.getElementById("form-group").value = task ? task.group : "";
    document.getElementById("form-start").value = task ? task.startDate : "";
    document.getElementById("form-due").value = task ? task.dueDate : "";
    document.getElementById("form-tags").value = task ? task.tags.join(", ") : "";
    document.getElementById("form-deps").value = task ? task.dependencies.join(", ") : "";
    document.getElementById("task-form").classList.remove("hidden");
    document.getElementById("form-name").focus();
  },

  hideForm() {
    document.getElementById("task-form").classList.add("hidden");
    this.editingId = null;
  },

  async save() {
    const payload = {
      title: document.getElementById("form-name").value,
      description: document.getElementById("form-desc").value,
      status: document.getElementById("form-status").value,
      priority: document.getElementById("form-priority").value,
      assignee: document.getElementById("form-assignee").value,
      group: document.getElementById("form-group").value,
      startDate: document.getElementById("form-start").value,
      dueDate: document.getElementById("form-due").value,
      tags: document.getElementById("form-tags").value.split(",").map((s) => s.trim()).filter(Boolean),
      dependencies: document.getElementById("form-deps").value.split(",").map((s) => s.trim()).filter(Boolean),
    };

    let res;
    if (this.editingId) {
      res = await API.updateTask(this.editingId, payload);
    } else {
      res = await API.createTask(payload);
    }

    if (res.ok) {
      this.hideForm();
      this.load(App.currentFilters());
    } else {
      alert((res.errors || ["Save failed"]).join("\n"));
    }
  },

  edit(id) {
    const task = this.tasks.find((t) => t.id === id);
    if (task) this.showForm(task);
  },

  async cycleStatus(id) {
    const order = ["todo", "in-progress", "blocked", "done", "cancelled"];
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    const idx = order.indexOf(task.status);
    const next = order[(idx + 1) % order.length];
    const res = await API.updateTask(id, { status: next });
    if (res.ok) this.load(App.currentFilters());
  },

  async remove(id) {
    if (!confirm("Delete this task?")) return;
    const res = await API.deleteTask(id);
    if (res.ok) this.load(App.currentFilters());
  },

  async sendNotify(id) {
    const res = await API.notifyTask(id);
    if (!res.ok) alert("Notification failed: " + (res.errors || ["Unknown error"]).join(", "));
  },

  async exportTasks() {
    const res = await API.getTasks({ limit: 500 });
    if (!res.ok || res.tasks.length === 0) {
      alert("No tasks to export");
      return;
    }
    const blob = new Blob([JSON.stringify({ tasks: res.tasks }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tasks-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async clearAll() {
    if (!confirm("Delete ALL tasks? This cannot be undone.")) return;
    const res = await API.clearTasks();
    if (res.ok) this.load(App.currentFilters());
  },

  applyWsEvent(type, payload) {
    if (type === "task:created" || type === "task:updated" || type === "task:deleted" || type === "tasks:imported" || type === "tasks:cleared") {
      this.load(App.currentFilters());
    }
  },

  esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  },
};
