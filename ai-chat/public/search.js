import { searchMessages } from "./api.js";
import { highlightMessage } from "./render.js";

const panel = document.getElementById("search-panel");
const resultsEl = document.getElementById("search-results");
const qInput = document.getElementById("search-q");
const senderInput = document.getElementById("search-sender");
const afterInput = document.getElementById("search-after");
const beforeInput = document.getElementById("search-before");
const goBtn = document.getElementById("search-go");
const closeBtn = document.getElementById("search-close");
const toggleBtn = document.getElementById("search-toggle");

export function initSearch() {
  toggleBtn.addEventListener("click", () => {
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) {
      // Close export panel if open
      const exportPanel = document.getElementById("export-panel");
      if (exportPanel) exportPanel.classList.add("hidden");
      qInput.focus();
    }
  });

  closeBtn.addEventListener("click", () => {
    panel.classList.add("hidden");
  });

  goBtn.addEventListener("click", runSearch);

  qInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });
}

async function runSearch() {
  const params = {};
  const q = qInput.value.trim();
  const sender = senderInput.value.trim();
  const after = afterInput.value;
  const before = beforeInput.value;

  if (q) params.q = q;
  if (sender) params.senderId = sender;
  if (after) params.after = new Date(after).toISOString();
  if (before) params.before = new Date(before + "T23:59:59").toISOString();

  if (!q && !sender && !after && !before) {
    resultsEl.innerHTML = `<div class="search-info">Enter at least one search criterion.</div>`;
    return;
  }

  resultsEl.innerHTML = `<div class="search-info">Searching…</div>`;

  const { results, total } = await searchMessages(params);

  resultsEl.innerHTML = "";

  if (results.length === 0) {
    resultsEl.innerHTML = `<div class="search-info">No results found.</div>`;
    return;
  }

  const info = document.createElement("div");
  info.className = "search-info";
  info.textContent = `${total} result${total !== 1 ? "s" : ""} found`;
  resultsEl.appendChild(info);

  for (const msg of results) {
    const item = document.createElement("div");
    item.className = "search-result";

    const meta = document.createElement("div");
    meta.className = "sr-meta";
    const t = new Date(msg.timestamp);
    meta.textContent = `${t.toLocaleDateString()} ${t.toLocaleTimeString()} — ${msg.displayName}`;

    const content = document.createElement("div");
    content.className = "sr-content";

    if (q) {
      const idx = msg.content.toLowerCase().indexOf(q.toLowerCase());
      if (idx >= 0) {
        const bef = msg.content.slice(0, idx);
        const match = msg.content.slice(idx, idx + q.length);
        const aft = msg.content.slice(idx + q.length);
        content.innerHTML = escapeHtml(bef) + "<mark>" + escapeHtml(match) + "</mark>" + escapeHtml(aft);
      } else {
        content.textContent = msg.content;
      }
    } else {
      content.textContent = msg.content;
    }

    item.appendChild(meta);
    item.appendChild(content);

    item.addEventListener("click", () => {
      highlightMessage(msg.id);
    });

    resultsEl.appendChild(item);
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
