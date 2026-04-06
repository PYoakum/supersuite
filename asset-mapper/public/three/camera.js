// public/three/camera.js — Smooth camera controller with orbit + focus
import * as THREE from '/vendor/three.module.js';

export class CameraController {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;

    // Orbit state
    this.target = new THREE.Vector3(0, 0, 0);
    this._targetGoal = new THREE.Vector3(0, 0, 0);
    this._posGoal = new THREE.Vector3(0, 18, 22);

    this.spherical = new THREE.Spherical(22, Math.PI / 3.5, 0);
    this._isDragging = false;
    this._mouse = { x: 0, y: 0 };
    this.suppressPan = false;

    camera.position.setFromSpherical(this.spherical).add(this.target);
    camera.lookAt(this.target);

    this._bind();
  }

  _bind() {
    this.dom.addEventListener('mousedown', e => {
      if (e.button !== 1 && e.button !== 2) return; // Middle / right drag to orbit
      this._isDragging = true;
      this._mouse = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    });
    window.addEventListener('mouseup', () => { this._isDragging = false; });
    window.addEventListener('mousemove', e => {
      if (!this._isDragging) return;
      const dx = e.clientX - this._mouse.x;
      const dy = e.clientY - this._mouse.y;
      this._mouse = { x: e.clientX, y: e.clientY };
      this.spherical.theta -= dx * 0.008;
      this.spherical.phi   = Math.max(0.1, Math.min(Math.PI / 2.1, this.spherical.phi + dy * 0.008));
    });

    // Left-drag to pan
    this.dom.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      this._isPanning = true;
      this._panMouse = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', () => { this._isPanning = false; });
    window.addEventListener('mousemove', e => {
      if (!this._isPanning || this.suppressPan) return;
      const dx = e.clientX - this._panMouse.x;
      const dy = e.clientY - this._panMouse.y;
      this._panMouse = { x: e.clientX, y: e.clientY };
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      right.crossVectors(this.camera.getWorldDirection(new THREE.Vector3()), this.camera.up).normalize();
      up.copy(this.camera.up).normalize();
      this.target.addScaledVector(right, -dx * 0.03);
      this.target.addScaledVector(up,   dy * 0.03);
      this._targetGoal.copy(this.target);
    });

    this.dom.addEventListener('wheel', e => {
      this.spherical.radius = Math.max(4, Math.min(80, this.spherical.radius + e.deltaY * 0.05));
      e.preventDefault();
    }, { passive: false });

    this.dom.addEventListener('contextmenu', e => e.preventDefault());
  }

  focusOn(position, radius = 5) {
    this._targetGoal.copy(position);
    this.spherical.radius = Math.max(radius * 2.5, 10);
  }

  resetView() {
    this._targetGoal.set(0, 0, 0);
    this.spherical.set(22, Math.PI / 3.5, 0);
  }

  update() {
    // Smooth target lerp
    this.target.lerp(this._targetGoal, 0.08);
    const pos = new THREE.Vector3().setFromSpherical(this.spherical).add(this.target);
    this.camera.position.lerp(pos, 0.1);
    this.camera.lookAt(this.target);
  }
}
