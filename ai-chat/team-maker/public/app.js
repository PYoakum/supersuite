// ── DOM refs ──
const planInput = document.getElementById("plan-input");
const fileDrop = document.getElementById("file-drop");
const fileInput = document.getElementById("file-input");
const aiCount = document.getElementById("ai-count");
const humanCount = document.getElementById("human-count");
const provider = document.getElementById("provider");
const model = document.getElementById("model");
const promptStyle = document.getElementById("prompt-style");
const strategy = document.getElementById("strategy");
const includeRisks = document.getElementById("include-risks");
const includeDeps = document.getElementById("include-deps");
const evaluateBtn = document.getElementById("evaluate-btn");
const loading = document.getElementById("loading");
const errorMsg = document.getElementById("error-msg");
const inputPanel = document.getElementById("input-panel");
const resultsPanel = document.getElementById("results-panel");
const backBtn = document.getElementById("back-btn");
const exportJsonBtn = document.getElementById("export-json-btn");
const exportMdBtn = document.getElementById("export-md-btn");
const applyModelsBtn = document.getElementById("apply-models-btn");
const modelErrorMsg = document.getElementById("model-error-msg");
const streamPreview = document.getElementById("stream-preview");
const streamBody = document.getElementById("stream-body");
const streamChars = document.getElementById("stream-chars");
const loadingText = document.getElementById("loading-text");
const importBtn = document.getElementById("import-btn");
const importInput = document.getElementById("import-input");

let lastResult = null;

const DEFAULT_MODELS = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  gemini: "gemini-2.5-flash",
  "openai-compat": "",
};

// ── File upload ──
fileDrop.addEventListener("click", () => fileInput.click());
fileDrop.addEventListener("dragover", (e) => {
  e.preventDefault();
  fileDrop.classList.add("dragover");
});
fileDrop.addEventListener("dragleave", () => fileDrop.classList.remove("dragover"));
fileDrop.addEventListener("drop", (e) => {
  e.preventDefault();
  fileDrop.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) readFile(file);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) readFile(fileInput.files[0]);
});

function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    planInput.value = reader.result;
    fileDrop.textContent = `Loaded: ${file.name}`;
  };
  reader.readAsText(file);
}

// ── Evaluate ──
evaluateBtn.addEventListener("click", runEvaluate);

async function runEvaluate() {
  const plan = planInput.value.trim();
  if (!plan) {
    showError("Please enter a project plan");
    return;
  }

  hideError();
  evaluateBtn.disabled = true;
  loading.classList.add("visible");
  loadingText.textContent = "Connecting to LLM...";

  // Reset stream preview
  streamBody.textContent = "";
  streamChars.textContent = "";
  streamPreview.classList.add("visible");

  const body = {
    plan,
    stream: true,
    aiAgentCount: Number(aiCount.value),
    humanCount: Number(humanCount.value),
    provider: provider.value,
    promptStyle: promptStyle.value,
    allocationStrategy: strategy.value,
    includeRisks: includeRisks.checked,
    includeDependencies: includeDeps.checked,
  };

  if (model.value.trim()) {
    body.model = model.value.trim();
  }

  try {
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ errors: [`HTTP ${res.status}`] }));
      showError(err.errors?.join(", ") || "Evaluation failed");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let charCount = 0;

    loadingText.textContent = "Streaming response...";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          var currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ") && currentEvent) {
          const data = JSON.parse(line.slice(6));

          if (currentEvent === "chunk" && data.text) {
            charCount += data.text.length;
            streamBody.textContent += data.text;
            streamChars.textContent = `${charCount} chars`;
            // Auto-scroll to bottom
            streamBody.scrollTop = streamBody.scrollHeight;
          } else if (currentEvent === "done") {
            loadingText.textContent = "Parsing results...";
            lastResult = data;
            streamPreview.classList.remove("visible");
            loading.classList.remove("visible");
            renderResults(data);
          } else if (currentEvent === "error") {
            showError(data.errors?.join(", ") || "Evaluation failed");
          }

          currentEvent = null;
        }
      }
    }
  } catch (err) {
    showError(err.message || "Network error");
  } finally {
    evaluateBtn.disabled = false;
    loading.classList.remove("visible");
  }
}

