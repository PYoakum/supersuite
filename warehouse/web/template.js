export function buildTemplate() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Warehouse</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; }
    .app { display: flex; min-height: 100vh; }
    .sidebar { width: 240px; background: #1e293b; color: #e2e8f0; padding: 0; flex-shrink: 0; display: flex; flex-direction: column; }
    .sidebar-header { padding: 16px 20px; border-bottom: 1px solid #334155; font-size: 18px; font-weight: 700; }
    .sidebar-nav { flex: 1; padding: 12px 8px; }
    .sidebar-nav a { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 6px; color: #94a3b8; text-decoration: none; font-size: 14px; margin-bottom: 2px; }
    .sidebar-nav a:hover, .sidebar-nav a.active { background: #334155; color: #f1f5f9; }
    .sidebar-footer { padding: 12px 16px; border-top: 1px solid #334155; font-size: 12px; color: #64748b; }
    .main { flex: 1; padding: 24px 32px; overflow-y: auto; }
    .main h1 { font-size: 24px; font-weight: 700; margin-bottom: 20px; }
    .card { background: #fff; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 16px; }
    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; border: none; }
    .btn-primary { background: #2563eb; color: #fff; }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-secondary { background: #e2e8f0; color: #475569; }
    .btn-danger { background: #ef4444; color: #fff; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { text-align: left; padding: 10px 12px; font-size: 12px; font-weight: 600; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0; }
    td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
    tr:hover td { background: #f8fafc; }
    input, select, textarea { padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; width: 100%; }
    input:focus, select:focus, textarea:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.15); }
    label { display: block; font-size: 13px; font-weight: 500; color: #475569; margin-bottom: 4px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 500; }
    .badge-green { background: #dcfce7; color: #166534; }
    .badge-blue { background: #dbeafe; color: #1e40af; }
    .badge-yellow { background: #fef3c7; color: #92400e; }
    .badge-red { background: #fee2e2; color: #991b1b; }
    .badge-gray { background: #f1f5f9; color: #475569; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .form-group { margin-bottom: 16px; }
    .form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; padding-top: 16px; border-top: 1px solid #e2e8f0; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: #fff; border-radius: 8px; padding: 16px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .stat-card .label { font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; }
    .stat-card .value { font-size: 28px; font-weight: 700; color: #1e293b; margin-top: 4px; }
    .tabs { display: flex; gap: 0; border-bottom: 2px solid #e2e8f0; margin-bottom: 20px; }
    .tab { padding: 10px 16px; font-size: 14px; font-weight: 500; color: #64748b; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; }
    .tab.active { color: #2563eb; border-bottom-color: #2563eb; }
    .empty { text-align: center; padding: 48px; color: #94a3b8; }
    .login-page { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #1e293b; }
    .login-card { background: #fff; border-radius: 12px; padding: 32px; width: 380px; box-shadow: 0 4px 24px rgba(0,0,0,0.2); }
    .login-card h1 { text-align: center; margin-bottom: 24px; }
    .error-msg { background: #fee2e2; color: #991b1b; padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 16px; }
    .mono { font-family: 'SF Mono', 'Consolas', monospace; }
    .text-sm { font-size: 13px; }
    .text-muted { color: #64748b; }
    .mb-4 { margin-bottom: 16px; }
    .mt-2 { margin-top: 8px; }
    .flex { display: flex; }
    .gap-2 { gap: 8px; }
    .items-center { align-items: center; }
    .justify-between { justify-content: space-between; }
    .hidden { display: none; }
  </style>
</head>
<body>
<div id="app"></div>
<script type="module">
// ── API Client ──
const api = {
  token: localStorage.getItem('auth_token'),
  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
    const res = await fetch('/api' + path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json();
    if (res.status === 401) {
      api.token = null;
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_refresh');
      localStorage.removeItem('auth_user');
      navigate('/login');
      throw { status: 401, error: 'Session expired' };
    }
    if (!res.ok) throw { status: res.status, ...data };
    return data;
  },
  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  patch(path, body) { return this.request('PATCH', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  del(path) { return this.request('DELETE', path); },
};

// ── Router ──
const routes = {};
let currentPath = '';

function navigate(path) {
  if (path === currentPath) return;
  currentPath = path;
  history.pushState(null, '', path);
  render();
}

window.addEventListener('popstate', () => { currentPath = location.pathname; render(); });

function render() {
  const path = location.pathname;
  currentPath = path;
  if (!api.token && path !== '/login') { navigate('/login'); return; }
  if (api.token && path === '/login') { navigate('/'); return; }

  // Verify token is still valid on first authenticated render
  if (api.token && !api._verified) {
    api._verified = true;
    api.get('/health').catch(() => {
      // Token invalid — clear and redirect to login
      api.token = null;
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_refresh');
      localStorage.removeItem('auth_user');
      navigate('/login');
    });
  }

  const app = document.getElementById('app');
  if (path === '/login') { renderLogin(app); return; }

  // Find matching route
  let handler = null, params = {};
  for (const [pattern, fn] of Object.entries(routes)) {
    const match = matchPath(pattern, path);
    if (match) { handler = fn; params = match; break; }
  }
  if (!handler) handler = () => '<div class="empty">Page not found</div>';

  app.innerHTML = buildShell(handler(params));
  bindNav();
}

function matchPath(pattern, path) {
  const pp = pattern.split('/'), sp = path.split('/');
  if (pp.length !== sp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = sp[i];
    else if (pp[i] !== sp[i]) return null;
  }
  return params;
}

function buildShell(content) {
  const navItems = [
    ['/', 'Dashboard'], ['/items', 'Items'], ['/warehouses', 'Warehouses'],
    ['/organizations', 'Organizations'], ['/scan', 'Scan'],
  ];
  const user = JSON.parse(localStorage.getItem('auth_user') || '{}');
  return '<div class="app">' +
    '<div class="sidebar">' +
      '<div class="sidebar-header">Warehouse</div>' +
      '<nav class="sidebar-nav">' +
        navItems.map(([href, label]) =>
          '<a href="' + href + '" data-link class="' + (currentPath === href || (href !== '/' && currentPath.startsWith(href)) ? 'active' : '') + '">' + label + '</a>'
        ).join('') +
      '</nav>' +
      '<div class="sidebar-footer">' + (user.email || '') +
        '<br><a href="#" onclick="logout()" style="color:#94a3b8;text-decoration:none;font-size:12px">Logout</a>' +
      '</div>' +
    '</div>' +
    '<div class="main">' + content + '</div>' +
  '</div>';
}

function bindNav() {
  document.querySelectorAll('[data-link]').forEach(a => {
    a.onclick = (e) => { e.preventDefault(); navigate(a.getAttribute('href')); };
  });
}

// ── Auth ──
function renderLogin(app) {
  app.innerHTML =
    '<div class="login-page"><div class="login-card">' +
    '<h1>Warehouse</h1>' +
    '<div id="login-error" class="error-msg hidden"></div>' +
    '<form id="login-form">' +
      '<div class="form-group"><label>Email</label><input name="email" type="email" required></div>' +
      '<div class="form-group"><label>Password</label><input name="password" type="password" required></div>' +
      '<button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px">Login</button>' +
    '</form></div></div>';

  document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await api.post('/auth/login', { email: fd.get('email'), password: fd.get('password') });
      api.token = res.accessToken;
      localStorage.setItem('auth_token', res.accessToken);
      localStorage.setItem('auth_refresh', res.refreshToken);
      localStorage.setItem('auth_user', JSON.stringify(res.user));
      navigate('/');
    } catch (err) {
      const el = document.getElementById('login-error');
      el.textContent = err.error || 'Login failed';
      el.classList.remove('hidden');
    }
  };
}

window.logout = () => {
  api.token = null;
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_refresh');
  localStorage.removeItem('auth_user');
  navigate('/login');
};

// ── Page: Dashboard ──
routes['/'] = () => {
  setTimeout(loadDashboard, 0);
  return '<h1>Dashboard</h1><div id="dashboard-content"><div class="stats-grid">' +
    '<div class="stat-card"><div class="label">Items</div><div class="value" id="stat-items">-</div></div>' +
    '<div class="stat-card"><div class="label">Quantity</div><div class="value" id="stat-qty">-</div></div>' +
    '<div class="stat-card"><div class="label">Warehouses</div><div class="value" id="stat-wh">-</div></div>' +
    '<div class="stat-card"><div class="label">Locations</div><div class="value" id="stat-loc">-</div></div>' +
  '</div><div class="card"><h3 style="margin-bottom:12px">Recent Items</h3><div id="recent-items">Loading...</div></div></div>';
};
async function loadDashboard() {
  try {
    const items = await api.get('/items?limit=10');
    const wh = await api.get('/warehouses');
    document.getElementById('stat-items').textContent = items.length;
    document.getElementById('stat-qty').textContent = items.reduce((s,i) => s + (i.quantity||0), 0);
    document.getElementById('stat-wh').textContent = wh.length;
    document.getElementById('recent-items').innerHTML = items.length
      ? '<table><thead><tr><th>SKU</th><th>Name</th><th>Qty</th><th>Status</th></tr></thead><tbody>' +
        items.map(i => '<tr style="cursor:pointer" onclick="navigate(\\'/items/' + i.id + '\\')">' +
          '<td class="mono">' + i.sku + '</td><td>' + i.name + '</td><td>' + i.quantity + '</td>' +
          '<td><span class="badge badge-green">' + i.status + '</span></td></tr>').join('') +
        '</tbody></table>'
      : '<div class="empty">No items yet</div>';
  } catch(e) { console.error(e); }
}
window.navigate = navigate;

// ── Page: Items ──
routes['/items'] = () => {
  setTimeout(loadItems, 0);
  return '<div class="flex justify-between items-center mb-4"><h1>Items</h1>' +
    '<button class="btn btn-primary" onclick="navigate(\\'/items/new\\')">New Item</button></div>' +
    '<div class="card" id="items-content">Loading...</div>';
};
async function loadItems() {
  const items = await api.get('/items?limit=100');
  document.getElementById('items-content').innerHTML = items.length
    ? '<table><thead><tr><th>SKU</th><th>Name</th><th>Qty</th><th>Condition</th><th>Status</th></tr></thead><tbody>' +
      items.map(i => '<tr style="cursor:pointer" onclick="navigate(\\'/items/' + i.id + '\\')">' +
        '<td class="mono">' + i.sku + '</td><td>' + i.name + '</td><td>' + i.quantity + '</td>' +
        '<td><span class="badge badge-gray">' + i.condition + '</span></td>' +
        '<td><span class="badge badge-green">' + i.status + '</span></td></tr>').join('') +
      '</tbody></table>'
    : '<div class="empty">No items yet. Create one to get started.</div>';
}

routes['/items/new'] = () => {
  return '<h1>Create Item</h1><div class="card"><form id="item-form">' +
    '<div class="form-grid">' +
      '<div class="form-group"><label>SKU</label><input name="sku" required></div>' +
      '<div class="form-group"><label>Name</label><input name="name" required></div>' +
    '</div>' +
    '<div class="form-group"><label>Description</label><textarea name="description" rows="3"></textarea></div>' +
    '<div class="form-grid">' +
      '<div class="form-group"><label>Unit</label><input name="unit" value="each"></div>' +
      '<div class="form-group"><label>Condition</label><select name="condition">' +
        '<option value="new_item">New</option><option value="used">Used</option>' +
        '<option value="refurbished">Refurbished</option><option value="damaged">Damaged</option></select></div>' +
    '</div>' +
    '<div class="form-actions"><button type="button" class="btn btn-secondary" onclick="navigate(\\'/items\\')">Cancel</button>' +
    '<button type="submit" class="btn btn-primary">Create</button></div></form></div>';
};
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'item-form') return;
  e.preventDefault();
  const fd = new FormData(e.target);
  const user = JSON.parse(localStorage.getItem('auth_user') || '{}');
  try {
    const item = await api.post('/items', {
      organization_id: user.organization_id || user.organizationId,
      sku: fd.get('sku'), name: fd.get('name'), description: fd.get('description'),
      unit: fd.get('unit'), condition: fd.get('condition'),
    });
    navigate('/items/' + item.id);
  } catch(err) { alert(err.error || 'Failed to create item'); }
});

routes['/items/:id'] = (params) => {
  setTimeout(() => loadItemDetail(params.id), 0);
  return '<div id="item-detail">Loading...</div>';
};
async function loadItemDetail(id) {
  try {
    const item = await api.get('/items/' + id);
    const statusBadge = { active: 'badge-green', inactive: 'badge-yellow', archived: 'badge-gray' };
    const condBadge = { new_item: 'badge-blue', used: 'badge-gray', refurbished: 'badge-yellow', damaged: 'badge-red' };

    document.getElementById('item-detail').innerHTML =
      '<a href="/items" data-link class="text-sm text-muted" style="text-decoration:none">&larr; Back to Items</a>' +
      '<div class="flex justify-between items-center" style="margin-top:8px">' +
        '<div><h1>' + item.name + '</h1><p class="mono text-muted text-sm">' + item.sku + '</p></div>' +
      '</div>' +

      // Tabs
      '<div class="tabs" style="margin-top:16px">' +
        '<div class="tab active" data-tab="details">Details</div>' +
        '<div class="tab" data-tab="barcodes">Barcodes</div>' +
        '<div class="tab" data-tab="locations">Locations</div>' +
      '</div>' +

      // Details tab
      '<div id="tab-details" class="card">' +
        '<div class="form-grid">' +
          '<div><label class="text-muted text-sm">Status</label>' +
            '<div class="flex gap-2 items-center mt-2">' +
              '<span class="badge ' + (statusBadge[item.status] || 'badge-gray') + '">' + item.status + '</span>' +
              '<select id="status-select" style="width:auto;padding:4px 8px;font-size:12px">' +
                '<option value="">Change...</option>' +
                '<option value="active"' + (item.status==='active'?' disabled':'') + '>Active</option>' +
                '<option value="inactive"' + (item.status==='inactive'?' disabled':'') + '>Inactive</option>' +
                '<option value="archived"' + (item.status==='archived'?' disabled':'') + '>Archived</option>' +
              '</select>' +
            '</div></div>' +
          '<div><label class="text-muted text-sm">Condition</label>' +
            '<div class="flex gap-2 items-center mt-2">' +
              '<span class="badge ' + (condBadge[item.condition] || 'badge-gray') + '">' + item.condition.replace('_',' ') + '</span>' +
              '<select id="condition-select" style="width:auto;padding:4px 8px;font-size:12px">' +
                '<option value="">Change...</option>' +
                '<option value="new_item"' + (item.condition==='new_item'?' disabled':'') + '>New</option>' +
                '<option value="used"' + (item.condition==='used'?' disabled':'') + '>Used</option>' +
                '<option value="refurbished"' + (item.condition==='refurbished'?' disabled':'') + '>Refurbished</option>' +
                '<option value="damaged"' + (item.condition==='damaged'?' disabled':'') + '>Damaged</option>' +
              '</select>' +
            '</div></div>' +
          '<div><label class="text-muted text-sm">Quantity</label><div class="mt-2" style="font-size:20px;font-weight:600">' + item.quantity + ' <span class="text-muted text-sm" style="font-weight:400">' + item.unit + '</span></div></div>' +
          '<div><label class="text-muted text-sm">Description</label><div class="mt-2">' + (item.description || '-') + '</div></div>' +
        '</div>' +
        (item.tags && item.tags.length ? '<div style="margin-top:16px;padding-top:16px;border-top:1px solid #e2e8f0"><label class="text-muted text-sm">Tags</label><div class="flex gap-2 mt-2">' + item.tags.map(t => '<span class="badge badge-blue">' + t.name + '</span>').join('') + '</div></div>' : '') +
      '</div>' +

      // Barcodes tab
      '<div id="tab-barcodes" class="card hidden">' +
        '<div class="flex justify-between items-center mb-4">' +
          '<label class="text-muted text-sm" style="font-size:14px;font-weight:600">Barcodes</label>' +
          '<button class="btn btn-primary" style="font-size:12px;padding:6px 12px" id="gen-barcode-btn">Generate Barcode</button>' +
        '</div>' +
        '<div id="barcode-gen-form" class="hidden" style="margin-bottom:16px;padding:16px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0">' +
          '<div class="form-grid">' +
            '<div class="form-group"><label>Symbology</label><select id="bc-symbology"><option value="Code128">Code 128</option><option value="Code39">Code 39</option><option value="EAN13">EAN-13</option><option value="UPCA">UPC-A</option></select></div>' +
            '<div class="form-group"><label>Value (blank = auto)</label><input id="bc-value" placeholder="Auto-generated"></div>' +
          '</div>' +
          '<div class="form-actions" style="margin-top:8px;padding-top:8px"><button class="btn btn-secondary" id="bc-cancel" style="font-size:12px">Cancel</button><button class="btn btn-primary" id="bc-submit" style="font-size:12px">Generate</button></div>' +
        '</div>' +
        (item.barcodes && item.barcodes.length
          ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">' +
            item.barcodes.map(bc =>
              '<div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center">' +
                (bc.image_url ? '<img src="' + bc.image_url + '" style="max-width:100%;height:60px;object-fit:contain;margin-bottom:8px">' : '<div style="height:60px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px">Generating...</div>') +
                '<div class="mono text-sm" style="word-break:break-all">' + bc.value + '</div>' +
                '<div class="flex gap-2 items-center justify-center mt-2">' +
                  '<span class="badge badge-blue">' + bc.symbology + '</span>' +
                  '<span class="badge badge-gray">' + bc.type + '</span>' +
                '</div>' +
              '</div>'
            ).join('') +
            '</div>'
          : '<div class="empty" style="padding:24px">No barcodes yet</div>') +
      '</div>' +

      // Locations tab
      '<div id="tab-locations" class="card hidden">' +
        (item.assignments && item.assignments.length
          ? '<table><thead><tr><th>Warehouse</th><th>Location</th><th>Quantity</th><th>Placed</th></tr></thead><tbody>' +
            item.assignments.map(a =>
              '<tr><td>' + (a.warehouse_name||'-') + '</td><td class="mono">' + (a.location_label||'-') + '</td><td>' + a.quantity + '</td><td class="text-muted text-sm">' + new Date(a.placed_at).toLocaleDateString() + '</td></tr>'
            ).join('') +
            '</tbody></table>'
          : '<div class="empty" style="padding:24px">Not assigned to any locations</div>') +
      '</div>';

    // Tab switching
    document.querySelectorAll('[data-tab]').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('[data-tab]').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-details').classList.toggle('hidden', tab.dataset.tab !== 'details');
        document.getElementById('tab-barcodes').classList.toggle('hidden', tab.dataset.tab !== 'barcodes');
        document.getElementById('tab-locations').classList.toggle('hidden', tab.dataset.tab !== 'locations');
      };
    });

    // Status change
    document.getElementById('status-select').onchange = async (e) => {
      if (!e.target.value) return;
      await api.patch('/items/' + id, { status: e.target.value });
      loadItemDetail(id);
    };

    // Condition change
    document.getElementById('condition-select').onchange = async (e) => {
      if (!e.target.value) return;
      await api.patch('/items/' + id, { condition: e.target.value });
      loadItemDetail(id);
    };

    // Barcode generation
    document.getElementById('gen-barcode-btn').onclick = () => {
      document.getElementById('barcode-gen-form').classList.remove('hidden');
    };
    document.getElementById('bc-cancel').onclick = () => {
      document.getElementById('barcode-gen-form').classList.add('hidden');
    };
    document.getElementById('bc-submit').onclick = async () => {
      const symbology = document.getElementById('bc-symbology').value;
      const value = document.getElementById('bc-value').value || undefined;
      await api.post('/items/' + id + '/barcodes', { symbology, value });
      loadItemDetail(id);
    };

    bindNav();
  } catch(e) { document.getElementById('item-detail').innerHTML = '<div class="error-msg">Item not found</div>'; }
}

// ── Page: Warehouses ──
routes['/warehouses'] = () => {
  setTimeout(loadWarehouses, 0);
  return '<div class="flex justify-between items-center mb-4"><h1>Warehouses</h1></div>' +
    '<div class="card" id="wh-content">Loading...</div>';
};
async function loadWarehouses() {
  const wh = await api.get('/warehouses');
  document.getElementById('wh-content').innerHTML = wh.length
    ? '<table><thead><tr><th>Code</th><th>Name</th><th>Address</th></tr></thead><tbody>' +
      wh.map(w => '<tr style="cursor:pointer" onclick="navigate(\\'/warehouses/' + w.id + '\\')">' +
        '<td class="mono">' + w.code + '</td><td>' + w.name + '</td><td>' + (w.address||'-') + '</td></tr>').join('') +
      '</tbody></table>'
    : '<div class="empty">No warehouses yet</div>';
}

routes['/warehouses/:id'] = (params) => {
  setTimeout(() => loadWarehouseDetail(params.id), 0);
  return '<div id="wh-detail">Loading...</div>';
};
async function loadWarehouseDetail(id) {
  const wh = await api.get('/warehouses/' + id);
  document.getElementById('wh-detail').innerHTML =
    '<a href="/warehouses" data-link class="text-sm text-muted" style="text-decoration:none">&larr; Back</a>' +
    '<h1 style="margin-top:8px">' + wh.name + '</h1><p class="mono text-muted text-sm mb-4">' + wh.code + '</p>' +
    '<div class="card"><div class="form-grid">' +
      '<div><label class="text-muted text-sm">Address</label><div>' + (wh.address||'-') + '</div></div>' +
    '</div></div>';
  bindNav();
}

// ── Page: Organizations ──
routes['/organizations'] = () => {
  setTimeout(loadOrgs, 0);
  return '<h1>Organizations</h1><div class="card" id="org-content">Loading...</div>';
};
async function loadOrgs() {
  const orgs = await api.get('/organizations');
  document.getElementById('org-content').innerHTML = orgs.length
    ? '<table><thead><tr><th>Code</th><th>Name</th></tr></thead><tbody>' +
      orgs.map(o => '<tr><td class="mono">' + o.code + '</td><td>' + o.name + '</td></tr>').join('') +
      '</tbody></table>'
    : '<div class="empty">No organizations</div>';
}

// ── Page: Scan ──
routes['/scan'] = () => {
  return '<h1>Scan Barcode</h1><div class="card">' +
    '<div class="form-group"><label>Barcode Value</label>' +
    '<input id="scan-input" placeholder="Scan or type barcode..." autofocus></div>' +
    '<div id="scan-result"></div></div>';
};
document.addEventListener('keydown', (e) => {
  const input = document.getElementById('scan-input');
  if (!input || e.target !== input || e.key !== 'Enter') return;
  e.preventDefault();
  scanBarcode(input.value.trim());
});
async function scanBarcode(value) {
  if (!value) return;
  const el = document.getElementById('scan-result');
  el.innerHTML = 'Searching...';
  try {
    const result = await api.get('/search/barcode/' + encodeURIComponent(value));
    el.innerHTML = '<div class="card mt-2" style="cursor:pointer" onclick="navigate(\\'/items/' + result.id + '\\')">' +
      '<strong>' + result.name + '</strong> <span class="mono text-muted">' + result.sku + '</span>' +
      '<br>Quantity: ' + result.quantity + '</div>';
  } catch { el.innerHTML = '<div class="error-msg mt-2">No item found for barcode: ' + value + '</div>'; }
}

// ── Init ──
render();
</script>
</body>
</html>`;
}
