/** Simple API client for Noted frontend pages. */

const api = {
  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok) throw new ApiError(res.status, data.error || 'Unknown error');
    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
};

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Show an error message in an alert element. */
function showError(containerId, message) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden', 'alert-success');
  el.classList.add('alert', 'alert-error');
}

/** Show a success message. */
function showSuccess(containerId, message) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden', 'alert-error');
  el.classList.add('alert', 'alert-success');
}

/** Hide an alert element. */
function hideAlert(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.classList.add('hidden');
}

/** Check if user is logged in; redirect if not. */
async function requireLogin() {
  try {
    const data = await api.get('/api/me');
    return data.user;
  } catch {
    window.location.href = '/login';
    return null;
  }
}

/** Check if user is logged in; redirect to dashboard if yes. */
async function redirectIfLoggedIn() {
  try {
    await api.get('/api/me');
    window.location.href = '/';
  } catch {
    // Not logged in — stay on page
  }
}