// ── Render results ──
function renderResults(data) {
  inputPanel.style.display = "none";
  resultsPanel.classList.add("visible");

  // Sync running agents from server
  fetch("/api/agents").then(r => r.json()).then(d => {
    if (d.ok) {
      launchedAgents.clear();
      for (const a of d.agents || []) {
        launchedAgents.add(a.roleId);
        const btn = document.getElementById(`launch-${a.roleId}`);
        if (btn) { btn.textContent = "stop agent"; btn.classList.add("running"); }
      }
      updateAllButtons();
    }
  }).catch(() => {});

  // Summary
  document.getElementById("summary").textContent = data.summary;

  // Usage
  const usageEl = document.getElementById("usage");
  if (data.usage) {
    usageEl.textContent = `Tokens: ${data.usage.input_tokens} in / ${data.usage.output_tokens} out`;
  }

  // Tasks
  const tasksList = document.getElementById("tasks-list");
  tasksList.innerHTML = data.tasks.map(t => `
    <div class="task-item">
      <span class="task-id">${esc(t.id)}</span>
      <span class="task-title">${esc(t.title)}</span>
      ${t.priority ? `<span class="task-priority ${t.priority}">${t.priority}</span>` : ""}
    </div>
  `).join("");

  // Assignments
  const assignList = document.getElementById("assignments-list");
  assignList.innerHTML = data.assignments.map(a => {
    const kind = a.roleKind || (a.roleType === "human" ? "human" : "worker");
    const kindBadge = kind === "pm"
      ? `<span class="role-kind pm">PM</span>`
      : kind === "worker"
        ? `<span class="role-kind worker">worker</span>`
        : "";

    let metaLines = "";
    if (kind === "pm" && a.manages?.length) {
      metaLines += `<div class="role-manages">manages: ${a.manages.map(esc).join(", ")}</div>`;
    }
    if (kind === "worker" && a.managedBy) {
      const pm = data.assignments.find(x => x.roleId === a.managedBy);
      const pmLabel = pm?.displayName || a.managedBy;
      metaLines += `<div class="role-managed-by">pm: ${esc(pmLabel)}</div>`;
    }

    const skillTags = (a.skills || []).length
      ? `<div class="role-skills-tags">${a.skills.map(s => `<span class="skill-tag">${esc(s)}</span>`).join("")}</div>`
      : "";
    const toolTags = (a.tools || []).length
      ? `<div class="role-skills-tags">${a.tools.map(t => `<span class="skill-tag" style="color:var(--agent);border-color:rgba(184,134,11,0.25);background:rgba(184,134,11,0.08);">${esc(t)}</span>`).join("")}</div>`
      : "";

    return `
    <div class="role-card">
      <div class="role-header">
        <div class="role-avatar-wrap">
          ${a.avatar ? `<img class="role-avatar-preview" data-role-id="${esc(a.roleId)}" src="${esc(a.avatar)}" alt="${esc(a.roleId)}">` : `<div class="role-avatar-placeholder" data-role-id="${esc(a.roleId)}"></div>`}
        </div>
        <span class="role-id ${a.roleType}">${esc(a.roleId)}</span>
        ${kindBadge}
        <span class="role-type ${a.roleType}">${a.roleType}</span>
      </div>
      <div class="role-name-row">
        <label>Name:</label>
        <input class="role-display-name ${a.roleType}" data-role-id="${esc(a.roleId)}" value="${esc(a.displayName || a.focus.split(' ')[0] || a.roleId)}" spellcheck="false" placeholder="Agent display name">
      </div>
      <div class="role-name-row">
        <label>Avatar:</label>
        <input class="role-avatar-input" data-role-id="${esc(a.roleId)}" value="${esc(a.avatar || '')}" spellcheck="false" placeholder="Image URL">
      </div>
      ${metaLines}
      <div class="role-focus">${esc(a.focus)}</div>
      <div class="role-tasks">Tasks: ${a.taskIds.map(esc).join(", ")}</div>
      ${skillTags}
      ${toolTags}
    </div>`;
  }).join("");

  // Wire up display name edit on blur/enter
  assignList.querySelectorAll(".role-display-name").forEach(input => {
    const roleId = input.dataset.roleId;
    let lastVal = input.value;
    function applyName() {
      const name = input.value.trim();
      if (!name || name === lastVal) { input.value = lastVal; return; }
      updateRoleField(roleId, { displayName: name });
      lastVal = name;
    }
    input.addEventListener("blur", applyName);
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
  });

  // Wire up avatar edit on blur/enter
  assignList.querySelectorAll(".role-avatar-input").forEach(input => {
    const roleId = input.dataset.roleId;
    let lastVal = input.value;
    function applyAvatar() {
      const url = input.value.trim();
      if (url === lastVal) return;
      updateRoleField(roleId, { avatar: url });
      lastVal = url;
      // Update preview
      const preview = assignList.querySelector(`.role-avatar-preview[data-role-id="${roleId}"]`);
      const placeholder = assignList.querySelector(`.role-avatar-placeholder[data-role-id="${roleId}"]`);
      if (url) {
        if (preview) { preview.src = url; }
        else if (placeholder) {
          const img = document.createElement("img");
          img.className = "role-avatar-preview";
          img.dataset.roleId = roleId;
          img.src = url;
          img.alt = roleId;
          placeholder.replaceWith(img);
        }
      } else if (preview) {
        const ph = document.createElement("div");
        ph.className = "role-avatar-placeholder";
        ph.dataset.roleId = roleId;
        preview.replaceWith(ph);
      }
    }
    input.addEventListener("blur", applyAvatar);
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
  });

  // Skills panel
  renderSkillsPanel(data);

  // Tools panel
  renderToolsPanel(data);

  // Prompts
  const promptsList = document.getElementById("prompts-list");
  promptsList.innerHTML = data.prompts.map((p, i) => {
    const kind = p.roleKind || (p.roleType === "human" ? "human" : "worker");
    const kindBadge = kind === "pm"
      ? `<span class="role-kind pm">PM</span>`
      : kind === "worker"
        ? `<span class="role-kind worker">worker</span>`
        : "";
    return `
    <div class="prompt-card">
      <div class="prompt-header" onclick="togglePrompt(${i})">
        <span class="role-id ${p.roleType}">${esc(p.roleId)}</span>
        ${kindBadge}
        <div style="display:flex;gap:4px;" onclick="event.stopPropagation()">
          ${p.roleType === "ai" ? `<button class="send-role-btn launch-btn" id="launch-${esc(p.roleId)}" onclick="toggleAgent('${esc(p.roleId)}', this)">launch agent</button>` : ""}
          <button class="send-role-btn" onclick="dispatchRole('chat', '${esc(p.roleId)}', this)">send to chat</button>
          <button class="send-role-btn" onclick="dispatchRole('tasks', '${esc(p.roleId)}', this)">send tasks</button>
          <button class="copy-btn" onclick="copyPrompt(${i})">copy</button>
        </div>
      </div>
      <div class="prompt-body" id="prompt-body-${i}">${esc(p.prompt)}</div>
    </div>`;
  }).join("");

  // Model assignment per AI role
  const roleLlmList = document.getElementById("role-llm-list");
  const aiRoles = data.assignments.filter(a => a.roleType === "ai");
  roleLlmList.innerHTML = aiRoles.map(a => {
    const llm = a.llm || {};
    const prov = llm.provider || provider.value || "anthropic";
    const mod = llm.model || "";
    const base = llm.baseUrl || "";
    return `
    <div class="role-llm-row" data-role-id="${esc(a.roleId)}">
      <span class="role-id ai">${esc(a.roleId)}</span>
      <select class="role-provider">
        <option value="anthropic" ${prov === "anthropic" ? "selected" : ""}>Anthropic</option>
        <option value="openai" ${prov === "openai" ? "selected" : ""}>OpenAI</option>
        <option value="gemini" ${prov === "gemini" ? "selected" : ""}>Gemini</option>
        <option value="openai-compat" ${prov === "openai-compat" ? "selected" : ""}>OpenAI-compat</option>
      </select>
      <input type="text" class="role-model" placeholder="model id" value="${esc(mod)}">
      <input type="text" class="role-base-url" placeholder="base url (compat only)" value="${esc(base)}"
        style="display:${prov === "openai-compat" ? "block" : "none"}">
    </div>`;
  }).join("");

  // Show/hide base URL when provider changes
  roleLlmList.querySelectorAll(".role-provider").forEach(sel => {
    sel.addEventListener("change", () => {
      const row = sel.closest(".role-llm-row");
      const urlInput = row.querySelector(".role-base-url");
      const modelInput = row.querySelector(".role-model");
      urlInput.style.display = sel.value === "openai-compat" ? "block" : "none";
      if (!modelInput.value || Object.values(DEFAULT_MODELS).includes(modelInput.value)) {
        modelInput.value = DEFAULT_MODELS[sel.value] || "";
      }
    });
  });

  // Ambiguities
  const ambSection = document.getElementById("ambiguities-section");
  if (data.ambiguities?.length) {
    ambSection.style.display = "block";
    document.getElementById("ambiguities-list").innerHTML =
      data.ambiguities.map(a => `<div style="margin-bottom:4px;">- ${esc(a)}</div>`).join("");
  } else {
    ambSection.style.display = "none";
  }

  // Validation warnings
  const warnEl = document.getElementById("validation-warnings");
  if (data.validation?.warnings?.length) {
    warnEl.innerHTML = `
      <div class="warnings">
        <h3>Validation Warnings</h3>
        <ul>${data.validation.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>
      </div>
    `;
  } else {
    warnEl.innerHTML = "";
  }
}

