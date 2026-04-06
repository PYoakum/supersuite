import { renderMarkdown, hasMarkdown } from "./markdown.js";

const messagesEl = document.getElementById("messages");

function formatTime(isoString) {
  const d = new Date(isoString);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function renderMessage(msg, { animate = false } = {}) {
  const row = document.createElement("div");
  let extraClass = "";
  if (msg.senderType === "system") extraClass = " system-row";
  if (msg.contentFormat === "tool-use") extraClass = " tool-use-row";
  if (msg.contentFormat === "tool-done") extraClass = " tool-done-row";
  if (msg.contentFormat === "aos") extraClass = " aos-row";
  if (msg.contentFormat === "flag") extraClass = " flag-row";
  row.className = `msg-row${extraClass}`;
  row.dataset.id = msg.id;

  const time = document.createElement("span");
  time.className = "msg-time";
  time.textContent = formatTime(msg.timestamp);
  time.title = msg.timestamp;

  if (msg.avatar) {
    const avatar = document.createElement("img");
    avatar.className = "msg-avatar";
    avatar.src = msg.avatar;
    avatar.alt = msg.displayName;
    row.appendChild(avatar);
  }

  const sender = document.createElement("span");
  sender.className = `msg-sender ${msg.senderType}`;
  sender.textContent = msg.displayName;
  sender.title = `${msg.senderId} (${msg.senderType})${msg.role ? " — " + msg.role : ""}`;

  const sep = document.createElement("span");
  sep.className = "msg-sep";
  sep.textContent = "│";

  const content = document.createElement("span");
  content.className = `msg-content${msg.senderType === "system" ? " system-content" : ""}`;

  row.appendChild(time);
  row.appendChild(sender);
  row.appendChild(sep);
  row.appendChild(content);

  // Flag messages (dishonesty alerts)
  if (msg.contentFormat === "flag") {
    content.classList.add("flag-content");
    content.textContent = msg.content;
    appendTags(content, msg.tags);
  // AOS protocol messages
  } else if (msg.contentFormat === "aos") {
    content.classList.add("aos-content");
    content.textContent = msg.content;
    appendTags(content, msg.tags);
  // Image messages
  } else if (msg.contentFormat === "image") {
    renderImageContent(content, msg.content, msg.tags);
  } else if (msg.contentFormat === "audio") {
    renderAudioContent(content, msg.content, msg.tags);
  } else if (animate && msg.senderType === "agent") {
    typewrite(content, msg.content, msg.tags);
  } else if (hasMarkdown(msg.content)) {
    content.innerHTML = renderMarkdown(msg.content);
    appendTags(content, msg.tags);
  } else {
    content.textContent = msg.content;
    appendTags(content, msg.tags);
  }

  return row;
}

function renderAudioContent(container, rawContent, tags) {
  let url = rawContent;
  let transcript = "";
  try {
    const parsed = JSON.parse(rawContent);
    url = parsed.url || rawContent;
    transcript = parsed.transcript || "";
  } catch { /* raw URL string */ }

  const wrap = document.createElement("span");
  wrap.className = "msg-audio-wrap";

  const label = document.createElement("span");
  label.className = "msg-audio-label";
  label.textContent = "\u{1F50A} Voice Note";
  wrap.appendChild(label);

  const audio = document.createElement("audio");
  audio.className = "msg-audio";
  audio.controls = true;
  audio.preload = "metadata";
  audio.src = url;
  wrap.appendChild(audio);

  if (transcript) {
    const tx = document.createElement("span");
    tx.className = "msg-audio-transcript";
    tx.textContent = transcript;
    wrap.appendChild(tx);
  }

  container.appendChild(wrap);
  appendTags(container, tags);
}

function renderImageContent(container, rawContent, tags) {
  let url = rawContent;
  let caption = "";
  try {
    const parsed = JSON.parse(rawContent);
    url = parsed.url || rawContent;
    caption = parsed.caption || "";
  } catch { /* raw URL string */ }

  const img = document.createElement("img");
  img.className = "msg-image";
  img.src = url;
  img.alt = caption || "image";
  img.loading = "lazy";
  img.addEventListener("click", () => window.open(url, "_blank"));
  container.appendChild(img);

  if (caption) {
    const cap = document.createElement("span");
    cap.className = "msg-image-caption";
    cap.textContent = caption;
    container.appendChild(cap);
  }
  appendTags(container, tags);
}

function appendTags(container, tags) {
  if (!tags || tags.length === 0) return;
  const tagsSpan = document.createElement("span");
  tagsSpan.className = "msg-tags";
  for (const tag of tags) {
    const t = document.createElement("span");
    t.className = "msg-tag";
    t.textContent = tag;
    tagsSpan.appendChild(t);
  }
  container.appendChild(tagsSpan);
}

// Track active typewriters for visibility-aware animation
const activeTypewriters = new Map(); // row element -> state

const typewriteObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const state = activeTypewriters.get(entry.target);
    if (!state) continue;
    if (entry.isIntersecting && state.paused) {
      state.resume();
    } else if (!entry.isIntersecting && !state.paused) {
      state.pause();
    }
  }
}, { root: document.getElementById("log-viewport"), threshold: 0 });

