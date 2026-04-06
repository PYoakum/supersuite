// server/router.js — REST API routes
import { randomUUID } from 'node:crypto';
import db from './db.js';
import config from './config.js';
import { jsonResponse } from './util/json.js';
import logger from './util/logger.js';

const now = () => new Date().toISOString();

function audit(entityType, entityId, action, diff, actor = 'api') {
  try {
    db.prepare(`INSERT INTO audits (id, entity_type, entity_id, action, diff_json, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), entityType, entityId, action, JSON.stringify(diff), actor, now());
  } catch (e) {
    logger.warn('[audit] Failed to write audit:', e.message);
  }
}

export async function route(req, url) {
  const path = url.pathname;
  const method = req.method;

  // ── Config ────────────────────────────────────────────────
  if (method === 'GET' && path === '/api/health') {
    return jsonResponse(200, { ok: true, version: '1.0.0', time: now() });
  }

  if (method === 'GET' && path === '/api/config/theme') {
    return jsonResponse(200, config.theme);
  }

  if (method === 'GET' && path === '/api/config/fields') {
    return jsonResponse(200, config.fields);
  }

  // ── Locations ─────────────────────────────────────────────
  if (method === 'GET' && path === '/api/locations') {
    const rows = db.prepare('SELECT * FROM locations ORDER BY name').all();
    return jsonResponse(200, rows);
  }

  if (method === 'POST' && path === '/api/locations') {
    const body = await req.json();
    if (!body.name) return jsonResponse(400, { error: 'name is required' });
    const id = randomUUID();
    const n = now();
    db.prepare(`INSERT INTO locations (id, name, description, map_layout, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, body.name, body.description ?? null, JSON.stringify(body.map_layout ?? {}), n, n);
    const row = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
    audit('location', id, 'create', { new: row });
    return jsonResponse(201, row);
  }

  const locMatch = path.match(/^\/api\/locations\/([^/]+)$/);
  if (locMatch) {
    const id = locMatch[1];

    if (method === 'GET') {
      const row = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
      if (!row) return jsonResponse(404, { error: 'Not found' });
      return jsonResponse(200, row);
    }

    if (method === 'PATCH') {
      const body = await req.json();
      const old = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
      if (!old) return jsonResponse(404, { error: 'Not found' });
      const fields = ['name', 'description', 'map_layout'];
      const sets = [];
      const vals = [];
      for (const f of fields) {
        if (f in body) {
          sets.push(`${f} = ?`);
          vals.push(f === 'map_layout' ? JSON.stringify(body[f]) : body[f]);
        }
      }
      if (sets.length) {
        sets.push('updated_at = ?');
        vals.push(now(), id);
        db.prepare(`UPDATE locations SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      }
      const updated = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
      audit('location', id, 'update', { old, new: updated });
      return jsonResponse(200, updated);
    }

    if (method === 'DELETE') {
      const old = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
      if (!old) return jsonResponse(404, { error: 'Not found' });
      db.prepare('DELETE FROM locations WHERE id = ?').run(id);
      audit('location', id, 'delete', { old });
      return jsonResponse(200, { ok: true });
    }
  }

  // ── Devices by location ────────────────────────────────────
  const locDevicesMatch = path.match(/^\/api\/locations\/([^/]+)\/devices$/);
  if (locDevicesMatch) {
    const locId = locDevicesMatch[1];
    if (method === 'GET') {
      const rows = db.prepare('SELECT * FROM devices WHERE location_id = ? ORDER BY name').all(locId);
      return jsonResponse(200, rows);
    }
  }

  // ── Links by location ──────────────────────────────────────
  const locLinksMatch = path.match(/^\/api\/locations\/([^/]+)\/links$/);
  if (locLinksMatch) {
    const locId = locLinksMatch[1];
    if (method === 'GET') {
      const rows = db.prepare('SELECT * FROM links WHERE location_id = ? ORDER BY created_at').all(locId);
      return jsonResponse(200, rows);
    }
  }

  // ── Devices ────────────────────────────────────────────────
  if (method === 'POST' && path === '/api/devices') {
    const body = await req.json();
    if (!body.name)        return jsonResponse(400, { error: 'name is required' });
    if (!body.location_id) return jsonResponse(400, { error: 'location_id is required' });
    const id = randomUUID();
    const n = now();
    const barcode = body.barcode_value ?? `${config.barcode.prefix}${id}`;
    db.prepare(`INSERT INTO devices
      (id, location_id, asset_tag, name, category, type, status, manufacturer, model,
       serial_number, owner, department, ip_address, mac_address, purchase_date,
       warranty_end, notes, barcode_value, extra_fields, pos_x, pos_y, pos_z, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, body.location_id, body.asset_tag ?? null, body.name,
        body.category ?? 'it_device', body.type ?? null, body.status ?? 'active',
        body.manufacturer ?? null, body.model ?? null, body.serial_number ?? null,
        body.owner ?? null, body.department ?? null, body.ip_address ?? null,
        body.mac_address ?? null, body.purchase_date ?? null, body.warranty_end ?? null,
        body.notes ?? null, barcode,
        JSON.stringify(body.extra_fields ?? {}),
        body.pos_x ?? 0, body.pos_y ?? 0, body.pos_z ?? 0, n, n);
    const row = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
    audit('device', id, 'create', { new: row });
    return jsonResponse(201, row);
  }

  const devMatch = path.match(/^\/api\/devices\/([^/]+)$/);
  if (devMatch) {
    const id = devMatch[1];

    if (method === 'GET') {
      const row = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
      if (!row) return jsonResponse(404, { error: 'Not found' });
      return jsonResponse(200, row);
    }

    if (method === 'PATCH') {
      const body = await req.json();
      const old = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
      if (!old) return jsonResponse(404, { error: 'Not found' });
      const allowed = ['name','category','type','status','manufacturer','model','serial_number',
        'owner','department','ip_address','mac_address','purchase_date','warranty_end',
        'notes','asset_tag','barcode_value','extra_fields','pos_x','pos_y','pos_z'];
      const sets = [];
      const vals = [];
      for (const f of allowed) {
        if (f in body) {
          sets.push(`${f} = ?`);
          vals.push(f === 'extra_fields' ? JSON.stringify(body[f]) : body[f]);
        }
      }
      if (sets.length) {
        sets.push('updated_at = ?');
        vals.push(now(), id);
        db.prepare(`UPDATE devices SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      }
      const updated = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
      audit('device', id, 'update', { old, new: updated });
      return jsonResponse(200, updated);
    }

    if (method === 'DELETE') {
      const old = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
      if (!old) return jsonResponse(404, { error: 'Not found' });
      db.prepare('DELETE FROM devices WHERE id = ?').run(id);
      audit('device', id, 'delete', { old });
      return jsonResponse(200, { ok: true });
    }
  }

  // ── Device audit history ───────────────────────────────────
  const devAuditMatch = path.match(/^\/api\/devices\/([^/]+)\/history$/);
  if (devAuditMatch && method === 'GET') {
    const id = devAuditMatch[1];
    const rows = db.prepare('SELECT * FROM audits WHERE entity_id = ? ORDER BY created_at DESC LIMIT 50').all(id);
    return jsonResponse(200, rows);
  }

  // ── Links ──────────────────────────────────────────────────
  if (method === 'POST' && path === '/api/links') {
    const body = await req.json();
    if (!body.location_id || !body.from_device_id || !body.to_device_id) {
      return jsonResponse(400, { error: 'location_id, from_device_id, to_device_id required' });
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO links (id, location_id, from_device_id, to_device_id, link_type, label, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, body.location_id, body.from_device_id, body.to_device_id,
        body.link_type ?? 'connected_to', body.label ?? null, now());
    const row = db.prepare('SELECT * FROM links WHERE id = ?').get(id);
    audit('link', id, 'create', { new: row });
    return jsonResponse(201, row);
  }

  const linkMatch = path.match(/^\/api\/links\/([^/]+)$/);
  if (linkMatch && method === 'DELETE') {
    const id = linkMatch[1];
    db.prepare('DELETE FROM links WHERE id = ?').run(id);
    audit('link', id, 'delete', {});
    return jsonResponse(200, { ok: true });
  }

  // ── Search ─────────────────────────────────────────────────
  if (method === 'GET' && path === '/api/search') {
    const q = url.searchParams.get('q') ?? '';
    if (!q.trim()) return jsonResponse(200, []);

    // Barcode lookup
    if (q.startsWith('asset://device/')) {
      const row = db.prepare('SELECT * FROM devices WHERE barcode_value = ?').get(q);
      return jsonResponse(200, row ? [row] : []);
    }

    const like = `%${q}%`;
    const rows = db.prepare(`
      SELECT * FROM devices
      WHERE name LIKE ? OR asset_tag LIKE ? OR ip_address LIKE ?
         OR mac_address LIKE ? OR serial_number LIKE ? OR type LIKE ?
         OR notes LIKE ? OR manufacturer LIKE ? OR model LIKE ?
      LIMIT 50
    `).all(like, like, like, like, like, like, like, like, like);
    return jsonResponse(200, rows);
  }

  return null; // Not handled
}