// ── Prompt interactions ──
window.togglePrompt = function(i) {
  const el = document.getElementById(`prompt-body-${i}`);
  el.classList.toggle("visible");
};

window.copyPrompt = function(i) {
  if (!lastResult) return;
  const text = lastResult.prompts[i]?.prompt || "";
  navigator.clipboard.writeText(text).then(() => {
    const btns = document.querySelectorAll(".copy-btn");
    if (btns[i]) {
      btns[i].textContent = "copied";
      btns[i].classList.add("copied");
      setTimeout(() => {
        btns[i].textContent = "copy";
        btns[i].classList.remove("copied");
      }, 1500);
    }
  });
};

// ── Navigation ──
backBtn.addEventListener("click", () => {
  resultsPanel.classList.remove("visible");
  inputPanel.style.display = "block";
});

// ── Export ──
exportJsonBtn.addEventListener("click", () => {
  if (!lastResult) return;
  downloadFile("team-plan.json", JSON.stringify(lastResult, null, 2), "application/json");
});

exportMdBtn.addEventListener("click", async () => {
  if (!lastResult) return;
  try {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "markdown", data: lastResult }),
    });
    const text = await res.text();
    downloadFile("team-plan.md", text, "text/markdown");
  } catch (err) {
    showError("Export failed: " + err.message);
  }
});

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Apply model assignments ──
applyModelsBtn.addEventListener("click", async () => {
  const rows = document.querySelectorAll(".role-llm-row");
  const roles = [];

  for (const row of rows) {
    const roleId = row.dataset.roleId;
    const prov = row.querySelector(".role-provider").value;
    const mod = row.querySelector(".role-model").value.trim();
    const base = row.querySelector(".role-base-url").value.trim();

    if (!mod) {
      modelErrorMsg.textContent = `${roleId}: model is required`;
      modelErrorMsg.classList.add("visible");
      return;
    }

    const llm = { provider: prov, model: mod };
    if (prov === "openai-compat") {
      if (!base) {
        modelErrorMsg.textContent = `${roleId}: base URL required for openai-compat`;
        modelErrorMsg.classList.add("visible");
        return;
      }
      llm.baseUrl = base;
    }

    roles.push({ roleId, llm });
  }

  modelErrorMsg.classList.remove("visible");
  applyModelsBtn.disabled = true;

  try {
    const res = await fetch("/api/roles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roles }),
    });

    const data = await res.json();

    if (!data.ok) {
      modelErrorMsg.textContent = data.errors?.join(", ") || "Failed to apply";
      modelErrorMsg.classList.add("visible");
      return;
    }

    // Update local result with patched assignments/prompts
    if (lastResult) {
      lastResult.assignments = data.assignments;
      lastResult.prompts = data.prompts;
    }

    applyModelsBtn.textContent = "Applied";
    setTimeout(() => { applyModelsBtn.textContent = "Apply Models"; }, 1500);
  } catch (err) {
    modelErrorMsg.textContent = err.message || "Network error";
    modelErrorMsg.classList.add("visible");
  } finally {
    applyModelsBtn.disabled = false;
  }
});

