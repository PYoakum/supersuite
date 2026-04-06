import { fetchAllMessages } from "./api.js";

const panel = document.getElementById("export-panel");
const closeBtn = document.getElementById("export-panel-close");
const toggleBtn = document.getElementById("export-panel-toggle");
const endpointInput = document.getElementById("export-endpoint");
const methodSelect = document.getElementById("export-method");
const promptInput = document.getElementById("export-prompt");
const formatSelect = document.getElementById("export-format");
const sendBtn = document.getElementById("export-send");
const statusEl = document.getElementById("export-status");

function setStatus(msg, type = "info") {
  statusEl.textContent = msg;
  statusEl.className = "export-status " + type;
}

function formatMessages(messages) {
  return messages.map(m =>
    `[${m.timestamp}] ${m.displayName} (${m.senderType}): ${m.content}`
  ).join("\n");
}

function buildPayload(messages, prompt, format) {
  const chatLog = format === "text" ? formatMessages(messages) : messages;

  switch (format) {
    case "text":
      return { prompt, chatLog };
    case "json":
      return { prompt, messages };
    case "openai":
      // OpenAI-compatible messages array
      const oaiMessages = [];
      if (prompt) {
        oaiMessages.push({ role: "system", content: prompt });
      }
      for (const m of messages) {
        oaiMessages.push({
          role: m.senderType === "agent" ? "assistant" : "user",
          content: `[${m.displayName}] ${m.content}`,
        });
      }
      return { messages: oaiMessages };
    default:
      return { prompt, messages };
  }
}

async function sendExport() {
  const endpoint = endpointInput.value.trim();
  if (!endpoint) {
    setStatus("Enter an endpoint URL", "error");
    return;
  }

  const prompt = promptInput.value.trim();
  const format = formatSelect.value;
  const method = methodSelect.value;

  sendBtn.disabled = true;
  sendBtn.textContent = "sending...";
  setStatus("Fetching chat log...", "info");

  try {
    const messages = await fetchAllMessages();
    if (messages.length === 0) {
      setStatus("No messages to export", "error");
      return;
    }

    setStatus(`Sending ${messages.length} messages...`, "info");
    const payload = buildPayload(messages, prompt, format);

    const res = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      setStatus(`Sent (${res.status}) — ${messages.length} messages`, "success");
    } else {
      const text = await res.text().catch(() => "");
      setStatus(`Error ${res.status}: ${text.slice(0, 100)}`, "error");
    }
  } catch (err) {
    setStatus(`Failed: ${err.message}`, "error");
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = "send";
  }
}

export function initExportPanel() {
  toggleBtn.addEventListener("click", () => {
    panel.classList.toggle("hidden");
    // Close search panel if open
    const searchPanel = document.getElementById("search-panel");
    if (!panel.classList.contains("hidden") && searchPanel) {
      searchPanel.classList.add("hidden");
    }
  });

  closeBtn.addEventListener("click", () => {
    panel.classList.add("hidden");
  });

  sendBtn.addEventListener("click", sendExport);

  // Enter on endpoint triggers send
  endpointInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendExport();
  });
}
