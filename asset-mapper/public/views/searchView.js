// public/views/searchView.js — Search + barcode lookup
import { api } from '../api.js';
import { setState, getState } from '../state.js';
import { toast } from '../ui/toast.js';

let debounceTimer = null;

export function initSearchView() {
  const input = document.getElementById('search-input');

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (!q) { hideResults(); return; }
    debounceTimer = setTimeout(() => doSearch(q), 250);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { input.value = ''; hideResults(); }
  });

  // Click outside to close
  document.addEventListener('click', e => {
    if (!e.target.closest('#search-wrap') && !e.target.closest('#search-results')) {
      hideResults();
    }
  });
}

async function doSearch(q) {
  try {
    const results = await api.search(q);
    showResults(results, q);
  } catch (err) {
    toast('Search failed: ' + err.message, 'error');
  }
}

function showResults(results, q) {
  let container = document.getElementById('search-results');
  if (!container) {
    container = document.createElement('div');
    container.id = 'search-results';
    Object.assign(container.style, {
      position: 'absolute',
      top: '54px',
      left: '0',
      right: '0',
      zIndex: '50',
      maxHeight: '320px',
      overflowY: 'auto',
      background: 'var(--color-surface-elevated)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--border-radius)',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      padding: '8px',
    });
    // Position relative to search wrap
    const searchWrap = document.getElementById('search-wrap');
    const rect = searchWrap.getBoundingClientRect();
    container.style.top = (rect.bottom + 4) + 'px';
    container.style.left = rect.left + 'px';
    container.style.width = rect.width + 'px';
    container.style.position = 'fixed';
    document.body.appendChild(container);
  }

  if (!results.length) {
    container.innerHTML = `<div style="color:var(--color-text-muted);font-size:12px;padding:8px 4px">No results for "${esc(q)}"</div>`;
    return;
  }

  container.innerHTML = results.map(d => `
    <div class="device-result" data-device-id="${d.id}">
      <div class="device-result-name">${esc(d.name)}</div>
      <div class="device-result-meta">${[d.asset_tag, d.type, d.ip_address, d.status].filter(Boolean).join(' · ')}</div>
    </div>`).join('');

  container.querySelectorAll('.device-result').forEach(el => {
    el.addEventListener('click', () => selectSearchResult(el.dataset.deviceId));
  });
}

async function selectSearchResult(deviceId) {
  hideResults();
  document.getElementById('search-input').value = '';

  // Find the device's location and switch to it
  try {
    const device = await api.getDevice(deviceId);
    const currentLoc = getState().selectedLocationId;

    if (device.location_id !== currentLoc) {
      setState({ selectedLocationId: device.location_id });
      // Wait for location to load, then select
      setTimeout(() => setState({ selectedDeviceId: deviceId }), 600);
    } else {
      setState({ selectedDeviceId: deviceId });
    }

    // Update location select dropdown
    const sel = document.getElementById('location-select');
    if (sel) sel.value = device.location_id;

  } catch (err) {
    toast('Failed to find device: ' + err.message, 'error');
  }
}

function hideResults() {
  document.getElementById('search-results')?.remove();
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