// ── Dispatch ──
const dispatchStatus = document.getElementById("dispatch-status");
const sendAllChatBtn = document.getElementById("send-all-chat-btn");
const sendAllTasksBtn = document.getElementById("send-all-tasks-btn");

function showDispatch(msg, ok) {
  dispatchStatus.textContent = msg;
  dispatchStatus.className = `dispatch-status visible ${ok ? "success" : "error"}`;
  if (ok) setTimeout(() => { dispatchStatus.classList.remove("visible"); }, 3000);
}

async function dispatch(target, roleIds, btn) {
  if (btn) { btn.disabled = true; btn.textContent = "..."; }

  try {
    const body = { target };
    if (roleIds) body.roleIds = roleIds;

    const res = await fetch("/api/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (data.ok) {
      const label = target === "chat" ? "chat" : "task board";
      showDispatch(`Sent ${data.dispatched}/${data.total} to ${label}`, true);
      if (btn) { btn.textContent = "sent"; btn.classList.add("sent"); }
    } else {
      showDispatch(data.errors?.join(", ") || "Dispatch failed", false);
      if (btn) { btn.textContent = "failed"; }
    }
  } catch (err) {
    showDispatch(err.message || "Network error", false);
    if (btn) { btn.textContent = "failed"; }
  } finally {
    if (btn) {
      btn.disabled = false;
      setTimeout(() => {
        if (btn.textContent === "sent" || btn.textContent === "failed") {
          btn.textContent = target === "chat" ? "send to chat" : "send tasks";
          btn.classList.remove("sent");
        }
      }, 2000);
    }
  }
}

window.dispatchRole = function(target, roleId, btn) {
  dispatch(target, [roleId], btn);
};

sendAllChatBtn.addEventListener("click", () => dispatch("chat"));
sendAllTasksBtn.addEventListener("click", () => dispatch("tasks"));

// ── Update role field (displayName, avatar) ──
async function updateRoleField(roleId, fields) {
  try {
    const res = await fetch("/api/roles/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId, ...fields }),
    });
    const data = await res.json();
    if (!data.ok) {
      showDispatch(data.errors?.join(", ") || "Update failed", false);
      return;
    }

    if (lastResult) {
      for (const a of lastResult.assignments) {
        if (a.roleId === roleId) Object.assign(a, fields);
      }
      for (const p of lastResult.prompts) {
        if (p.roleId === roleId) Object.assign(p, fields);
      }
    }

    const label = fields.displayName || fields.avatar ? (fields.displayName || "avatar") : "updated";
    showDispatch(`${roleId}: ${label}`, true);
  } catch (err) {
    showDispatch(err.message, false);
  }
}

// ── Agent launch/stop ──
const launchedAgents = new Set();
const launchAllBtn = document.getElementById("launch-all-btn");
const stopAllBtn = document.getElementById("stop-all-btn");

function updateAllButtons() {
  if (launchedAgents.size > 0) {
    launchAllBtn.style.display = "none";
    stopAllBtn.style.display = "";
  } else {
    launchAllBtn.style.display = "";
    stopAllBtn.style.display = "none";
  }
}

launchAllBtn.addEventListener("click", async () => {
  if (!lastResult) return;
  const aiPrompts = lastResult.prompts.filter(p => p.roleType === "ai");
  launchAllBtn.disabled = true;
  launchAllBtn.textContent = "Launching...";

  let launched = 0;
  for (const p of aiPrompts) {
    if (launchedAgents.has(p.roleId)) continue;
    try {
      const res = await fetch("/api/agents/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId: p.roleId }),
      });
      const data = await res.json();
      if (data.ok) {
        launchedAgents.add(p.roleId);
        launched++;
        const btn = document.getElementById(`launch-${p.roleId}`);
        if (btn) { btn.textContent = "stop agent"; btn.classList.add("running"); }
      }
    } catch {}
  }

  showDispatch(`Launched ${launched} agent(s)`, launched > 0);
  launchAllBtn.textContent = "Launch All Agents";
  launchAllBtn.disabled = false;
  updateAllButtons();
});

