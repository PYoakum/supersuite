// public/views/mapView.js — Map view: loads location data, handles node click + drag
import { MapScene } from '../three/mapScene.js';
import { api } from '../api.js';
import { setState, on, getState } from '../state.js';
import { toast } from '../ui/toast.js';

let scene = null;
let canvas = null;
let isDragging = false;
let dragDeviceId = null;
let dragOffset = null;
let mouseDownPos = null;
const DRAG_THRESHOLD = 4;

export function initMapView() {
  canvas = document.getElementById('map-canvas');
  scene = new MapScene(canvas);

  // Mousedown: detect node hit for potential drag
  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const hit = scene.pickAt(e.clientX, e.clientY);
    if (hit) {
      mouseDownPos = { x: e.clientX, y: e.clientY };
      dragDeviceId = hit.userData.deviceId;
      // Compute offset so the node doesn't snap to cursor
      const worldPos = scene.projectToGround(e.clientX, e.clientY);
      const nodePos = scene.getNodePosition(dragDeviceId);
      if (nodePos && worldPos) {
        dragOffset = { x: nodePos.x - worldPos.x, z: nodePos.z - worldPos.z };
      }
    }
  });

  canvas.addEventListener('mousemove', e => {
    if (!dragDeviceId || !mouseDownPos) return;
    // Start dragging once past threshold
    if (!isDragging) {
      const dx = e.clientX - mouseDownPos.x;
      const dy = e.clientY - mouseDownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
      isDragging = true;
      scene.camCtrl.suppressPan = true;
      canvas.style.cursor = 'grabbing';
    }
    // Project mouse onto ground plane and apply offset
    const worldPos = scene.projectToGround(e.clientX, e.clientY);
    if (worldPos && dragOffset) {
      scene.updateDevicePositions({
        [dragDeviceId]: { x: worldPos.x + dragOffset.x, y: 0, z: worldPos.z + dragOffset.z },
      });
    }
  });

  window.addEventListener('mouseup', e => {
    if (e.button !== 0) return;
    if (isDragging) {
      isDragging = false;
      scene.camCtrl.suppressPan = false;
      canvas.style.cursor = 'default';
      _savePositions();
    } else if (dragDeviceId && mouseDownPos) {
      // Was a click, not a drag — select the node
      setState({ selectedDeviceId: dragDeviceId, activeTab: 'overview' });
    } else if (mouseDownPos && !dragDeviceId) {
      // Clicked empty space
      setState({ selectedDeviceId: null });
      scene.clearSelection();
    }
    dragDeviceId = null;
    mouseDownPos = null;
    dragOffset = null;
  });

  // Click on empty space to deselect (when no node was under mousedown)
  canvas.addEventListener('click', e => {
    if (!isDragging && !dragDeviceId) {
      const hit = scene.pickAt(e.clientX, e.clientY);
      if (!hit) {
        setState({ selectedDeviceId: null });
        scene.clearSelection();
      }
    }
  });

  // Wire state changes
  on('selectedDeviceId', id => {
    scene.selectDevice(id);
  });

  on('selectedLocationId', async id => {
    if (!id) { scene.load([], []); return; }
    try {
      const [devices, links] = await Promise.all([
        api.getLocationDevices(id),
        api.getLocationLinks(id),
      ]);
      setState({ devices, links });
      scene.load(devices, links);
      document.getElementById('btn-add-device').style.display = '';
    } catch (err) {
      toast('Failed to load location data: ' + err.message, 'error');
    }
  });

  on('devices', () => {
    const { devices, links } = getState();
    scene.load(devices, links);
  });

  on('showEdges', v => scene.setShowEdges(v));

  // Overlay controls
  document.getElementById('btn-reset-camera').addEventListener('click', () => {
    scene.resetCamera();
  });

  document.getElementById('btn-reset-layout').addEventListener('click', () => {
    scene.resetLayout();
    toast('Layout reset', 'info');
  });

  document.getElementById('btn-toggle-edges').addEventListener('click', () => {
    const current = getState().showEdges;
    setState({ showEdges: !current });
  });
}

async function _savePositions() {
  const { devices, selectedLocationId } = getState();
  for (const d of devices) {
    const pos = scene.getNodePosition(d.id);
    if (pos) {
      try {
        await api.updateDevice(d.id, { pos_x: pos.x, pos_y: pos.y, pos_z: pos.z });
      } catch { /* non-critical */ }
    }
  }
}
