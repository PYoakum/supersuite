// public/views/managementView.js — Right panel: Overview, Relations, Label, History
import { api } from '../api.js';
import { on, getState, getSelectedDevice, getDeviceLinks, setState } from '../state.js';
import { toast } from '../ui/toast.js';
import { renderBarcode } from '../barcode/barcode.js';

const CATEGORIES = ['it_device','hardware','appliance','software','service','asset'];
const STATUSES   = ['active','spare','retired','broken','unknown'];
const LINK_TYPES = ['connected_to','depends_on','uplink','vpn','logical'];

let currentTab = 'overview';

export function initManagementView() {
  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      currentTab = tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderPanel();
    });
  });

  on('selectedDeviceId', () => renderPanel());
  on('devices', () => renderPanel());
  on('selectedLocationId', () => {
    if (!getState().selectedLocationId) {
      showEmpty();
    }
  });

  // Label modal
  document.getElementById('btn-close-label').addEventListener('click', () => {
    document.getElementById('label-modal').classList.remove('open');
  });
  document.getElementById('btn-print-label').addEventListener('click', () => window.print());

  // Add device button
  document.getElementById('btn-add-device').addEventListener('click', () => showAddDeviceForm());
}

function renderPanel() {
  const device = getSelectedDevice();
  if (!device) { showEmpty(); return; }

  switch (currentTab) {
    case 'overview':    renderOverview(device); break;
    case 'relations':   renderRelations(device); break;
    case 'label':       renderLabel(device); break;
    case 'history':     renderHistory(device); break;
  }
}