stopAllBtn.addEventListener("click", async () => {
  stopAllBtn.disabled = true;
  stopAllBtn.textContent = "Stopping...";

  // Fetch actual running agents from server (client set may be stale)
  let agentIds = [...launchedAgents];
  try {
    const listRes = await fetch("/api/agents");
    const listData = await listRes.json();
    if (listData.ok && listData.agents?.length) {
      agentIds = listData.agents.map(a => a.roleId);
    }
  } catch {}

  let stopped = 0;
  for (const roleId of agentIds) {
    try {
      const res = await fetch("/api/agents/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId }),
      });
      const data = await res.json();
      if (data.ok) {
        launchedAgents.delete(roleId);
        stopped++;
        const btn = document.getElementById(`launch-${roleId}`);
        if (btn) { btn.textContent = "launch agent"; btn.classList.remove("running"); }
      }
    } catch {}
  }

  showDispatch(`Stopped ${stopped} agent(s)`, stopped > 0);
  stopAllBtn.textContent = "Stop All Agents";
  stopAllBtn.disabled = false;
  updateAllButtons();
});

window.toggleAgent = async function(roleId, btn) {
  if (launchedAgents.has(roleId)) {
    // Stop
    btn.disabled = true;
    btn.textContent = "stopping...";
    try {
      const res = await fetch("/api/agents/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId }),
      });
      const data = await res.json();
      if (data.ok) {
        launchedAgents.delete(roleId);
        btn.textContent = "launch agent";
        btn.classList.remove("running");
        showDispatch(`${roleId} stopped`, true);
      } else {
        btn.textContent = "stop agent";
        showDispatch(data.errors?.join(", ") || "Stop failed", false);
      }
    } catch (err) {
      showDispatch(err.message, false);
      btn.textContent = "stop agent";
    } finally {
      btn.disabled = false;
    }
  } else {
    // Launch
    btn.disabled = true;
    btn.textContent = "launching...";
    try {
      const res = await fetch("/api/agents/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId }),
      });
      const data = await res.json();
      if (data.ok) {
        launchedAgents.add(roleId);
        btn.textContent = "stop agent";
        btn.classList.add("running");
        showDispatch(`${roleId} launched (pid ${data.pid})`, true);
      } else {
        btn.textContent = "launch agent";
        showDispatch(data.errors?.join(", ") || "Launch failed", false);
      }
    } catch (err) {
      showDispatch(err.message, false);
      btn.textContent = "launch agent";
    } finally {
      btn.disabled = false;
    }
  }
};

// ── Import Agents from configs ──
const importAgentsBtn = document.getElementById("import-agents-btn");
const agentPicker = document.getElementById("agent-picker");
const agentPickerList = document.getElementById("agent-picker-list");
const importSelectedBtn = document.getElementById("import-selected-btn");
const cancelPickerBtn = document.getElementById("cancel-picker-btn");

importAgentsBtn.addEventListener("click", async () => {
  try {
    const res = await fetch("/api/agents/configs");
    const data = await res.json();
    if (!data.ok || !data.configs?.length) {
      showError("No agent configs found");
      return;
    }

    agentPickerList.innerHTML = data.configs.map(c => `
      <label class="agent-pick-row">
        <input type="checkbox" value="${esc(c.file)}" checked>
        <span class="agent-pick-name">${esc(c.displayName)}</span>
        <span class="agent-pick-meta">${esc(c.provider)}/${esc(c.model)} [${c.source}]</span>
      </label>
    `).join("");

    agentPicker.style.display = "block";
  } catch (err) {
    showError(err.message);
  }
});

cancelPickerBtn.addEventListener("click", () => {
  agentPicker.style.display = "none";
});

importSelectedBtn.addEventListener("click", async () => {
  const checked = agentPickerList.querySelectorAll("input:checked");
  const files = [...checked].map(el => el.value);

  if (files.length === 0) {
    showError("No agents selected");
    return;
  }

  try {
    const res = await fetch("/api/agents/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    });
    const data = await res.json();
    if (!data.ok) {
      showError(data.errors?.join(", ") || "Import failed");
      return;
    }

    agentPicker.style.display = "none";

    // Fetch the updated roles and render
    const rolesRes = await fetch("/api/roles");
    const rolesData = await rolesRes.json();
    if (rolesData.ok) {
      lastResult = {
        summary: lastResult?.summary || "Imported agents",
        tasks: lastResult?.tasks || [],
        assignments: rolesData.assignments,
        prompts: rolesData.prompts,
        coverageReport: lastResult?.coverageReport || { coveredTaskIds: [], uncoveredTaskIds: [], notes: [] },
        ambiguities: lastResult?.ambiguities || [],
      };
      renderResults(lastResult);
    }

    showDispatch(`Imported ${data.imported} agent(s)`, true);
  } catch (err) {
    showError(err.message);
  }
});

// ── Import ──
importBtn.addEventListener("click", () => importInput.click());
importInput.addEventListener("change", async () => {
  const file = importInput.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    // Send to server so roles PATCH works
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: text,
    });

    const result = await res.json();
    if (!result.ok) {
      showError(result.errors?.join(", ") || "Import failed");
      return;
    }

    lastResult = data;
    renderResults(data);
  } catch (err) {
    showError("Invalid JSON file: " + err.message);
  } finally {
    importInput.value = "";
  }
});

