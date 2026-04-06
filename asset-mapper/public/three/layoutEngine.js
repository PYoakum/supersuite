// public/three/layoutEngine.js — Compute 3D node positions
export function computeLayout(devices, links, savedLayout = {}) {
  // Use saved positions when available; otherwise run radial/force layout
  const hasPositions = devices.some(d => (d.pos_x !== 0 || d.pos_z !== 0));
  const positions = {};

  if (hasPositions) {
    for (const d of devices) {
      positions[d.id] = { x: d.pos_x ?? 0, y: 0, z: d.pos_z ?? 0 };
    }
    return positions;
  }

  // Radial layout: hub nodes (high connectivity) in center
  const degree = {};
  for (const d of devices) degree[d.id] = 0;
  for (const l of links) {
    degree[l.from_device_id] = (degree[l.from_device_id] ?? 0) + 1;
    degree[l.to_device_id]   = (degree[l.to_device_id]   ?? 0) + 1;
  }

  const sorted = [...devices].sort((a, b) => (degree[b.id] ?? 0) - (degree[a.id] ?? 0));
  const n = sorted.length;
  const rings = [[], [], []];

  for (let i = 0; i < n; i++) {
    if (i === 0) rings[0].push(sorted[i]);
    else if (i < 5) rings[1].push(sorted[i]);
    else rings[2].push(sorted[i]);
  }

  const radii = [0, 5, 11];
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    const radius = radii[r];
    for (let i = 0; i < ring.length; i++) {
      const angle = (i / Math.max(ring.length, 1)) * Math.PI * 2;
      const d = ring[i];
      positions[d.id] = {
        x: Math.cos(angle) * radius,
        y: 0,
        z: Math.sin(angle) * radius,
      };
    }
  }

  return positions;
}
