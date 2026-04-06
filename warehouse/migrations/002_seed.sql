-- Roles
INSERT INTO roles (name) VALUES ('admin'), ('manager'), ('operator'), ('viewer');

-- Default organization
INSERT INTO organizations (id, name, code)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Organization', 'DEFAULT');

-- Admin user (password: admin123, bcrypt hash with 12 rounds)
INSERT INTO users (id, email, name, password_hash, organization_id)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'admin@warehouse.local',
  'Admin User',
  '$2a$12$KmVHUB.l5o9UPPmHD3H3aOkgi82FZ4BkJkwrHt/vhCrNODCUKA1oK',
  '00000000-0000-0000-0000-000000000001'
);

-- Assign admin role
INSERT INTO user_roles (user_id, role_id)
SELECT '00000000-0000-0000-0000-000000000002', id FROM roles WHERE name = 'admin';

-- Demo warehouse
INSERT INTO warehouses (id, organization_id, name, code, address)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  'Main Warehouse', 'WH-01', '123 Storage Lane'
);

-- Zones
INSERT INTO warehouse_zones (id, warehouse_id, name, code, type) VALUES
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', 'Zone A - General Storage', 'A', 'storage'),
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000003', 'Receiving Dock', 'R', 'receiving');

-- Sample items
INSERT INTO items (organization_id, sku, name, description, quantity) VALUES
  ('00000000-0000-0000-0000-000000000001', 'ELEC-001', 'Arduino Uno R3', 'Microcontroller board', 25),
  ('00000000-0000-0000-0000-000000000001', 'ELEC-002', 'Raspberry Pi 4B 8GB', 'Single-board computer', 12),
  ('00000000-0000-0000-0000-000000000001', 'CABLE-001', 'Cat6 Ethernet Cable 3m', 'Network cable', 100),
  ('00000000-0000-0000-0000-000000000001', 'TOOL-001', 'Weller WE1010 Soldering Station', 'Temperature-controlled soldering station', 3),
  ('00000000-0000-0000-0000-000000000001', 'STOR-001', 'Anti-Static Component Bins', 'ESD-safe storage bins', 50);