// ── Skills panel ──
const skillsToggle = document.getElementById("skills-toggle");
const skillsBody = document.getElementById("skills-section");
const skillsHint = document.getElementById("skills-hint");
const applySkillsBtn = document.getElementById("apply-skills-btn");
const skillsStatusEl = document.getElementById("skills-status");

skillsToggle.addEventListener("click", () => {
  const open = skillsToggle.classList.toggle("open");
  skillsBody.style.display = open ? "block" : "none";
});

async function renderSkillsPanel(data) {
  const availableEl = document.getElementById("skills-available");
  const assignListEl = document.getElementById("skills-assign-list");

  let skills = [];
  try {
    const res = await fetch("/api/skills");
    const d = await res.json();
    if (d.ok) skills = d.skills || [];
  } catch {}

  const totalAssigned = data.assignments.reduce((n, a) => n + (a.skills?.length || 0), 0);
  skillsHint.textContent = `${skills.length} available, ${totalAssigned} assigned`;

  if (skills.length === 0) {
    availableEl.innerHTML = `<div style="opacity:0.5;font-size:12px;font-family:var(--font-mono);">No skill files found in skills/ directory</div>`;
    assignListEl.innerHTML = "";
    return;
  }

  availableEl.innerHTML = `<div class="skills-available">${skills.map(s =>
    `<span class="skill-chip" title="${esc(s.filename)} (${s.size} bytes)">${esc(s.title)}</span>`
  ).join("")}</div>`;

  const aiRoles = data.assignments.filter(a => a.roleType === "ai");

  assignListEl.innerHTML = aiRoles.map(a => {
    const current = a.skills || [];
    return `
    <div class="skill-assign-row" data-role-id="${esc(a.roleId)}">
      <span class="role-id ${a.roleKind === 'pm' ? 'ai' : a.roleType}">${esc(a.displayName || a.roleId)}</span>
      ${a.roleKind === "pm" ? `<span class="role-kind pm">PM</span>` : ""}
      <div class="tools-checkboxes" style="display:flex;flex-wrap:wrap;gap:6px;flex:1;">
        ${skills.map(s => `
          <label class="checkbox-field" style="margin:0;">
            <input type="checkbox" value="${esc(s.filename)}" ${current.includes(s.filename) ? "checked" : ""}>
            <span style="font-family:var(--font-mono);font-size:11px;">${esc(s.title)}</span>
          </label>
        `).join("")}
      </div>
    </div>`;
  }).join("");
}

applySkillsBtn.addEventListener("click", async () => {
  applySkillsBtn.disabled = true;
  applySkillsBtn.textContent = "Applying...";

  const rows = document.querySelectorAll("#skills-assign-list .skill-assign-row");
  let applied = 0;

  for (const row of rows) {
    const roleId = row.dataset.roleId;
    const checked = [...row.querySelectorAll("input:checked")].map(el => el.value);

    try {
      const res = await fetch("/api/skills/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId, skills: checked }),
      });
      const data = await res.json();
      if (data.ok) {
        applied++;
        if (lastResult) {
          const a = lastResult.assignments.find(x => x.roleId === roleId);
          if (a) a.skills = checked;
          const p = lastResult.prompts.find(x => x.roleId === roleId);
          if (p) p.skills = checked;
        }
      }
    } catch {}
  }

  skillsStatusEl.textContent = `Applied skills to ${applied} role(s)`;
  skillsStatusEl.className = "dispatch-status visible success";
  setTimeout(() => { skillsStatusEl.classList.remove("visible"); }, 2000);

  applySkillsBtn.textContent = "Apply Skills";
  applySkillsBtn.disabled = false;
});

// ── Tools panel ──
const toolsToggle = document.getElementById("tools-toggle");
const toolsBody = document.getElementById("tools-section");
const toolsHint = document.getElementById("tools-hint");
const applyToolsBtn = document.getElementById("apply-tools-btn");
const toolsSelectAllBtn = document.getElementById("tools-select-all-btn");
const toolsClearBtn = document.getElementById("tools-clear-btn");
const toolsStatus = document.getElementById("tools-status");

toolsToggle.addEventListener("click", () => {
  const open = toolsToggle.classList.toggle("open");
  toolsBody.style.display = open ? "block" : "none";
});

toolsSelectAllBtn.addEventListener("click", () => {
  document.querySelectorAll("#tools-assign-list input[type=checkbox]").forEach(cb => cb.checked = true);
});

toolsClearBtn.addEventListener("click", () => {
  document.querySelectorAll("#tools-assign-list input[type=checkbox]").forEach(cb => cb.checked = false);
});

