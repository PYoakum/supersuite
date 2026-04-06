// public/api.js — Thin API wrapper
const BASE = '';

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  getTheme:          ()      => req('GET',   '/api/config/theme'),
  getFields:         ()      => req('GET',   '/api/config/fields'),
  health:            ()      => req('GET',   '/api/health'),

  getLocations:      ()      => req('GET',   '/api/locations'),
  createLocation:    (d)     => req('POST',  '/api/locations', d),
  updateLocation:    (id, d) => req('PATCH', `/api/locations/${id}`, d),

  getLocationDevices:(id)    => req('GET',   `/api/locations/${id}/devices`),
  getLocationLinks:  (id)    => req('GET',   `/api/locations/${id}/links`),

  getDevice:         (id)    => req('GET',   `/api/devices/${id}`),
  createDevice:      (d)     => req('POST',  '/api/devices', d),
  updateDevice:      (id, d) => req('PATCH', `/api/devices/${id}`, d),
  deleteDevice:      (id)    => req('DELETE',`/api/devices/${id}`),
  getDeviceHistory:  (id)    => req('GET',   `/api/devices/${id}/history`),

  createLink:        (d)     => req('POST',  '/api/links', d),
  deleteLink:        (id)    => req('DELETE',`/api/links/${id}`),

  search:            (q)     => req('GET',   `/api/search?q=${encodeURIComponent(q)}`),
};

export default api;
