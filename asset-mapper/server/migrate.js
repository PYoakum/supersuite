// server/migrate.js — Create tables and seed sample data
import db from './db.js';
import logger from './util/logger.js';
import { randomUUID } from 'node:crypto';

export function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS locations (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    map_layout  TEXT DEFAULT '{}',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS devices (
    id             TEXT PRIMARY KEY,
    location_id    TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    asset_tag      TEXT UNIQUE,
    name           TEXT NOT NULL,
    category       TEXT NOT NULL DEFAULT 'it_device',
    type           TEXT,
    status         TEXT NOT NULL DEFAULT 'active',
    manufacturer   TEXT,
    model          TEXT,
    serial_number  TEXT,
    owner          TEXT,
    department     TEXT,
    ip_address     TEXT,
    mac_address    TEXT,
    purchase_date  TEXT,
    warranty_end   TEXT,
    notes          TEXT,
    barcode_value  TEXT,
    extra_fields   TEXT DEFAULT '{}',
    pos_x          REAL DEFAULT 0,
    pos_y          REAL DEFAULT 0,
    pos_z          REAL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS links (
    id             TEXT PRIMARY KEY,
    location_id    TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    from_device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    to_device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    link_type      TEXT NOT NULL DEFAULT 'connected_to',
    label          TEXT,
    created_at     TEXT NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS audits (
    id          TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    action      TEXT NOT NULL,
    diff_json   TEXT,
    actor       TEXT DEFAULT 'system',
    created_at  TEXT NOT NULL
  )`);

  db.exec('CREATE INDEX IF NOT EXISTS idx_devices_location ON devices(location_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_links_location   ON links(location_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_audits_entity    ON audits(entity_id)');

  logger.info('[migrate] Schema ready');
}

export function seed() {
  const existing = db.prepare('SELECT COUNT(*) as n FROM locations').get();
  if (existing.n > 0) return;

  const now = new Date().toISOString();
  const locId = randomUUID();

  db.prepare(`INSERT INTO locations (id, name, description, map_layout, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(locId, 'Main Office', 'Primary office network infrastructure', '{}', now, now);

  const deviceData = [
    { name: 'Core Switch',    category: 'hardware',   type: 'Switch',   status: 'active',  ip: '10.0.0.1',  mac: 'AA:BB:CC:00:01:01', mfg: 'Cisco',  model: 'SG350-28', pos: [-3, 0, 0] },
    { name: 'Firewall',       category: 'hardware',   type: 'Firewall', status: 'active',  ip: '10.0.0.2',  mac: 'AA:BB:CC:00:01:02', mfg: 'Fortinet', model: 'FG-60F', pos: [0, 0, 3]  },
    { name: 'NAS Storage',    category: 'hardware',   type: 'NAS',      status: 'active',  ip: '10.0.0.10', mac: 'AA:BB:CC:00:01:03', mfg: 'Synology', model: 'DS923+', pos: [3, 0, 0]  },
    { name: 'Workstation-01', category: 'it_device',  type: 'Desktop',  status: 'active',  ip: '10.0.0.50', mac: 'AA:BB:CC:00:02:01', mfg: 'Dell', model: 'OptiPlex 7090', pos: [-2, 0, -3] },
    { name: 'Workstation-02', category: 'it_device',  type: 'Desktop',  status: 'active',  ip: '10.0.0.51', mac: 'AA:BB:CC:00:02:02', mfg: 'Dell', model: 'OptiPlex 7090', pos: [2, 0, -3] },
    { name: 'Laptop-IT-01',   category: 'it_device',  type: 'Laptop',   status: 'active',  ip: '10.0.0.60', mac: 'AA:BB:CC:00:03:01', mfg: 'Lenovo', model: 'ThinkPad X1', pos: [0, 0, -4] },
    { name: 'Printer-01',     category: 'hardware',   type: 'Printer',  status: 'active',  ip: '10.0.0.70', mac: 'AA:BB:CC:00:04:01', mfg: 'HP', model: 'LaserJet Pro', pos: [-4, 0, 2] },
    { name: 'Old Server',     category: 'hardware',   type: 'Server',   status: 'retired', ip: '10.0.0.99', mac: 'AA:BB:CC:00:05:01', mfg: 'HP', model: 'ProLiant DL380', pos: [4, 0, 2] },
    { name: 'VPN Service',    category: 'service',    type: 'VPN',      status: 'active',  ip: null,         mac: null,                mfg: null, model: null, pos: [0, 0, 5] },
    { name: 'Backup Server',  category: 'it_device',  type: 'Server',   status: 'spare',   ip: '10.0.0.11', mac: 'AA:BB:CC:00:06:01', mfg: 'HP', model: 'ProLiant DL20', pos: [5, 0, -1] },
  ];

  const insertDevice = db.prepare(`
    INSERT INTO devices (id, location_id, asset_tag, name, category, type, status,
      manufacturer, model, ip_address, mac_address, barcode_value,
      pos_x, pos_y, pos_z, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const ids = [];
  for (const d of deviceData) {
    const id = randomUUID();
    const tag = `ASSET-${String(ids.length + 1).padStart(4, '0')}`;
    insertDevice.run(id, locId, tag, d.name, d.category, d.type, d.status,
      d.mfg, d.model, d.ip, d.mac, `asset://device/${id}`,
      d.pos[0], d.pos[1], d.pos[2], now, now);
    ids.push(id);
  }

  // Create some links (core switch connects to everything)
  const insertLink = db.prepare(`
    INSERT INTO links (id, location_id, from_device_id, to_device_id, link_type, label, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const switchId = ids[0];
  const linkPairs = [
    [switchId, ids[1], 'uplink', 'WAN uplink'],
    [switchId, ids[2], 'connected_to', 'Storage link'],
    [switchId, ids[3], 'connected_to', null],
    [switchId, ids[4], 'connected_to', null],
    [switchId, ids[5], 'connected_to', null],
    [switchId, ids[6], 'connected_to', null],
    [ids[1],   ids[8], 'vpn', 'VPN tunnel'],
    [switchId, ids[9], 'connected_to', 'Backup'],
  ];

  for (const [from, to, type, label] of linkPairs) {
    insertLink.run(randomUUID(), locId, from, to, type, label, now);
  }

  logger.info('[migrate] Seed data inserted');
}