function typewrite(container, text, tags) {
  const words = text.split(/(\s+)/);
  let i = 0;
  const row = container.closest(".msg-row");

  const cursor = document.createElement("span");
  cursor.className = "stream-cursor";
  container.appendChild(cursor);

  const BATCH_SIZE = 40;
  let batchCount = 0;
  let timer = null;

  function tick() {
    if (i >= words.length) {
      cleanup();
      return;
    }

    const token = words[i++];
    const span = document.createElement("span");
    span.className = "token-fade";
    span.textContent = token;
    container.insertBefore(span, cursor);
    batchCount++;

    if (batchCount >= BATCH_SIZE) {
      collapseSpans(container, cursor);
      batchCount = 0;
    }

    timer = setTimeout(tick, 20);
  }

  function cleanup() {
    if (timer) clearTimeout(timer);
    cursor.remove();
    // Replace typewritten plaintext with rendered markdown
    if (hasMarkdown(text)) {
      container.innerHTML = renderMarkdown(text);
    } else {
      collapseSpans(container, null);
    }
    appendTags(container, tags);
    if (row) {
      activeTypewriters.delete(row);
      typewriteObserver.unobserve(row);
    }
  }

  const state = {
    paused: false,
    pause() {
      state.paused = true;
      if (timer) { clearTimeout(timer); timer = null; }
      cursor.remove();
      // Render full content when scrolled out of view
      if (hasMarkdown(text)) {
        container.innerHTML = renderMarkdown(text);
      } else {
        const remaining = words.slice(i).join("");
        i = words.length;
        container.insertBefore(document.createTextNode(remaining), null);
        collapseSpans(container, null);
      }
      appendTags(container, tags);
      if (row) {
        activeTypewriters.delete(row);
        typewriteObserver.unobserve(row);
      }
    },
    resume() {
      state.paused = false;
      tick();
    },
  };

  if (row) {
    activeTypewriters.set(row, state);
    typewriteObserver.observe(row);
  }

  // Start immediately (visible by default since it was just appended)
  tick();
}

/** Merge all text/span children before the cursor (or all if null) into a single text node */
function collapseSpans(container, cursor) {
  let text = "";
  const toRemove = [];
  for (const child of container.childNodes) {
    if (cursor && child === cursor) break;
    text += child.textContent;
    toRemove.push(child);
  }
  for (const node of toRemove) node.remove();
  if (text) {
    if (cursor) container.insertBefore(document.createTextNode(text), cursor);
    else container.appendChild(document.createTextNode(text));
  }
}

export function appendMessage(msg, { animate = false } = {}) {
  // When a tool-done arrives, convert matching tool-use rows to done state
  if (msg.contentFormat === "tool-done" && msg.tags) {
    const toolName = msg.tags.find(t => t !== "tool-done");
    if (toolName) {
      const active = messagesEl.querySelectorAll(".tool-use-row");
      for (const el of active) {
        if (el.textContent?.includes(toolName)) {
          el.classList.remove("tool-use-row");
          el.classList.add("tool-done-row");
        }
      }
    }
    // Don't render a separate "finished" message — just convert the active one
    return null;
  }

  const row = renderMessage(msg, { animate });
  messagesEl.appendChild(row);
  return row;
}

export function prependMessages(msgs) {
  const frag = document.createDocumentFragment();
  for (const msg of msgs) {
    frag.appendChild(renderMessage(msg));
  }
  messagesEl.prepend(frag);
}

export function scrollToBottom(smooth = true) {
  const anchor = document.getElementById("scroll-anchor");
  if (anchor) {
    anchor.scrollIntoView({ behavior: smooth ? "smooth" : "instant" });
  }
}

export function highlightMessage(id) {
  const el = messagesEl.querySelector(`[data-id="${id}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("highlight");
  setTimeout(() => el.classList.remove("highlight"), 2000);
}

export function clearMessages() {
  messagesEl.innerHTML = "";
}

export function isNearBottom() {
  const viewport = document.getElementById("log-viewport");
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80;
}
