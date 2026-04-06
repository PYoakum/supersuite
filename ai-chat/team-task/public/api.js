const API = {
  base: window.location.origin,

  async request(method, path, body) {
    const opts = { method, headers: {} };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(this.base + path, opts);
    return res.json();
  },

  getTasks(params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") qs.set(k, v);
    }
    const q = qs.toString();
    return this.request("GET", "/api/tasks" + (q ? "?" + q : ""));
  },

  getTask(id) {
    return this.request("GET", `/api/tasks/${id}`);
  },

  createTask(payload) {
    return this.request("POST", "/api/tasks", payload);
  },

  updateTask(id, payload) {
    return this.request("PUT", `/api/tasks/${id}`, payload);
  },

  deleteTask(id) {
    return this.request("DELETE", `/api/tasks/${id}`);
  },

  importTasks(payload) {
    return this.request("POST", "/api/import", payload);
  },

  notifyTask(id) {
    return this.request("POST", `/api/notify/${id}`);
  },

  getStats() {
    return this.request("GET", "/api/stats");
  },

  clearTasks() {
    return this.request("DELETE", "/api/tasks");
  },

  getHealth() {
    return this.request("GET", "/api/health");
  },
};