function showEmpty() {
  const content = document.getElementById('panel-content');
  const locId = getState().selectedLocationId;
  content.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">${locId ? '↙' : '⬡'}</div>
      <div>${locId ? 'Click a node on the map to inspect a device' : 'Select a location to view its network map'}</div>
    </div>`;
}

// ── Overview tab ───────────────────────────────────────────────────────────────

function renderOverview(device) {
  const fields = getState().fields;
  const extraFields = getExtraFields(fields, device.category);
  let extra = {};
  try { extra = JSON.parse(device.extra_fields || '{}'); } catch {}

  const content = document.getElementById('panel-content');
  content.innerHTML = `
    <div class="section-header">Identity</div>
    <div class="field-row">
      <div class="field-group">
        <label>Name</label>
        <input type="text" id="f-name" value="${esc(device.name)}">
      </div>
      <div class="field-group">
        <label>Asset Tag</label>
        <input type="text" id="f-asset-tag" value="${esc(device.asset_tag ?? '')}">
      </div>
    </div>
    <div class="field-row">
      <div class="field-group">
        <label>Category</label>
        <select id="f-category">${CATEGORIES.map(c => `<option value="${c}"${c===device.category?' selected':''}>${c.replace('_',' ')}</option>`).join('')}</select>
      </div>
      <div class="field-group">
        <label>Status</label>
        <select id="f-status">${STATUSES.map(s => `<option value="${s}"${s===device.status?' selected':''}>${s}</option>`).join('')}</select>
      </div>
    </div>
    <div class="field-row">
      <div class="field-group">
        <label>Type</label>
        <input type="text" id="f-type" value="${esc(device.type ?? '')}">
      </div>
      <div class="field-group">
        <label>Department</label>
        <input type="text" id="f-department" value="${esc(device.department ?? '')}">
      </div>
    </div>

    <div class="section-header">Hardware</div>
    <div class="field-row">
      <div class="field-group">
        <label>Manufacturer</label>
        <input type="text" id="f-manufacturer" value="${esc(device.manufacturer ?? '')}">
      </div>
      <div class="field-group">
        <label>Model</label>
        <input type="text" id="f-model" value="${esc(device.model ?? '')}">
      </div>
    </div>
    <div class="field-row">
      <div class="field-group">
        <label>Serial Number</label>
        <input type="text" id="f-serial" value="${esc(device.serial_number ?? '')}">
      </div>
      <div class="field-group">
        <label>Owner</label>
        <input type="text" id="f-owner" value="${esc(device.owner ?? '')}">
      </div>
    </div>

    <div class="section-header">Network</div>
    <div class="field-row">
      <div class="field-group">
        <label>IP Address</label>
        <input type="text" id="f-ip" value="${esc(device.ip_address ?? '')}">
      </div>
      <div class="field-group">
        <label>MAC Address</label>
        <input type="text" id="f-mac" value="${esc(device.mac_address ?? '')}">
      </div>
    </div>

    ${extraFields.length ? `
    <div class="section-header">Additional Fields</div>
    ${extraFields.map(f => `
      <div class="field-group">
        <label>${esc(f.label)}</label>
        <input type="${f.type || 'text'}" id="f-extra-${f.name}" value="${esc(extra[f.name] ?? '')}">
      </div>`).join('')}
    ` : ''}

    <div class="section-header">Notes</div>
    <div class="field-group">
      <textarea id="f-notes">${esc(device.notes ?? '')}</textarea>
    </div>

    <div class="field-group">
      <label>Barcode Value</label>
      <input type="text" id="f-barcode" value="${esc(device.barcode_value ?? '')}" readonly>
    </div>

    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-primary" id="btn-save-device">Save</button>
      <button class="btn" id="btn-delete-device" style="color:var(--status-broken);border-color:var(--status-broken)">Delete</button>
    </div>
  `;

  document.getElementById('btn-save-device').addEventListener('click', () => saveDevice(device, extraFields));
  document.getElementById('btn-delete-device').addEventListener('click', () => deleteDevice(device));
  document.getElementById('f-category').addEventListener('change', () => {
    // Re-render to show category-specific fields
    const cat = document.getElementById('f-category').value;
    device = { ...device, category: cat };
    renderOverview(device);
  });
}

async function saveDevice(device, extraFields) {
  const extra = {};
  for (const f of extraFields) {
    const el = document.getElementById(`f-extra-${f.name}`);
    if (el) extra[f.name] = el.value;
  }

  const patch = {
    name:          document.getElementById('f-name')?.value.trim(),
    asset_tag:     document.getElementById('f-asset-tag')?.value.trim() || null,
    category:      document.getElementById('f-category')?.value,
    status:        document.getElementById('f-status')?.value,
    type:          document.getElementById('f-type')?.value.trim() || null,
    department:    document.getElementById('f-department')?.value.trim() || null,
    manufacturer:  document.getElementById('f-manufacturer')?.value.trim() || null,
    model:         document.getElementById('f-model')?.value.trim() || null,
    serial_number: document.getElementById('f-serial')?.value.trim() || null,
    owner:         document.getElementById('f-owner')?.value.trim() || null,
    ip_address:    document.getElementById('f-ip')?.value.trim() || null,
    mac_address:   document.getElementById('f-mac')?.value.trim() || null,
    notes:         document.getElementById('f-notes')?.value.trim() || null,
    extra_fields:  extra,
  };

  try {
    const updated = await api.updateDevice(device.id, patch);
    // Update devices in state
    const devices = getState().devices.map(d => d.id === updated.id ? updated : d);
    setState({ devices });
    toast('Device saved', 'success');
  } catch (err) {
    toast('Save failed: ' + err.message, 'error');
  }
}

async function deleteDevice(device) {
  if (!confirm(`Delete "${device.name}"? This cannot be undone.`)) return;
  try {
    await api.deleteDevice(device.id);
    const devices = getState().devices.filter(d => d.id !== device.id);
    setState({ devices, selectedDeviceId: null });
    toast('Device deleted', 'success');
  } catch (err) {
    toast('Delete failed: ' + err.message, 'error');
  }
}

// ── Relations tab ──────────────────────────────────────────────────────────────

function renderRelations(device) {
  const { links, devices } = getState();
  const devLinks = getDeviceLinks(device.id);
  const content = document.getElementById('panel-content');

  const deviceById = id => devices.find(d => d.id === id);

  content.innerHTML = `
    <div class="section-header">Connections (${devLinks.length})</div>
    ${devLinks.length === 0 ? '<div style="color:var(--color-text-muted);font-size:12px">No connections defined</div>' : ''}
    ${devLinks.map(l => {
      const other = deviceById(l.from_device_id === device.id ? l.to_device_id : l.from_device_id);
      const dir = l.from_device_id === device.id ? '→' : '←';
      return `
        <div class="link-entry" data-link-id="${l.id}">
          <span>${dir}</span>
          <span style="flex:1;color:var(--color-text-primary)">${esc(other?.name ?? 'Unknown')}</span>
          <span class="link-badge">${l.link_type}</span>
          <button class="map-control-btn" style="width:20px;height:20px;font-size:11px" data-del-link="${l.id}">×</button>
        </div>`;
    }).join('')}

    <div class="section-header" style="margin-top:20px">Add Connection</div>
    <div class="field-group">
      <label>Connect to</label>
      <select id="link-target">
        <option value="">— select device —</option>
        ${devices.filter(d => d.id !== device.id).map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field-group">
      <label>Link Type</label>
      <select id="link-type">
        ${LINK_TYPES.map(t => `<option value="${t}">${t.replace('_',' ')}</option>`).join('')}
      </select>
    </div>
    <button class="btn btn-primary" id="btn-add-link">Add Connection</button>
  `;

  content.querySelectorAll('[data-del-link]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.delLink;
      try {
        await api.deleteLink(id);
        const links = getState().links.filter(l => l.id !== id);
        setState({ links });
        toast('Connection removed', 'success');
      } catch (err) {
        toast('Failed: ' + err.message, 'error');
      }
    });
  });

  document.getElementById('btn-add-link')?.addEventListener('click', async () => {
    const toId   = document.getElementById('link-target').value;
    const type   = document.getElementById('link-type').value;
    const locId  = getState().selectedLocationId;
    if (!toId) return;
    try {
      const link = await api.createLink({ location_id: locId, from_device_id: device.id, to_device_id: toId, link_type: type });
      setState({ links: [...getState().links, link] });
      toast('Connection added', 'success');
    } catch (err) {
      toast('Failed: ' + err.message, 'error');
    }
  });
}

// ── Label tab ──────────────────────────────────────────────────────────────────

function renderLabel(device) {
  const content = document.getElementById('panel-content');
  content.innerHTML = `
    <div class="section-header">Barcode Label</div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:12px;margin-top:16px">
      <div style="font-size:14px;font-weight:600">${esc(device.name)}</div>
      <div style="font-size:11px;color:var(--color-text-secondary);font-family:monospace">${esc(device.asset_tag ?? '')}</div>
      <canvas id="inline-barcode" style="background:#fff;border-radius:4px;padding:6px 4px;width:100%;max-width:340px;display:block"></canvas>
      <div style="font-size:10px;color:var(--color-text-muted);font-family:monospace;word-break:break-all;text-align:center;max-width:300px">${esc(device.barcode_value ?? '')}</div>
      <button class="btn btn-primary" id="btn-open-label-modal">Open Print View</button>
    </div>
  `;

  // Render Code 128 barcode
  const canvas = document.getElementById('inline-barcode');
  renderBarcode(device.barcode_value ?? device.id, canvas, 340, 72);

  document.getElementById('btn-open-label-modal')?.addEventListener('click', () => openLabelModal(device));
}

function openLabelModal(device) {
  document.getElementById('label-device-name').textContent = device.name;
  document.getElementById('label-asset-tag').textContent   = device.asset_tag ?? '';
  document.getElementById('label-barcode-val').textContent = device.barcode_value ?? '';
  const barcodeCanvas = document.getElementById('label-qr-canvas');
  renderBarcode(device.barcode_value ?? device.id, barcodeCanvas, 380, 90);
  document.getElementById('label-modal').classList.add('open');
}

// ── History tab ────────────────────────────────────────────────────────────────

async function renderHistory(device) {
  const content = document.getElementById('panel-content');
  content.innerHTML = `<div class="section-header">Audit History</div><div style="color:var(--color-text-muted);font-size:12px">Loading…</div>`;
  try {
    const entries = await api.getDeviceHistory(device.id);
    if (!entries.length) {
      content.innerHTML += '<div style="color:var(--color-text-muted);font-size:12px;margin-top:8px">No history yet</div>';
      return;
    }
    const list = entries.map(e => {
      const diff = (() => {
        try { return JSON.parse(e.diff_json); } catch { return {}; }
      })();
      const changes = diff.old ? Object.keys(diff.new ?? {}).filter(k => diff.old[k] !== diff.new[k]).join(', ') : '';
      return `
        <div class="audit-entry">
          <div style="display:flex;justify-content:space-between">
            <span class="audit-action">${e.action}</span>
            <span class="audit-time">${new Date(e.created_at).toLocaleString()}</span>
          </div>
          ${changes ? `<div style="color:var(--color-text-muted);font-size:10px;margin-top:2px">Changed: ${changes}</div>` : ''}
        </div>`;
    }).join('');
    content.querySelector('div[style]').outerHTML = '';
    content.innerHTML += list;
  } catch (err) {
    content.innerHTML += `<div style="color:var(--status-broken);font-size:12px">${err.message}</div>`;
  }
}

// ── Add device form ────────────────────────────────────────────────────────────

function showAddDeviceForm() {
  const locId = getState().selectedLocationId;
  if (!locId) return;
  const content = document.getElementById('panel-content');
  content.innerHTML = `
    <div class="section-header">New Device</div>
    <div class="field-group"><label>Name *</label><input type="text" id="nd-name" placeholder="Device name"></div>
    <div class="field-row">
      <div class="field-group">
        <label>Category</label>
        <select id="nd-category">${CATEGORIES.map(c=>`<option value="${c}">${c.replace('_',' ')}</option>`).join('')}</select>
      </div>
      <div class="field-group">
        <label>Status</label>
        <select id="nd-status">${STATUSES.map(s=>`<option value="${s}">${s}</option>`).join('')}</select>
      </div>
    </div>
    <div class="field-group"><label>Type</label><input type="text" id="nd-type" placeholder="e.g. Switch, Laptop, VM"></div>
    <div class="field-row">
      <div class="field-group"><label>IP Address</label><input type="text" id="nd-ip"></div>
      <div class="field-group"><label>MAC Address</label><input type="text" id="nd-mac"></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-primary" id="btn-create-device">Create</button>
      <button class="btn" id="btn-cancel-add">Cancel</button>
    </div>
  `;

  document.getElementById('btn-cancel-add').addEventListener('click', () => showEmpty());
  document.getElementById('btn-create-device').addEventListener('click', async () => {
    const name = document.getElementById('nd-name').value.trim();
    if (!name) { toast('Name is required', 'error'); return; }
    try {
      const device = await api.createDevice({
        location_id: locId,
        name,
        category:   document.getElementById('nd-category').value,
        status:     document.getElementById('nd-status').value,
        type:       document.getElementById('nd-type').value.trim() || null,
        ip_address: document.getElementById('nd-ip').value.trim() || null,
        mac_address:document.getElementById('nd-mac').value.trim() || null,
      });
      setState({
        devices: [...getState().devices, device],
        selectedDeviceId: device.id,
        activeTab: 'overview',
      });
      toast('Device created', 'success');
    } catch (err) {
      toast('Create failed: ' + err.message, 'error');
    }
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getExtraFields(fields, category) {
  if (!fields?.extra_fields) return [];
  const entry = fields.extra_fields.find(e => e.category === category);
  return entry?.fields ?? [];
}