async function renderToolsPanel(data) {
  const availableEl = document.getElementById("tools-available");
  const assignListEl = document.getElementById("tools-assign-list");

  let tools = [];
  let d = {};
  try {
    const res = await fetch("/api/tools");
    d = await res.json();
    if (d.ok) tools = d.tools || [];
  } catch {}

  // Update collapsed hint
  const totalAssigned = data.assignments.reduce((n, a) => n + (a.tools?.length || 0), 0);
  toolsHint.textContent = `${tools.length} available, ${totalAssigned} assigned`;

  if (tools.length === 0) {
    availableEl.innerHTML = `<div style="opacity:0.5;font-size:12px;font-family:var(--font-mono);">No tools available</div>`;
    assignListEl.innerHTML = "";
    return;
  }

  const categories = d.categories || {};
  const catNames = Object.keys(categories);

  // Available tools overview (collapsible drawers)
  if (catNames.length > 0) {
    availableEl.innerHTML = catNames.map(cat =>
      `<span class="skill-chip" title="${(categories[cat] || []).join(', ')}">${esc(cat)} (${(categories[cat] || []).length})</span>`
    ).join(" ");
  } else {
    availableEl.innerHTML = tools.map(t =>
      `<span class="skill-chip" title="${esc(t)}">${esc(t)}</span>`
    ).join(" ");
  }

  const aiRoles = data.assignments.filter(a => a.roleType === "ai");

  function renderToolCheckboxes(toolList, current) {
    if (catNames.length > 0) {
      return catNames.map(cat => {
        const catTools = (categories[cat] || []).filter(t => toolList.includes(t));
        if (catTools.length === 0) return "";
        const checkedCount = catTools.filter(t => current.includes(t)).length;
        return `<div class="tool-drawer">
          <div class="tool-drawer-header" onclick="this.parentElement.classList.toggle('open')">
            <span class="tool-drawer-arrow">&#9654;</span>
            <span class="tool-drawer-title">${esc(cat)}</span>
            <span class="tool-drawer-count">${checkedCount}/${catTools.length}</span>
          </div>
          <div class="tool-drawer-body">
            ${catTools.map(t => `<label class="checkbox-field" style="margin:0;">
              <input type="checkbox" value="${esc(t)}" ${current.includes(t) ? "checked" : ""}>
              <span style="font-family:var(--font-mono);font-size:11px;">${esc(t)}</span>
            </label>`).join("")}
          </div>
        </div>`;
      }).join("");
    }
    return toolList.map(t => `<label class="checkbox-field" style="margin:0;">
      <input type="checkbox" value="${esc(t)}" ${current.includes(t) ? "checked" : ""}>
      <span style="font-family:var(--font-mono);font-size:11px;">${esc(t)}</span>
    </label>`).join("");
  }

  assignListEl.innerHTML = aiRoles.map(a => {
    const current = a.tools || [];
    return `
    <div class="skill-assign-row" data-role-id="${esc(a.roleId)}">
      <span class="role-id ${a.roleKind === 'pm' ? 'ai' : a.roleType}">${esc(a.displayName || a.roleId)}</span>
      ${a.roleKind === "pm" ? `<span class="role-kind pm">PM</span>` : ""}
      <div class="tools-checkboxes" style="flex:1;">
        ${renderToolCheckboxes(tools, current)}
      </div>
    </div>`;
  }).join("");
}

applyToolsBtn.addEventListener("click", async () => {
  applyToolsBtn.disabled = true;
  applyToolsBtn.textContent = "Applying...";

  const rows = document.querySelectorAll("#tools-assign-list .skill-assign-row");
  let applied = 0;

  for (const row of rows) {
    const roleId = row.dataset.roleId;
    const checked = [...row.querySelectorAll("input:checked")].map(el => el.value);

    try {
      const res = await fetch("/api/tools/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId, tools: checked }),
      });
      const data = await res.json();
      if (data.ok) {
        applied++;
        if (lastResult) {
          const a = lastResult.assignments.find(x => x.roleId === roleId);
          if (a) a.tools = checked;
          const p = lastResult.prompts.find(x => x.roleId === roleId);
          if (p) p.tools = checked;
        }
      }
    } catch {}
  }

  toolsStatus.textContent = `Applied tools to ${applied} role(s)`;
  toolsStatus.className = "dispatch-status visible success";
  setTimeout(() => { toolsStatus.classList.remove("visible"); }, 2000);

  applyToolsBtn.textContent = "Apply Tools";
  applyToolsBtn.disabled = false;
});

// ── Helpers ──
function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.add("visible");
}

function hideError() {
  errorMsg.classList.remove("visible");
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

// ── Active Agents Panel ──
const activeAgentsList = document.getElementById("active-agents-list");
const syncAgentsBtn = document.getElementById("sync-agents-btn");

async function refreshActiveAgents() {
  try {
    const [agentsRes, statsRes] = await Promise.all([
      fetch("/api/agents").then(r => r.json()),
      fetch("/api/agents/stats").then(r => r.json()).catch(() => ({ stats: {} })),
    ]);

    const agents = (agentsRes.ok ? agentsRes.agents : []).filter(a => a.running);
    const stats = statsRes.stats || {};

    if (agents.length === 0) {
      activeAgentsList.innerHTML = '<span style="opacity:0.5;">No agents running</span>';
      return;
    }

    activeAgentsList.innerHTML = agents.map(a => {
      const s = stats[a.roleId] || stats[a.roleId?.toLowerCase()] || {};
      const tokens = (s.inputTokens || 0) + (s.outputTokens || 0);
      const tokenLabel = tokens > 0 ? `${(tokens / 1000).toFixed(1)}k tokens` : "";
      return `<div class="active-agent-card">
        <div class="active-agent-info">
          <span class="active-agent-name">${esc(a.roleId)}</span>
          <span class="active-agent-meta">pid ${a.pid}${tokenLabel ? " · " + tokenLabel : ""}</span>
        </div>
        <button class="btn btn-secondary active-agent-stop" onclick="stopActiveAgent('${esc(a.roleId)}')">stop</button>
      </div>`;
    }).join("");
  } catch {
    activeAgentsList.innerHTML = '<span style="opacity:0.5;">Failed to fetch agents</span>';
  }
}

window.stopActiveAgent = async function(roleId) {
  try {
    await fetch("/api/agents/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId }),
    });
    refreshActiveAgents();
  } catch {}
};

