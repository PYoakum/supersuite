const CompletionChart = {
  async render() {
    const canvas = document.getElementById("completion-chart");
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const res = await API.getTasks({ status: "done", limit: 500 });
    if (!res.ok || res.tasks.length === 0) {
      ctx.fillStyle = "#7a88cf";
      ctx.font = "13px monospace";
      ctx.textAlign = "center";
      ctx.fillText("No completed tasks to chart", w / 2, h / 2);
      return;
    }

    // Group completions by date
    const byDate = {};
    for (const t of res.tasks) {
      const date = t.completedAt ? t.completedAt.slice(0, 10) : t.updatedAt.slice(0, 10);
      byDate[date] = (byDate[date] || 0) + 1;
    }

    const dates = Object.keys(byDate).sort();
    if (dates.length === 0) return;

    // Fill gaps
    const allDates = [];
    const start = new Date(dates[0]);
    const end = new Date(dates[dates.length - 1]);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      allDates.push(d.toISOString().slice(0, 10));
    }
    if (allDates.length === 0) allDates.push(dates[0]);

    // Build cumulative data
    const dailyCounts = allDates.map((d) => byDate[d] || 0);
    const cumulative = [];
    let sum = 0;
    for (const c of dailyCounts) {
      sum += c;
      cumulative.push(sum);
    }

    const maxCum = Math.max(...cumulative, 1);
    const maxDaily = Math.max(...dailyCounts, 1);

    // Layout
    const pad = { top: 30, right: 20, bottom: 50, left: 50 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    // Background grid
    ctx.strokeStyle = "#3b3f5c";
    ctx.lineWidth = 0.5;
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const y = pad.top + (plotH / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = "#7a88cf";
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      const val = Math.round(maxCum - (maxCum / gridLines) * i);
      ctx.fillText(val.toString(), pad.left - 6, y + 3);
    }

    // Daily bars
    const barW = Math.max(2, plotW / allDates.length - 1);
    ctx.fillStyle = "rgba(122, 162, 247, 0.3)";
    for (let i = 0; i < allDates.length; i++) {
      const x = pad.left + (plotW / allDates.length) * i;
      const barH = (dailyCounts[i] / maxCum) * plotH;
      ctx.fillRect(x, pad.top + plotH - barH, barW, barH);
    }

    // Cumulative line
    ctx.strokeStyle = "#9ece6a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < cumulative.length; i++) {
      const x = pad.left + (plotW / Math.max(allDates.length - 1, 1)) * i;
      const y = pad.top + plotH - (cumulative[i] / maxCum) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Dots
    ctx.fillStyle = "#9ece6a";
    for (let i = 0; i < cumulative.length; i++) {
      const x = pad.left + (plotW / Math.max(allDates.length - 1, 1)) * i;
      const y = pad.top + plotH - (cumulative[i] / maxCum) * plotH;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // X-axis labels (show ~10 evenly spaced)
    ctx.fillStyle = "#7a88cf";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    const step = Math.max(1, Math.floor(allDates.length / 10));
    for (let i = 0; i < allDates.length; i += step) {
      const x = pad.left + (plotW / Math.max(allDates.length - 1, 1)) * i;
      const label = allDates[i].slice(5); // MM-DD
      ctx.save();
      ctx.translate(x, pad.top + plotH + 12);
      ctx.rotate(-0.5);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }

    // Legend
    ctx.fillStyle = "#9ece6a";
    ctx.fillRect(pad.left, 8, 12, 3);
    ctx.fillStyle = "#c8d3f5";
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.fillText("Cumulative", pad.left + 18, 13);

    ctx.fillStyle = "rgba(122, 162, 247, 0.5)";
    ctx.fillRect(pad.left + 110, 6, 12, 8);
    ctx.fillStyle = "#c8d3f5";
    ctx.fillText("Daily", pad.left + 128, 13);
  },
};
