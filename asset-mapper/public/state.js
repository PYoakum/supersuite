// public/state.js — Centralized app state + reactive subscriptions
const _state = {
  locations: [],
  selectedLocationId: null,
  devices: [],
  links: [],
  selectedDeviceId: null,
  activeTab: 'overview',
  showEdges: true,
  fields: null,
};

const _listeners = {};

export function getState() { return { ..._state }; }

export function setState(patch) {
  const changed = [];
  for (const [k, v] of Object.entries(patch)) {
    if (_state[k] !== v) {
      _state[k] = v;
      changed.push(k);
    }
  }
  for (const k of changed) {
    (_listeners[k] ?? []).forEach(fn => fn(_state[k], _state));
    (_listeners['*'] ?? []).forEach(fn => fn(k, _state[k], _state));
  }
}

export function on(key, fn) {
  if (!_listeners[key]) _listeners[key] = [];
  _listeners[key].push(fn);
  return () => { _listeners[key] = _listeners[key].filter(f => f !== fn); };
}

export function getSelectedDevice() {
  return _state.devices.find(d => d.id === _state.selectedDeviceId) ?? null;
}

export function getSelectedLocation() {
  return _state.locations.find(l => l.id === _state.selectedLocationId) ?? null;
}

export function getDeviceLinks(deviceId) {
  return _state.links.filter(l => l.from_device_id === deviceId || l.to_device_id === deviceId);
}