syncAgentsBtn?.addEventListener("click", refreshActiveAgents);

// Refresh on page load
refreshActiveAgents();
// Auto-refresh every 30s
setInterval(refreshActiveAgents, 30000);

// ── Create Agent (no evaluation) ──
const caForm = document.getElementById("create-agent-form");
const caToggle = document.getElementById("create-agent-toggle");
const caSubmit = document.getElementById("ca-submit");
const caCancel = document.getElementById("ca-cancel");
const caError = document.getElementById("ca-error");

let caSkillsLoaded = false;
let caToolsLoaded = false;

async function loadSkillChips() {
  if (caSkillsLoaded) return;
  const el = document.getElementById("ca-skills");
  try {
    const res = await fetch("/api/skills");
    const data = await res.json();
    if (!data.ok || !data.skills?.length) { el.innerHTML = '<span style="opacity:0.5">No skill files found</span>'; return; }
    el.innerHTML = data.skills.map(s =>
      `<span class="ca-chip" data-value="${esc(s.filename)}" title="${esc(s.title)}">${esc(s.filename.replace(/\.md$/, ""))}</span>`
    ).join("");
    el.addEventListener("click", e => { if (e.target.classList.contains("ca-chip")) e.target.classList.toggle("selected"); });
    caSkillsLoaded = true;
  } catch { el.innerHTML = '<span style="opacity:0.5">Failed to load skills</span>'; }
}

async function loadToolChips() {
  if (caToolsLoaded) return;
  const el = document.getElementById("ca-tools");
  try {
    const res = await fetch("/api/tools");
    const data = await res.json();
    if (!data.ok || !data.tools?.length) { el.innerHTML = '<span style="opacity:0.5">No tools found</span>'; return; }

    const categories = data.categories || {};
    const catNames = Object.keys(categories);

    if (catNames.length > 0) {
      el.innerHTML = catNames.map(cat => {
        const tools = categories[cat] || [];
        return `<div class="tool-drawer">
          <div class="tool-drawer-header" onclick="this.parentElement.classList.toggle('open')">
            <span class="tool-drawer-arrow">&#9654;</span>
            <span class="tool-drawer-title">${esc(cat)}</span>
            <span class="tool-drawer-count">${tools.length}</span>
          </div>
          <div class="tool-drawer-body">
            ${tools.map(t => `<span class="ca-chip" data-value="${esc(t)}">${esc(t)}</span>`).join("")}
          </div>
        </div>`;
      }).join("");
    } else {
      el.innerHTML = data.tools.map(t =>
        `<span class="ca-chip" data-value="${esc(t)}">${esc(t)}</span>`
      ).join("");
    }

    el.addEventListener("click", e => { if (e.target.classList.contains("ca-chip")) e.target.classList.toggle("selected"); });
    caToolsLoaded = true;
  } catch { el.innerHTML = '<span style="opacity:0.5">Failed to load tools</span>'; }
}

function getSelectedChips(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} .ca-chip.selected`)).map(el => el.dataset.value);
}

caToggle?.addEventListener("click", () => {
  const show = caForm.style.display === "none";
  caForm.style.display = show ? "" : "none";
  if (show) { loadSkillChips(); loadToolChips(); }
});
caCancel?.addEventListener("click", () => { caForm.style.display = "none"; });

caSubmit?.addEventListener("click", async () => {
  const name = document.getElementById("ca-name").value.trim();
  const role = document.getElementById("ca-role").value.trim();
  const focus = document.getElementById("ca-focus").value.trim();
  const preambleType = document.getElementById("ca-type").value;
  const agentModel = document.getElementById("ca-model").value.trim();

  if (!name || !role || !focus) {
    caError.textContent = "Name, role, and focus are required.";
    caError.classList.add("visible");
    return;
  }

  caSubmit.disabled = true;
  caSubmit.textContent = "Launching...";
  caError.classList.remove("visible");

  try {
    const skills = getSelectedChips("ca-skills");
    const tools = getSelectedChips("ca-tools");
    const body = { name, role, focus, preambleType };
    if (agentModel) body.model = agentModel;
    if (skills.length > 0) body.skills = skills;
    if (tools.length > 0) body.tools = tools;

    const res = await fetch("/api/agents/recruit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) {
      caError.textContent = `Launched ${data.displayName || name} (pid ${data.pid})`;
      caError.style.color = "var(--green, #22c55e)";
      caError.classList.add("visible");
      document.getElementById("ca-name").value = "";
      document.getElementById("ca-role").value = "";
      document.getElementById("ca-focus").value = "";
      refreshActiveAgents();
      setTimeout(() => { caError.classList.remove("visible"); caError.style.color = ""; }, 3000);
    } else {
      caError.textContent = data.errors?.join(", ") || "Failed";
      caError.classList.add("visible");
    }
  } catch (err) {
    caError.textContent = String(err);
    caError.classList.add("visible");
  } finally {
    caSubmit.disabled = false;
    caSubmit.textContent = "Create & Launch";
  }
});
