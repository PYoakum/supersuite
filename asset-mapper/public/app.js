// public/app.js — Application bootstrap
import { api } from './api.js';
import { setState, on } from './state.js';
import { initMapView } from './views/mapView.js';
import { initManagementView } from './views/managementView.js';
import { initSearchView } from './views/searchView.js';
import { toast } from './ui/toast.js';

async function boot() {
  // 1. Load and apply theme
  try {
    const theme = await api.getTheme();
    applyTheme(theme);
  } catch (e) {
    console.warn('Theme load failed, using defaults:', e.message);
  }

  // 2. Load fields config
  try {
    const fields = await api.getFields();
    setState({ fields });
  } catch {}

  // 3. Init views
  initMapView();
  initManagementView();
  initSearchView();

  // 4. Load locations
  await loadLocations();

  // 5. Wire location selector
  const sel = document.getElementById('location-select');
  sel.addEventListener('change', () => {
    setState({ selectedDeviceId: null, selectedLocationId: sel.value || null });
  });

  // 6. Add location button
  document.getElementById('btn-add-location').addEventListener('click', () => showAddLocationModal());
}

async function loadLocations() {
  try {
    const locations = await api.getLocations();
    setState({ locations });
    const sel = document.getElementById('location-select');
    sel.innerHTML = '<option value="">— select location —</option>';
    for (const loc of locations) {
      const opt = document.createElement('option');
      opt.value = loc.id;
      opt.textContent = loc.name;
      sel.appendChild(opt);
    }
    // Auto-select first location
    if (locations.length) {
      sel.value = locations[0].id;
      setState({ selectedLocationId: locations[0].id });
    }
  } catch (err) {
    toast('Failed to load locations: ' + err.message, 'error');
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  const c = theme.colors ?? {};
  const m = theme.map ?? {};
  const t = theme.typography ?? {};
  const l = theme.layout ?? {};
  const s = theme.status ?? {};

  const vars = {
    '--color-background':       c.background,
    '--color-surface':          c.surface,
    '--color-surface-elevated': c.surface_elevated,
    '--color-border':           c.border,
    '--color-text-primary':     c.text_primary,
    '--color-text-secondary':   c.text_secondary,
    '--color-text-muted':       c.text_muted,
    '--color-accent':           c.accent,
    '--color-accent-hover':     c.accent_hover,
    '--color-accent-dim':       c.accent_dim,

    '--status-active':   s.active,
    '--status-spare':    s.spare,
    '--status-retired':  s.retired,
    '--status-broken':   s.broken,
    '--status-unknown':  s.unknown,

    '--color-map-bg':        m.background,
    '--color-node-default':  m.node_default,
    '--color-node-selected': m.node_selected,
    '--color-node-hover':    m.node_hover,
    '--color-node-retired':  m.node_retired,
    '--color-edge-default':  m.edge_default,
    '--color-edge-selected': m.edge_selected,

    '--font-stack':      t.font_stack,
    '--font-size-base':  t.font_size_base,
    '--line-height':     t.line_height,

    '--panel-width':    l.panel_width,
    '--topbar-height':  l.topbar_height,
    '--border-radius':  l.border_radius,
    '--spacing-unit':   l.spacing_unit,
  };

  for (const [prop, val] of Object.entries(vars)) {
    if (val != null) root.style.setProperty(prop, val);
  }
}

function showAddLocationModal() {
  const existing = document.getElementById('add-loc-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'add-loc-modal';
  Object.assign(modal.style, {
    position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.65)',
    zIndex: '100', display: 'flex', alignItems: 'center', justifyContent: 'center',
  });

  modal.innerHTML = `
    <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:6px;padding:24px;min-width:320px;display:flex;flex-direction:column;gap:14px">
      <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-text-muted)">New Location</div>
      <div class="field-group"><label>Name *</label><input type="text" id="nl-name" placeholder="e.g. Main Office" autofocus></div>
      <div class="field-group"><label>Description</label><input type="text" id="nl-desc" placeholder="Optional description"></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" id="btn-confirm-loc">Create</button>
        <button class="btn" id="btn-cancel-loc">Cancel</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  document.getElementById('nl-name').focus();

  document.getElementById('btn-cancel-loc').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  document.getElementById('btn-confirm-loc').addEventListener('click', async () => {
    const name = document.getElementById('nl-name').value.trim();
    const desc = document.getElementById('nl-desc').value.trim();
    if (!name) { toast('Name is required', 'error'); return; }
    try {
      await api.createLocation({ name, description: desc || null });
      modal.remove();
      await loadLocations();
      toast(`Location "${name}" created`, 'success');
    } catch (err) {
      toast('Create failed: ' + err.message, 'error');
    }
  });
}

boot().catch(console.error);
