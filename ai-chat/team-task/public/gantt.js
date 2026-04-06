const Gantt = {
  dayWidth: 32,

  async render(filters = {}) {
    const container = document.getElementById("gantt-container");
    const res = await API.getTasks({ ...filters, limit: 500 });
    if (!res.ok) { container.innerHTML = ""; return; }

    const tasks = res.tasks.filter((t) => t.startDate || t.dueDate);
    if (tasks.length === 0) {
      container.innerHTML = '<div style="padding:20px;color:var(--fg-dim);text-align:center">No tasks with dates to display</div>';
      return;
    }

    const today = this.toDay(new Date().toISOString().slice(0, 10));
    let minDate = Infinity, maxDate = -Infinity;
    for (const t of tasks) {
      const s = t.startDate ? this.toDay(t.startDate) : today;
      const e = t.dueDate ? this.toDay(t.dueDate) : s;
      if (s < minDate) minDate = s;
      if (e > maxDate) maxDate = e;
    }

    // pad 3 days each side
    minDate -= 3 * 86400000;
    maxDate += 3 * 86400000;

    const days = [];
    for (let d = minDate; d <= maxDate; d += 86400000) {
      days.push(d);
    }

    // Build table
    let html = '<table class="gantt-table"><thead><tr class="gantt-header-row">';
    html += '<th>Task</th>';
    for (const d of days) {
      const dt = new Date(d);
      const dayOfWeek = dt.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const label = `${dt.getMonth() + 1}/${dt.getDate()}`;
      html += `<th class="${isWeekend ? "gantt-weekend" : ""}" style="min-width:${this.dayWidth}px">${label}</th>`;
    }
    html += '</tr></thead><tbody>';

    for (const t of tasks) {
      const start = t.startDate ? this.toDay(t.startDate) : today;
      const end = t.dueDate ? this.toDay(t.dueDate) : start;

      html += '<tr class="gantt-row">';
      html += `<td title="${this.esc(t.title)}">${this.esc(t.title)}</td>`;

      let barPlaced = false;
      for (let i = 0; i < days.length; i++) {
        const d = days[i];
        const dt = new Date(d);
        const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
        const isToday = Math.abs(d - today) < 86400000;

        let cell = "";
        if (!barPlaced && d >= start) {
          const span = Math.max(1, Math.round((end - start) / 86400000) + 1);
          const barCls = `bar-${t.status}`;
          cell = `<div class="gantt-bar ${barCls}" style="left:0;width:${span * this.dayWidth - 4}px" title="${this.esc(t.title)} (${t.status})">${this.esc(t.title)}</div>`;
          barPlaced = true;
        }

        let cls = isWeekend ? "gantt-weekend" : "";
        let todayMarker = isToday ? `<div class="gantt-today" style="left:${this.dayWidth / 2}px"></div>` : "";
        html += `<td class="${cls}" style="min-width:${this.dayWidth}px">${cell}${todayMarker}</td>`;
      }

      html += '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;

    // Populate group filter
    const groups = new Set(res.tasks.map((t) => t.group).filter(Boolean));
    const sel = document.getElementById("gantt-filter-group");
    const current = sel.value;
    sel.innerHTML = '<option value="">All Groups</option>';
    for (const g of groups) {
      sel.innerHTML += `<option value="${this.esc(g)}" ${g === current ? "selected" : ""}>${this.esc(g)}</option>`;
    }
  },

  toDay(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  },

  esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  },
};
