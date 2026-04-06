/**
 * Full dashboard HTML as template literal
 */

import { BACKENDS, STATUS } from "../lib/constants.js";
import { loadTheme, generateThemedCSS } from "../config/index.js";

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><!-- TITLE --></title>
  <style>/* THEMED_CSS */</style>
</head>
<body>
  <div class="app-layout">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <h2><!-- TITLE --></h2>
        <button class="sidebar-toggle" onclick="toggleSidebar()" title="Collapse sidebar">&laquo;</button>
      </div>

      <div class="sidebar-section">
        <button class="sidebar-item active" id="sidebarAll" onclick="selectView('all')">
          <span class="sidebar-item-name">All VMs</span>
          <span class="sidebar-item-count" id="allVmCount">0</span>
        </button>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header">
          <span>Groups</span>
          <button onclick="openGroupModal()" title="Create group">+</button>
        </div>
        <div id="sidebarGroups"></div>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-section-header"><span>Tags</span></div>
        <div id="sidebarTags"></div>
      </div>
    </aside>

    <button class="sidebar-toggle collapsed-toggle" id="sidebarExpand" onclick="toggleSidebar()" style="display:none" title="Expand sidebar">&raquo;</button>

    <div class="main-content">
      <h1><span class="ws-status" id="wsStatus">disconnected</span></h1>

      <div class="tab-bar">
        <button class="tab-btn active" onclick="switchTab('vms', this)">VMs</button>
        <button class="tab-btn" onclick="switchTab('files', this)">Files</button>
      </div>

      <div class="tab-panel active" id="tabVms">
        <div class="toolbar">
          <button class="toolbar-btn primary" onclick="openCreateModal()">Create VM</button>
          <button class="toolbar-btn" onclick="refreshVms()">Refresh</button>
          <div class="filter-group">
            <button class="filter-btn active" onclick="filterVms('all', this)">All</button>
            <button class="filter-btn" onclick="filterVms('${BACKENDS.FIRECRACKER}', this)">Firecracker</button>
            <button class="filter-btn" onclick="filterVms('${BACKENDS.QEMU}', this)">QEMU</button>
            <button class="filter-btn" onclick="filterVms('${BACKENDS.DOCKER_COMPOSE}', this)">Docker</button>
          </div>
        </div>

        <div id="bulkBar" style="display:none"></div>

        <div class="vm-grid" id="vmGrid">
          <div class="empty-state" id="emptyState">
            <p>No VMs provisioned yet</p>
            <button class="toolbar-btn primary" onclick="openCreateModal()">Create your first VM</button>
          </div>
        </div>
      </div>

      <div class="tab-panel" id="tabFiles">
        <div class="file-toolbar">
          <div class="file-breadcrumbs" id="fileBreadcrumbs"></div>
          <button class="toolbar-btn" onclick="browseUp()">Up</button>
          <button class="toolbar-btn" onclick="refreshBrowse()">Refresh</button>
        </div>
        <div class="file-list" id="fileList">
          <div class="file-list-empty">Select the Files tab to browse</div>
        </div>
        <div class="file-status-bar" id="fileStatusBar">
          <span id="fileItemCount">0 items</span>
          <span class="selected-path" id="fileSelectedPath"></span>
        </div>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="createModal">
    <div class="modal">
      <h2>Create VM</h2>
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="vmName" placeholder="my-vm">
      </div>
      <div class="form-group">
        <label>Backend</label>
        <select id="vmBackend" onchange="onBackendChange()">
          <option value="${BACKENDS.DOCKER_COMPOSE}">Docker Compose</option>
          <option value="${BACKENDS.QEMU}">QEMU</option>
          <option value="${BACKENDS.FIRECRACKER}">Firecracker</option>
        </select>
      </div>
      <div class="form-group">
        <label>Image</label>
        <select id="vmImage"><option value="">Loading images...</option></select>
      </div>
      <div class="form-group" id="kernelGroup" style="display:none">
        <label>Kernel (vmlinux) — leave blank to auto-detect</label>
        <select id="vmKernel"><option value="">Auto-detect</option></select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>vCPUs</label>
          <input type="number" id="vmVcpus" value="1" min="1" max="16">
        </div>
        <div class="form-group">
          <label>Memory (MB)</label>
          <input type="number" id="vmMemMb" value="256" min="64" step="64">
        </div>
      </div>
      <div class="form-group">
        <div class="checkbox-row">
          <input type="checkbox" id="vmPersistent">
          <label for="vmPersistent" style="margin-bottom:0; cursor:pointer;">Persistent (survives server restart)</label>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn" onclick="closeCreateModal()">Cancel</button>
        <button class="btn start-btn" onclick="submitCreate()">Create</button>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="groupModal">
    <div class="modal">
      <h2 id="groupModalTitle">Create Group</h2>
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="groupName" placeholder="Web Cluster">
      </div>
      <div class="form-group">
        <label>Color</label>
        <div class="color-options" id="groupColorPicker"></div>
      </div>
      <div class="modal-actions">
        <button class="btn" onclick="closeGroupModal()">Cancel</button>
        <button class="btn start-btn" id="groupModalSubmit" onclick="submitGroupModal()">Create</button>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="bulkCreateModal">
    <div class="modal">
      <h2>Bulk Create VMs</h2>
      <div class="form-group">
        <label>Count</label>
        <input type="number" id="bulkCount" value="3" min="1" max="50">
      </div>
      <div class="form-group">
        <label>Name prefix</label>
        <input type="text" id="bulkName" placeholder="worker">
      </div>
      <div class="form-group">
        <label>Backend</label>
        <select id="bulkBackend" onchange="onBulkBackendChange()">
          <option value="${BACKENDS.DOCKER_COMPOSE}">Docker Compose</option>
          <option value="${BACKENDS.QEMU}">QEMU</option>
          <option value="${BACKENDS.FIRECRACKER}">Firecracker</option>
        </select>
      </div>
      <div class="form-group">
        <label>Image</label>
        <select id="bulkImage"><option value="">Loading images...</option></select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>vCPUs</label>
          <input type="number" id="bulkVcpus" value="1" min="1" max="16">
        </div>
        <div class="form-group">
          <label>Memory (MB)</label>
          <input type="number" id="bulkMemMb" value="256" min="64" step="64">
        </div>
      </div>
      <div class="form-group">
        <div class="checkbox-row">
          <input type="checkbox" id="bulkPersistent">
          <label for="bulkPersistent" style="margin-bottom:0; cursor:pointer;">Persistent</label>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn" onclick="closeBulkCreateModal()">Cancel</button>
        <button class="btn start-btn" onclick="submitBulkCreate()">Create</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const GROUP_COLORS = ["#3b82f6","#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899","#6366f1"];
    let vms = {};
    let stats = {};
    let images = [];
    let groups = [];
    let activeFilter = "all";
    let selectedView = { type: "all" };
    let ws = null;
    let wsReconnectTimer = null;
    let currentBrowsePath = "/";
    let browseData = null;
    let selectedFilePath = null;
    let filesTabLoaded = false;
    let editingGroupId = null;
    let bulkCreateGroupId = null;

    // --- API ---
    async function api(method, path, body) {
      const opts = { method, headers: { "Content-Type": "application/json" } };
      if (body) opts.body = JSON.stringify(body);
      const resp = await fetch(path, opts);
      return resp.json();
    }

    async function refreshVms() {
      const result = await api("GET", "/api/vms");
      if (result.success) {
        vms = {};
        for (const vm of result.data) vms[vm.id] = vm;
        render();
        renderSidebar();
      }
    }

    async function refreshGroups() {
      const result = await api("GET", "/api/groups");
      if (result.success) {
        groups = result.data;
        renderSidebar();
        renderBulkBar();
      }
    }

    async function loadImages() {
      const result = await api("GET", "/api/images");
      if (result.success) {
        images = result.data;
        populateImageDropdown();
      }
    }

    // --- WebSocket ---
    function connectWs() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(proto + "//" + location.host + "/ws");
      ws.onopen = () => {
        document.getElementById("wsStatus").textContent = "connected";
        document.getElementById("wsStatus").classList.add("connected");
        if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
      };
      ws.onclose = () => {
        document.getElementById("wsStatus").textContent = "disconnected";
        document.getElementById("wsStatus").classList.remove("connected");
        wsReconnectTimer = setTimeout(connectWs, 3000);
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === "stats") {
          stats = { ...stats, ...msg.data };
          render();
        } else if (msg.type === "vm_created" || msg.type === "vm_started" || msg.type === "vm_stopped" || msg.type === "vm_tags_updated") {
          if (msg.data.vm) vms[msg.data.vmId] = msg.data.vm;
          render();
          renderSidebar();
        } else if (msg.type === "vm_deleted") {
          delete vms[msg.data.vmId];
          delete stats[msg.data.vmId];
          render();
          renderSidebar();
        }
      };
    }

    // --- Sidebar ---
    function renderSidebar() {
      // All VMs count
      document.getElementById("allVmCount").textContent = Object.keys(vms).length;

      // Groups
      const groupsEl = document.getElementById("sidebarGroups");
      if (groups.length === 0) {
        groupsEl.innerHTML = '<div style="padding:4px 14px;font-size:11px;color:#666">No groups yet</div>';
      } else {
        groupsEl.innerHTML = groups.map(g => {
          const count = g.vmIds.filter(id => vms[id]).length;
          const isActive = selectedView.type === "group" && selectedView.id === g.id;
          return '<button class="sidebar-item' + (isActive ? ' active' : '') + '" onclick="selectView(\\'group\\',\\'' + g.id + '\\')">' +
            '<span class="sidebar-color-dot" style="background:' + esc(g.color) + '"></span>' +
            '<span class="sidebar-item-name">' + esc(g.name) + '</span>' +
            '<span class="sidebar-item-count">' + count + '</span>' +
            '<span class="sidebar-item-menu" onclick="event.stopPropagation();showGroupMenu(event,\\'' + g.id + '\\')">...</span>' +
          '</button>';
        }).join("");
      }

      // Tags - auto-generate from all VMs
      const tagMap = {};
      for (const vm of Object.values(vms)) {
        if (vm.tags) {
          for (const tag of vm.tags) {
            tagMap[tag] = (tagMap[tag] || 0) + 1;
          }
        }
      }
      const tagsEl = document.getElementById("sidebarTags");
      const tagNames = Object.keys(tagMap).sort();
      if (tagNames.length === 0) {
        tagsEl.innerHTML = '<div style="padding:4px 14px;font-size:11px;color:#666">No tags yet</div>';
      } else {
        tagsEl.innerHTML = tagNames.map(tag => {
          const isActive = selectedView.type === "tag" && selectedView.id === tag;
          return '<button class="sidebar-item' + (isActive ? ' active' : '') + '" onclick="selectView(\\'tag\\',\\'' + esc(tag) + '\\')">' +
            '<span class="sidebar-item-name">#' + esc(tag) + '</span>' +
            '<span class="sidebar-item-count">' + tagMap[tag] + '</span>' +
          '</button>';
        }).join("");
      }

      // Highlight active sidebar item
      document.getElementById("sidebarAll").classList.toggle("active", selectedView.type === "all");
    }

    function selectView(type, id) {
      selectedView = { type, id };
      renderSidebar();
      render();
      renderBulkBar();
      closeAnyPopover();
    }

    function toggleSidebar() {
      const sb = document.getElementById("sidebar");
      const expandBtn = document.getElementById("sidebarExpand");
      sb.classList.toggle("collapsed");
      expandBtn.style.display = sb.classList.contains("collapsed") ? "" : "none";
    }

    // --- Bulk Bar ---
    function renderBulkBar() {
      const bar = document.getElementById("bulkBar");
      if (selectedView.type !== "group") {
        bar.style.display = "none";
        return;
      }
      const group = groups.find(g => g.id === selectedView.id);
      if (!group) { bar.style.display = "none"; return; }

      bar.style.display = "flex";
      bar.className = "bulk-bar";
      bar.innerHTML = '<span class="bulk-bar-title">' + esc(group.name) + ' (' + group.vmIds.filter(id => vms[id]).length + ' VMs)</span>' +
        '<button class="btn start-btn" onclick="bulkStart(\\'' + group.id + '\\')">Start All</button>' +
        '<button class="btn stop-btn" onclick="bulkStop(\\'' + group.id + '\\')">Stop All</button>' +
        '<button class="btn destroy-btn" onclick="bulkDestroy(\\'' + group.id + '\\')">Destroy All</button>' +
        '<button class="btn" onclick="openBulkCreate(\\'' + group.id + '\\')">Bulk Create</button>';
    }

    async function bulkStart(groupId) {
      const r = await api("POST", "/api/groups/" + groupId + "/start");
      if (r.success) {
        showToast("Starting VMs...", "success");
        await refreshVms();
        await refreshGroups();
      } else {
        showToast(r.error || "Bulk start failed", "error");
      }
    }

    async function bulkStop(groupId) {
      const r = await api("POST", "/api/groups/" + groupId + "/stop");
      if (r.success) {
        showToast("Stopping VMs...", "success");
        await refreshVms();
        await refreshGroups();
      } else {
        showToast(r.error || "Bulk stop failed", "error");
      }
    }

    async function bulkDestroy(groupId) {
      const group = groups.find(g => g.id === groupId);
      if (!group) return;
      if (!confirm("Destroy all " + group.vmIds.length + " VMs in " + group.name + "?")) return;
      const r = await api("POST", "/api/groups/" + groupId + "/destroy");
      if (r.success) {
        showToast("VMs destroyed", "success");
        await refreshVms();
        await refreshGroups();
      } else {
        showToast(r.error || "Bulk destroy failed", "error");
      }
    }

    function openBulkCreate(groupId) {
      bulkCreateGroupId = groupId;
      document.getElementById("bulkCreateModal").classList.add("open");
      loadImages().then(() => onBulkBackendChange());
    }

    function closeBulkCreateModal() {
      document.getElementById("bulkCreateModal").classList.remove("open");
      bulkCreateGroupId = null;
    }

    function onBulkBackendChange() {
      const backend = document.getElementById("bulkBackend").value;
      const sel = document.getElementById("bulkImage");
      const filtered = images.filter(img => img.backends.includes(backend));
      if (filtered.length === 0) {
        sel.innerHTML = '<option value="">No images found for ' + esc(backend) + '</option>';
      } else {
        sel.innerHTML = filtered.map(img =>
          '<option value="' + esc(img.path) + '">' + esc(img.filename) + ' (' + fmtBytes(img.size) + ')</option>'
        ).join("");
      }
    }

    async function submitBulkCreate() {
      const count = parseInt(document.getElementById("bulkCount").value) || 3;
      const name = document.getElementById("bulkName").value.trim();
      const backend = document.getElementById("bulkBackend").value;
      const imagePath = document.getElementById("bulkImage").value;
      const vcpus = parseInt(document.getElementById("bulkVcpus").value) || 1;
      const memMb = parseInt(document.getElementById("bulkMemMb").value) || 256;
      const persistent = document.getElementById("bulkPersistent").checked;
      if (!name) { showToast("Name prefix is required", "error"); return; }
      if (!imagePath) { showToast("Select an image", "error"); return; }
      const r = await api("POST", "/api/groups/" + bulkCreateGroupId + "/create", {
        count,
        template: { name, backend, imagePath, vcpus, memMb, persistent }
      });
      if (r.success) {
        showToast(count + " VMs created", "success");
        closeBulkCreateModal();
        await refreshVms();
        await refreshGroups();
      } else {
        showToast(r.error || "Bulk create failed", "error");
      }
    }

    // --- Group CRUD ---
    function openGroupModal(editId) {
      editingGroupId = editId || null;
      const modal = document.getElementById("groupModal");
      const titleEl = document.getElementById("groupModalTitle");
      const submitBtn = document.getElementById("groupModalSubmit");
      const nameInput = document.getElementById("groupName");

      if (editId) {
        const g = groups.find(g => g.id === editId);
        titleEl.textContent = "Rename Group";
        submitBtn.textContent = "Save";
        nameInput.value = g ? g.name : "";
        renderColorPicker(g ? g.color : GROUP_COLORS[0]);
      } else {
        titleEl.textContent = "Create Group";
        submitBtn.textContent = "Create";
        nameInput.value = "";
        renderColorPicker(GROUP_COLORS[groups.length % GROUP_COLORS.length]);
      }
      modal.classList.add("open");
      nameInput.focus();
    }

    function closeGroupModal() {
      document.getElementById("groupModal").classList.remove("open");
      editingGroupId = null;
    }

    function renderColorPicker(activeColor) {
      const el = document.getElementById("groupColorPicker");
      el.innerHTML = GROUP_COLORS.map(c =>
        '<button class="color-swatch' + (c === activeColor ? ' active' : '') + '" style="background:' + c + '" onclick="pickColor(this,\\'' + c + '\\')" type="button"></button>'
      ).join("");
      el.dataset.selected = activeColor;
    }

    function pickColor(btn, color) {
      document.querySelectorAll("#groupColorPicker .color-swatch").forEach(s => s.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("groupColorPicker").dataset.selected = color;
    }

    async function submitGroupModal() {
      const name = document.getElementById("groupName").value.trim();
      const color = document.getElementById("groupColorPicker").dataset.selected;
      if (!name) { showToast("Name is required", "error"); return; }

      if (editingGroupId) {
        const r = await api("PUT", "/api/groups/" + editingGroupId, { name, color });
        if (r.success) { showToast("Group updated", "success"); }
        else { showToast(r.error || "Update failed", "error"); }
      } else {
        const r = await api("POST", "/api/groups", { name, color });
        if (r.success) { showToast("Group created", "success"); }
        else { showToast(r.error || "Create failed", "error"); }
      }
      closeGroupModal();
      await refreshGroups();
    }

    async function deleteGroup(id) {
      const g = groups.find(g => g.id === id);
      if (!g) return;
      if (!confirm("Delete group '" + g.name + "'? VMs will not be affected.")) return;
      const r = await api("DELETE", "/api/groups/" + id);
      if (r.success) {
        showToast("Group deleted", "success");
        if (selectedView.type === "group" && selectedView.id === id) selectView("all");
        await refreshGroups();
      } else {
        showToast(r.error || "Delete failed", "error");
      }
    }

    // --- Context Menus ---
    function showGroupMenu(ev, groupId) {
      closeAnyPopover();
      const menu = document.createElement("div");
      menu.className = "ctx-menu";
      menu.id = "ctxMenu";
      menu.style.left = ev.clientX + "px";
      menu.style.top = ev.clientY + "px";
      menu.innerHTML =
        '<button class="ctx-menu-item" onclick="openGroupModal(\\'' + groupId + '\\');closeAnyPopover()">Rename</button>' +
        '<div class="ctx-menu-sep"></div>' +
        '<button class="ctx-menu-item danger" onclick="deleteGroup(\\'' + groupId + '\\');closeAnyPopover()">Delete Group</button>';
      document.body.appendChild(menu);
      // Ensure menu doesn't go off-screen
      requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + "px";
        if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + "px";
      });
      ev.preventDefault();
    }

    function showAssignMenu(ev, vmId) {
      closeAnyPopover();
      const menu = document.createElement("div");
      menu.className = "ctx-menu";
      menu.id = "ctxMenu";
      menu.style.left = ev.clientX + "px";
      menu.style.top = ev.clientY + "px";

      let html = '<div style="padding:4px 14px;font-size:11px;color:#888;text-transform:uppercase">Assign to Group</div>';
      if (groups.length === 0) {
        html += '<div style="padding:6px 14px;font-size:13px;color:#666">No groups — create one first</div>';
      } else {
        for (const g of groups) {
          const inGroup = g.vmIds.includes(vmId);
          html += '<button class="ctx-menu-item" onclick="toggleVmGroup(\\'' + vmId + '\\',\\'' + g.id + '\\',' + inGroup + ');closeAnyPopover()">' +
            (inGroup ? '\\u2713 ' : '') + esc(g.name) + '</button>';
        }
      }
      menu.innerHTML = html;
      document.body.appendChild(menu);
      requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + "px";
        if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + "px";
      });
      ev.preventDefault();
      ev.stopPropagation();
    }

    async function toggleVmGroup(vmId, groupId, currentlyIn) {
      if (currentlyIn) {
        await api("DELETE", "/api/groups/" + groupId + "/vms", { vmIds: [vmId] });
      } else {
        await api("POST", "/api/groups/" + groupId + "/vms", { vmIds: [vmId] });
      }
      await refreshGroups();
    }

    function closeAnyPopover() {
      const m = document.getElementById("ctxMenu");
      if (m) m.remove();
      const p = document.getElementById("tagPopover");
      if (p) p.remove();
    }

    document.addEventListener("click", (ev) => {
      const ctx = document.getElementById("ctxMenu");
      if (ctx && !ctx.contains(ev.target)) ctx.remove();
      const tp = document.getElementById("tagPopover");
      if (tp && !tp.contains(ev.target) && !ev.target.classList.contains("vm-meta-btn")) tp.remove();
    });

    // --- Tags ---
    function showTagEditor(ev, vmId) {
      closeAnyPopover();
      const vm = vms[vmId];
      if (!vm) return;

      const popover = document.createElement("div");
      popover.className = "tag-popover";
      popover.id = "tagPopover";
      popover.style.left = ev.clientX + "px";
      popover.style.top = ev.clientY + "px";

      const currentTags = vm.tags || [];
      popover.innerHTML =
        '<input type="text" id="tagInput" placeholder="Add tag, press Enter" onkeydown="onTagKeydown(event,\\'' + vmId + '\\')">' +
        '<div class="tag-popover-chips" id="tagChips">' +
          currentTags.map(t => '<span class="tag-chip removable" onclick="removeTag(\\'' + vmId + '\\',\\'' + esc(t) + '\\')">' + esc(t) + ' \\u00d7</span>').join("") +
        '</div>';

      document.body.appendChild(popover);
      requestAnimationFrame(() => {
        const rect = popover.getBoundingClientRect();
        if (rect.right > window.innerWidth) popover.style.left = (window.innerWidth - rect.width - 8) + "px";
        if (rect.bottom > window.innerHeight) popover.style.top = (window.innerHeight - rect.height - 8) + "px";
        document.getElementById("tagInput").focus();
      });
      ev.preventDefault();
      ev.stopPropagation();
    }

    async function onTagKeydown(ev, vmId) {
      if (ev.key !== "Enter") return;
      const input = document.getElementById("tagInput");
      const tag = input.value.trim();
      if (!tag) return;
      input.value = "";
      const vm = vms[vmId];
      if (!vm) return;
      const tags = [...(vm.tags || [])];
      if (!tags.includes(tag)) tags.push(tag);
      await setVmTags(vmId, tags);
    }

    async function removeTag(vmId, tag) {
      const vm = vms[vmId];
      if (!vm) return;
      const tags = (vm.tags || []).filter(t => t !== tag);
      await setVmTags(vmId, tags);
    }

    async function setVmTags(vmId, tags) {
      const r = await api("PUT", "/api/vms/" + vmId + "/tags", { tags });
      if (r.success && r.data) {
        vms[vmId] = r.data;
        render();
        renderSidebar();
        // Refresh tag popover if open
        const popover = document.getElementById("tagPopover");
        if (popover) {
          const chips = document.getElementById("tagChips");
          if (chips) {
            chips.innerHTML = tags.map(t => '<span class="tag-chip removable" onclick="removeTag(\\'' + vmId + '\\',\\'' + esc(t) + '\\')">' + esc(t) + ' \\u00d7</span>').join("");
          }
        }
      }
    }

    // --- Render ---
    function render() {
      const grid = document.getElementById("vmGrid");
      let entries = Object.values(vms);

      // Filter by backend
      if (activeFilter !== "all") {
        entries = entries.filter(vm => vm.backend === activeFilter);
      }

      // Filter by sidebar view
      if (selectedView.type === "group") {
        const group = groups.find(g => g.id === selectedView.id);
        if (group) {
          const idSet = new Set(group.vmIds);
          entries = entries.filter(vm => idSet.has(vm.id));
        }
      } else if (selectedView.type === "tag") {
        entries = entries.filter(vm => vm.tags && vm.tags.includes(selectedView.id));
      }

      if (entries.length === 0) {
        let msg = "No VMs provisioned yet";
        if (selectedView.type === "group") msg = "No VMs in this group";
        else if (selectedView.type === "tag") msg = "No VMs with this tag";
        else if (activeFilter !== "all") msg = "No VMs matching filter";
        grid.innerHTML = '<div class="empty-state"><p>' + msg + '</p></div>';
        return;
      }

      grid.innerHTML = entries.map(vm => {
        const s = stats[vm.id] || {};
        const isRunning = vm.status === "${STATUS.RUNNING}";
        const canStart = vm.status === "${STATUS.CREATED}" || vm.status === "${STATUS.STOPPED}" || vm.status === "${STATUS.ERROR}";
        const canStop = vm.status === "${STATUS.RUNNING}" || vm.status === "${STATUS.STARTING}";
        const tagChips = (vm.tags || []).map(t => '<span class="tag-chip">' + esc(t) + '</span>').join("");
        return '<div class="vm-card" data-id="' + vm.id + '">' +
          '<div class="vm-card-header">' +
            '<span class="status-dot ' + vm.status + '"></span>' +
            '<span class="vm-name">' + esc(vm.name) + '</span>' +
            '<span class="badge ' + vm.backend + '">' + esc(vm.backend) + '</span>' +
          '</div>' +
          (tagChips ? '<div class="vm-tags">' + tagChips + '</div>' : '') +
          '<div class="vm-meta-actions">' +
            '<button class="vm-meta-btn" onclick="showAssignMenu(event,\\'' + vm.id + '\\')">+ Group</button>' +
            '<button class="vm-meta-btn" onclick="showTagEditor(event,\\'' + vm.id + '\\')">+ Tag</button>' +
          '</div>' +
          '<div class="vm-stats">' +
            '<div class="vm-stats-row"><span class="vm-stats-label">Status</span><span>' + vm.status + '</span></div>' +
            '<div class="vm-stats-row"><span class="vm-stats-label">vCPUs / Mem</span><span>' + vm.vcpus + ' / ' + vm.memMb + ' MB</span></div>' +
            '<div class="vm-stats-row"><span class="vm-stats-label">Network I/O</span><span>' + fmtBytes(s.networkRxBytes) + ' / ' + fmtBytes(s.networkTxBytes) + '</span></div>' +
            '<div class="vm-stats-row"><span class="vm-stats-label">IP</span><span>' + (s.ip || "-") + '</span></div>' +
            '<div class="vm-stats-row"><span class="vm-stats-label">Uptime</span><span>' + fmtUptime(s.uptimeMs) + '</span></div>' +
          '</div>' +
          '<div class="vm-actions">' +
            '<button class="btn start-btn" onclick="startVm(\\''+vm.id+'\\') "' + (canStart ? "" : " disabled") + '>Start</button>' +
            '<button class="btn stop-btn" onclick="stopVm(\\''+vm.id+'\\') "' + (canStop ? "" : " disabled") + '>Stop</button>' +
            '<button class="btn destroy-btn" onclick="destroyVm(\\''+vm.id+'\\')">Destroy</button>' +
            (vm.persistent ? '<span class="btn persist-badge">persistent</span>' : '') +
          '</div>' +
        '</div>';
      }).join("");
    }

    // --- Actions ---
    async function startVm(id) {
      const r = await api("POST", "/api/vms/" + id + "/start");
      if (r.success && r.data) { vms[id] = r.data; render(); }
      else showToast(r.error || "Start failed", "error");
    }
    async function stopVm(id) {
      const r = await api("POST", "/api/vms/" + id + "/stop");
      if (r.success && r.data) { vms[id] = r.data; render(); }
      else showToast(r.error || "Stop failed", "error");
    }
    async function destroyVm(id) {
      if (!confirm("Destroy this VM?")) return;
      const r = await api("DELETE", "/api/vms/" + id);
      if (r.success) { delete vms[id]; delete stats[id]; render(); renderSidebar(); showToast("VM destroyed", "success"); }
      else showToast(r.error || "Destroy failed", "error");
    }

    // --- Create Modal ---
    function openCreateModal() {
      document.getElementById("createModal").classList.add("open");
      loadImages();
    }
    function closeCreateModal() {
      document.getElementById("createModal").classList.remove("open");
    }
    function onBackendChange() {
      populateImageDropdown();
      const backend = document.getElementById("vmBackend").value;
      const kernelGroup = document.getElementById("kernelGroup");
      kernelGroup.style.display = backend === "${BACKENDS.FIRECRACKER}" ? "" : "none";
      if (backend === "${BACKENDS.FIRECRACKER}") populateKernelDropdown();
    }
    function populateImageDropdown() {
      const backend = document.getElementById("vmBackend").value;
      const sel = document.getElementById("vmImage");
      const filtered = images.filter(img => img.backends.includes(backend));
      if (filtered.length === 0) {
        sel.innerHTML = '<option value="">No images found for ' + esc(backend) + '</option>';
      } else {
        sel.innerHTML = filtered.map(img =>
          '<option value="' + esc(img.path) + '">' + esc(img.filename) + ' (' + fmtBytes(img.size) + ')</option>'
        ).join("");
      }
    }
    function populateKernelDropdown() {
      const sel = document.getElementById("vmKernel");
      const kernels = images.filter(img => img.filename.endsWith("vmlinux"));
      sel.innerHTML = '<option value="">Auto-detect</option>' +
        kernels.map(img =>
          '<option value="' + esc(img.path) + '">' + esc(img.filename) + '</option>'
        ).join("");
    }
    async function submitCreate() {
      const name = document.getElementById("vmName").value.trim();
      const backend = document.getElementById("vmBackend").value;
      const imagePath = document.getElementById("vmImage").value;
      const vcpus = parseInt(document.getElementById("vmVcpus").value) || 1;
      const memMb = parseInt(document.getElementById("vmMemMb").value) || 256;
      const persistent = document.getElementById("vmPersistent").checked;
      if (!name) { showToast("Name is required", "error"); return; }
      if (!imagePath) { showToast("Select an image", "error"); return; }
      const config = {};
      if (backend === "${BACKENDS.FIRECRACKER}") {
        const kernelPath = document.getElementById("vmKernel").value;
        if (kernelPath) config.kernelPath = kernelPath;
      }
      const r = await api("POST", "/api/vms", { name, backend, imagePath, vcpus, memMb, persistent, config });
      if (r.success) {
        vms[r.data.id] = r.data;
        render();
        renderSidebar();
        closeCreateModal();
        showToast("VM created", "success");
      } else {
        showToast(r.error || "Create failed", "error");
      }
    }

    // --- Filtering ---
    function filterVms(filter, btn) {
      activeFilter = filter;
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");
      render();
    }

    // --- Helpers ---
    function esc(s) { const d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }
    function fmtBytes(b) {
      if (!b) return "0 B";
      const units = ["B", "KB", "MB", "GB", "TB"];
      let i = 0;
      let v = b;
      while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
      return v.toFixed(i > 0 ? 1 : 0) + " " + units[i];
    }
    function fmtUptime(ms) {
      if (!ms) return "-";
      const s = Math.floor(ms / 1000);
      if (s < 60) return s + "s";
      const m = Math.floor(s / 60);
      if (m < 60) return m + "m " + (s % 60) + "s";
      const h = Math.floor(m / 60);
      if (h < 24) return h + "h " + (m % 60) + "m";
      return Math.floor(h / 24) + "d " + (h % 24) + "h";
    }
    function showToast(msg, type) {
      const t = document.getElementById("toast");
      t.textContent = msg;
      t.className = "toast " + (type || "") + " show";
      setTimeout(() => { t.classList.remove("show"); }, 3000);
    }

    // --- Tabs ---
    function switchTab(tab, btn) {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      if (btn) btn.classList.add("active");
      if (tab === "vms") {
        document.getElementById("tabVms").classList.add("active");
      } else if (tab === "files") {
        document.getElementById("tabFiles").classList.add("active");
        if (!filesTabLoaded) { filesTabLoaded = true; browseTo("/"); }
      }
    }

    // --- File Browser ---
    async function browseTo(dirPath) {
      currentBrowsePath = dirPath;
      selectedFilePath = null;
      const fileList = document.getElementById("fileList");
      fileList.innerHTML = '<div class="file-list-empty">Loading...</div>';
      try {
        const result = await api("GET", "/api/browse?path=" + encodeURIComponent(dirPath));
        if (!result.success) {
          fileList.innerHTML = '<div class="file-list-empty">' + esc(result.error || "Failed to load") + '</div>';
          return;
        }
        browseData = result.data;
        currentBrowsePath = browseData.path;
        renderBreadcrumbs(browseData.path);
        renderFileList(browseData.entries);
        renderFileStatusBar();
      } catch (err) {
        fileList.innerHTML = '<div class="file-list-empty">Error: ' + esc(err.message) + '</div>';
      }
    }

    function browseUp() {
      if (browseData && browseData.parent) browseTo(browseData.parent);
    }

    function refreshBrowse() {
      browseTo(currentBrowsePath);
    }

    function renderBreadcrumbs(fullPath) {
      const el = document.getElementById("fileBreadcrumbs");
      const parts = fullPath.split("/").filter(Boolean);
      let html = '<button class="breadcrumb-item" onclick="browseTo(\\'/\\')">/</button>';
      let accumulated = "";
      for (let i = 0; i < parts.length; i++) {
        accumulated += "/" + parts[i];
        const p = accumulated;
        html += '<span class="breadcrumb-sep">/</span>';
        html += '<button class="breadcrumb-item" onclick="browseTo(\\'' + esc(p) + '\\')">' + esc(parts[i]) + '</button>';
      }
      el.innerHTML = html;
    }

    function renderFileList(entries) {
      const el = document.getElementById("fileList");
      if (!entries || entries.length === 0) {
        el.innerHTML = '<div class="file-list-empty">Empty directory</div>';
        return;
      }
      el.innerHTML = entries.map(entry => {
        const icon = entry.isDirectory ? "\\u{1F4C1}" : getFileIcon(entry.ext);
        const size = entry.isDirectory ? "\\u2014" : fmtBytes(entry.size);
        const modified = fmtDate(entry.modified);
        return '<div class="file-row" data-path="' + esc(entry.path) + '" data-dir="' + entry.isDirectory + '" onclick="onFileClick(this)">' +
          '<span class="file-icon">' + icon + '</span>' +
          '<span class="file-name">' + esc(entry.name) + '</span>' +
          '<span class="file-size">' + size + '</span>' +
          '<span class="file-modified">' + modified + '</span>' +
        '</div>';
      }).join("");
    }

    function renderFileStatusBar() {
      const count = browseData ? browseData.entries.length : 0;
      document.getElementById("fileItemCount").textContent = count + " item" + (count !== 1 ? "s" : "");
      const pathEl = document.getElementById("fileSelectedPath");
      const bar = document.getElementById("fileStatusBar");
      // Remove old action buttons
      bar.querySelectorAll(".file-action-btn").forEach(b => b.remove());
      if (selectedFilePath) {
        pathEl.textContent = selectedFilePath;
        const copyBtn = document.createElement("button");
        copyBtn.className = "btn file-action-btn";
        copyBtn.textContent = "Copy Path";
        copyBtn.onclick = () => { navigator.clipboard.writeText(selectedFilePath); showToast("Path copied", "success"); };
        bar.appendChild(copyBtn);
        const imgBtn = document.createElement("button");
        imgBtn.className = "btn start-btn file-action-btn";
        imgBtn.textContent = "Use as Image";
        imgBtn.onclick = () => useFileAs("image");
        bar.appendChild(imgBtn);
        const kernBtn = document.createElement("button");
        kernBtn.className = "btn file-action-btn";
        kernBtn.textContent = "Use as Kernel";
        kernBtn.onclick = () => useFileAs("kernel");
        bar.appendChild(kernBtn);
      } else {
        pathEl.textContent = "";
      }
    }

    function onFileClick(row) {
      const path = row.dataset.path;
      const isDir = row.dataset.dir === "true";
      if (isDir) {
        browseTo(path);
      } else {
        document.querySelectorAll(".file-row.selected").forEach(r => r.classList.remove("selected"));
        row.classList.add("selected");
        selectedFilePath = path;
        renderFileStatusBar();
      }
    }

    function useFileAs(target) {
      // Switch to VMs tab
      const vmTab = document.querySelector('.tab-btn');
      switchTab("vms", vmTab);
      openCreateModal();
      setTimeout(() => {
        const sel = target === "kernel" ? document.getElementById("vmKernel") : document.getElementById("vmImage");
        // Add custom option if not present
        let opt = sel.querySelector('option[value="' + CSS.escape(selectedFilePath) + '"]');
        if (!opt) {
          opt = document.createElement("option");
          opt.value = selectedFilePath;
          const parts = selectedFilePath.split("/");
          opt.textContent = parts[parts.length - 1] + " (custom)";
          sel.appendChild(opt);
        }
        sel.value = selectedFilePath;
        if (target === "kernel") {
          document.getElementById("vmBackend").value = "${BACKENDS.FIRECRACKER}";
          onBackendChange();
          // Re-add custom kernel option after dropdown rebuild
          setTimeout(() => {
            let kopt = sel.querySelector('option[value="' + CSS.escape(selectedFilePath) + '"]');
            if (!kopt) {
              kopt = document.createElement("option");
              kopt.value = selectedFilePath;
              const kparts = selectedFilePath.split("/");
              kopt.textContent = kparts[kparts.length - 1] + " (custom)";
              sel.appendChild(kopt);
            }
            sel.value = selectedFilePath;
          }, 50);
        }
      }, 100);
    }

    function getFileIcon(ext) {
      if (!ext) return "\\u{1F4C4}";
      const icons = { ".img": "\\u{1F4BF}", ".qcow2": "\\u{1F4BF}", ".iso": "\\u{1F4BF}", ".raw": "\\u{1F4BF}", ".yml": "\\u{2699}", ".yaml": "\\u{2699}", ".toml": "\\u{2699}", ".json": "\\u{2699}", ".conf": "\\u{2699}", ".sh": "\\u{1F4DC}", ".log": "\\u{1F4DD}", ".tar": "\\u{1F4E6}", ".gz": "\\u{1F4E6}", ".zip": "\\u{1F4E6}" };
      return icons[ext] || "\\u{1F4C4}";
    }

    function fmtDate(iso) {
      if (!iso) return "\\u2014";
      const d = new Date(iso);
      const pad = n => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }

    // --- Init ---
    refreshVms();
    refreshGroups();
    connectWs();
  </script>
</body>
</html>`;

// Generate HTML with theme applied
export function getThemedHTML() {
  const theme = loadTheme();
  const css = generateThemedCSS(theme);
  const title = theme.general?.title || "VM Provisioner";
  return HTML_TEMPLATE
    .replace("/* THEMED_CSS */", css)
    .replaceAll("<!-- TITLE -->", title);
}
