// public/three/mapScene.js — Network map renderer
import * as THREE from '/vendor/three.module.js';
import { CameraController } from './camera.js';
import { Picker } from './picking.js';
import { computeLayout } from './layoutEngine.js';

const STATUS_COLORS = {
  active:  0x34d399,
  spare:   0x60a5fa,
  retired: 0x4b5563,
  broken:  0xf87171,
  unknown: 0x6b7280,
};

const CATEGORY_SHAPES = {
  hardware:  'box',
  it_device: 'sphere',
  software:  'cylinder',
  service:   'octahedron',
  appliance: 'box',
  asset:     'sphere',
};

export class MapScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.devices = [];
    this.links = [];
    this._nodeMeshes = [];
    this._edgeLines = [];
    this._labelSprites = [];
    this._positions = {};
    this._selectedId = null;
    this._showEdges = true;
    this._dragDevice = null;

    this._init();
    this._startLoop();
  }

  _init() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0e17);
    this.scene.fog = new THREE.FogExp2(0x0a0e17, 0.018);

    // Camera
    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 300);
    this.camera.position.set(0, 18, 22);
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(5, 12, 8);
    this.scene.add(dir);
    const rim = new THREE.DirectionalLight(0x4f8ef7, 0.3);
    rim.position.set(-8, 4, -6);
    this.scene.add(rim);

    // Grid
    const grid = new THREE.GridHelper(60, 30, 0x1a2035, 0x151d2e);
    grid.position.y = -0.5;
    this.scene.add(grid);

    // Controllers
    this.camCtrl = new CameraController(this.camera, this.canvas);
    this.picker  = new Picker(this.camera, this.scene, this.canvas);

    // Resize
    const ro = new ResizeObserver(() => this._resize());
    ro.observe(this.canvas.parentElement);

    // Events
    this.canvas.addEventListener('click', e => this._onClick(e));
    this.canvas.addEventListener('mousemove', e => this._onHover(e));
  }

  _resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _startLoop() {
    const tick = () => {
      requestAnimationFrame(tick);
      this.camCtrl.update();

      // Gentle pulse on selected node
      if (this._selectedMesh) {
        const s = 1 + Math.sin(Date.now() * 0.003) * 0.04;
        this._selectedMesh.scale.setScalar(s);
      }

      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  // ── Public API ─────────────────────────────────────────────

  load(devices, links) {
    this.devices = devices;
    this.links = links;
    this._clear();
    this._positions = computeLayout(devices, links);
    this._buildNodes();
    this._buildEdges();
  }

  selectDevice(id) {
    this._selectedId = id;
    this._updateNodeColors();
    this._selectedMesh = this._nodeMeshes.find(m => m.userData.deviceId === id) ?? null;
    if (this._selectedMesh) {
      const pos = this._positions[id];
      if (pos) this.camCtrl.focusOn(new THREE.Vector3(pos.x, pos.y, pos.z));
    }
  }

  clearSelection() {
    this._selectedId = null;
    this._selectedMesh = null;
    this._updateNodeColors();
  }

  setShowEdges(v) {
    this._showEdges = v;
    this._edgeLines.forEach(l => { l.visible = v; });
  }

  resetCamera() { this.camCtrl.resetView(); }

  resetLayout() {
    // Force recompute without saved positions
    const devCopy = this.devices.map(d => ({ ...d, pos_x: 0, pos_z: 0 }));
    this._positions = computeLayout(devCopy, this.links);
    this._clear();
    this._buildNodes();
    this._buildEdges();
  }

  getNodePosition(deviceId) { return this._positions[deviceId]; }

  updateDevicePositions(updates) {
    for (const [id, pos] of Object.entries(updates)) {
      this._positions[id] = pos;
    }
    // Reposition meshes
    for (const mesh of this._nodeMeshes) {
      const pos = this._positions[mesh.userData.deviceId];
      if (pos) mesh.position.set(pos.x, 0, pos.z);
    }
    this._rebuildEdges();
  }

  // ── Private build methods ──────────────────────────────────

  _clear() {
    for (const m of this._nodeMeshes)   this.scene.remove(m);
    for (const l of this._edgeLines)    this.scene.remove(l);
    for (const s of this._labelSprites) this.scene.remove(s);
    this._nodeMeshes = [];
    this._edgeLines = [];
    this._labelSprites = [];
    this._selectedMesh = null;
  }

  _buildNodes() {
    for (const device of this.devices) {
      const pos = this._positions[device.id] ?? { x: 0, y: 0, z: 0 };

      // Geometry
      const shape = CATEGORY_SHAPES[device.category] ?? 'sphere';
      let geo;
      if (shape === 'box')        geo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
      else if (shape === 'cylinder') geo = new THREE.CylinderGeometry(0.4, 0.4, 0.8, 8);
      else if (shape === 'octahedron') geo = new THREE.OctahedronGeometry(0.55);
      else                        geo = new THREE.SphereGeometry(0.5, 14, 10);

      // Color
      const baseColor = STATUS_COLORS[device.status] ?? 0x6b7280;
      const mat = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.35,
        metalness: 0.55,
        emissive: new THREE.Color(baseColor).multiplyScalar(0.12),
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pos.x, 0, pos.z);
      mesh.userData = { deviceId: device.id, device, baseColor };
      this.scene.add(mesh);
      this._nodeMeshes.push(mesh);

      // Label
      const sprite = this._makeLabel(device.name);
      sprite.position.set(pos.x, 1.4, pos.z);
      sprite.userData = { deviceId: device.id };
      this.scene.add(sprite);
      this._labelSprites.push(sprite);
    }
  }

  _buildEdges() {
    for (const link of this.links) {
      const from = this._positions[link.from_device_id];
      const to   = this._positions[link.to_device_id];
      if (!from || !to) continue;

      const pts = [
        new THREE.Vector3(from.x, 0, from.z),
        new THREE.Vector3(to.x,   0, to.z),
      ];
      const geo  = new THREE.BufferGeometry().setFromPoints(pts);
      const mat  = new THREE.LineBasicMaterial({
        color: 0x2a3245,
        transparent: true,
        opacity: 0.7,
      });
      const line = new THREE.Line(geo, mat);
      line.userData = { linkId: link.id, link };
      line.visible = this._showEdges;
      this.scene.add(line);
      this._edgeLines.push(line);
    }
  }

  _rebuildEdges() {
    for (const l of this._edgeLines) this.scene.remove(l);
    this._edgeLines = [];
    this._buildEdges();
  }

  _updateNodeColors() {
    for (const mesh of this._nodeMeshes) {
      const id = mesh.userData.deviceId;
      const isSelected = id === this._selectedId;
      if (isSelected) {
        mesh.material.color.setHex(0x4f8ef7);
        mesh.material.emissive.setHex(0x1a3a6e);
        mesh.material.emissiveIntensity = 0.6;
      } else {
        const bc = mesh.userData.baseColor;
        mesh.material.color.setHex(bc);
        mesh.material.emissive.setHex(bc);
        mesh.material.emissiveIntensity = 0.12;
        mesh.scale.setScalar(1);
      }
    }
    // Edge coloring
    for (const line of this._edgeLines) {
      const l = line.userData.link;
      const connected = l.from_device_id === this._selectedId || l.to_device_id === this._selectedId;
      line.material.color.setHex(connected ? 0x4f8ef7 : 0x2a3245);
      line.material.opacity = connected ? 1 : 0.6;
    }
  }

  _makeLabel(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 48);
    ctx.font = '500 16px Inter, sans-serif';
    ctx.fillStyle = 'rgba(226,232,240,0.92)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.length > 20 ? text.slice(0, 20) + '…' : text, 128, 24);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.4, 0.45, 1);
    return sprite;
  }

  _onClick(e) {
    // Handled by mapView for proper event routing
  }

  _onHover(e) {
    const hit = this.picker.pick(e.clientX, e.clientY, this._nodeMeshes);
    this.canvas.style.cursor = hit ? 'pointer' : 'default';

    const tooltip = document.getElementById('map-tooltip');
    if (hit) {
      const d = hit.userData.device;
      document.getElementById('tooltip-name').textContent = d.name;
      document.getElementById('tooltip-meta').textContent =
        [d.type, d.ip_address, d.status].filter(Boolean).join(' · ');
      const rect = this.canvas.getBoundingClientRect();
      tooltip.style.left = (e.clientX - rect.left + 14) + 'px';
      tooltip.style.top  = (e.clientY - rect.top  - 10) + 'px';
      tooltip.style.display = 'block';
    } else {
      tooltip.style.display = 'none';
    }
  }

  pickAt(clientX, clientY) {
    return this.picker.pick(clientX, clientY, this._nodeMeshes);
  }

  projectToGround(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = {
      x: ((clientX - rect.left) / rect.width)  * 2 - 1,
      y: -((clientY - rect.top)  / rect.height) * 2 + 1,
    };
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, hit);
    return hit;
  }

  dispose() {
    this.renderer.dispose();
  }
}
