import { fetchMessages, fetchAllMessages, fetchStats } from "./api.js";
import { createSocket } from "./websocket.js";
import { appendMessage, prependMessages, scrollToBottom, isNearBottom, clearMessages } from "./render.js";
import { initSearch } from "./search.js";
import { initExportPanel } from "./export-panel.js";

// DOM refs
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const msgInput = document.getElementById("msg-input");
const sendBtn = document.getElementById("send-btn");
const senderType = document.getElementById("sender-type");
const senderId = document.getElementById("sender-id");
const displayName = document.getElementById("display-name");
const loadMoreBtn = document.getElementById("load-more");
const exportBtn = document.getElementById("export-btn");
const clearBtn = document.getElementById("clear-btn");
const msgCountEl = document.getElementById("msg-count");
const clientCountEl = document.getElementById("client-count");

let oldestMessageId = null;
let totalRendered = 0;

// === Status ===
function setStatus(status) {
  statusDot.className = "status-dot " + status;
  statusText.textContent = status;
}

// === WebSocket ===
const socket = createSocket({
  onMessage(envelope) {
    if (envelope.type === "message:created") {
      const wasNear = isNearBottom();
      appendMessage(envelope.payload, { animate: true });
      totalRendered++;
      updateCount();
      if (wasNear) scrollToBottom();
    } else if (envelope.type === "chat:cleared") {
      clearMessages();
      oldestMessageId = null;
      totalRendered = 0;
      loadMoreBtn.style.display = "none";
      updateCount();
    } else if (envelope.type === "connection:status") {
      // connected ack
    } else if (envelope.type === "error") {
      console.warn("[ws] Error:", envelope.payload);
    } else if (envelope.type === "persona:warning") {
      console.warn("[persona]", envelope.payload.warnings);
    }
  },
  onStatus: setStatus,
});

// === Sending ===
function sendMessage() {
  const content = msgInput.value.trim();
  if (!content) return;

  socket.send("message:create", {
    senderType: senderType.value,
    senderId: senderId.value.trim() || "anon",
    displayName: displayName.value.trim() || "Anonymous",
    content,
  });

  msgInput.value = "";
  msgInput.focus();
}

sendBtn.addEventListener("click", sendMessage);
msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// === History ===
async function loadInitialHistory() {
  const messages = await fetchMessages({ limit: 100, order: "asc" });
  if (messages.length > 0) {
    // Messages come back in asc order from the API when we request order=asc
    // but our getRecent with no cursor returns last N messages, so they're already chronological
    for (const msg of messages) {
      appendMessage(msg);
    }
    oldestMessageId = messages[0].id;
    totalRendered = messages.length;
    updateCount();
    scrollToBottom(false);

    if (messages.length >= 100) {
      loadMoreBtn.style.display = "block";
    }
  }
}

loadMoreBtn.addEventListener("click", async () => {
  if (!oldestMessageId) return;
  const older = await fetchMessages({ limit: 100, before: oldestMessageId, order: "asc" });
  if (older.length > 0) {
    prependMessages(older);
    oldestMessageId = older[0].id;
    totalRendered += older.length;
    updateCount();

    if (older.length < 100) {
      loadMoreBtn.style.display = "none";
    }
  } else {
    loadMoreBtn.style.display = "none";
  }
});

// === Export ===
exportBtn.addEventListener("click", async () => {
  exportBtn.disabled = true;
  exportBtn.textContent = "…";
  try {
    const messages = await fetchAllMessages();
    const blob = new Blob([JSON.stringify(messages, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `chat-export-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("[export] Failed:", err);
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = "↓";
  }
});

// === Clear ===
clearBtn.addEventListener("click", async () => {
  if (!confirm("Clear all chat history? This cannot be undone.")) return;
  try {
    await fetch("/api/messages", { method: "DELETE" });
  } catch (err) {
    console.error("[clear] Failed:", err);
  }
});

// === Stats ===
function updateCount() {
  msgCountEl.textContent = `${totalRendered} msgs`;
}

async function refreshStats() {
  try {
    const data = await fetchStats();
    if (data.ok) {
      clientCountEl.textContent = `${data.connectedClients} online`;
    }
  } catch { /* ignore */ }
}

setInterval(refreshStats, 10000);

// === Init ===
loadInitialHistory();
initSearch();
initExportPanel();
refreshStats();
