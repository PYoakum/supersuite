-- Enums
CREATE TYPE zone_type AS ENUM ('storage', 'receiving', 'shipping', 'staging');
CREATE TYPE item_condition AS ENUM ('new_item', 'used', 'refurbished', 'damaged');
CREATE TYPE item_status AS ENUM ('active', 'inactive', 'archived');
CREATE TYPE barcode_symbology AS ENUM ('Code128', 'Code39', 'EAN13', 'UPCA');
CREATE TYPE barcode_type AS ENUM ('internal', 'supplier', 'location');
CREATE TYPE transaction_type AS ENUM ('check_in', 'check_out', 'transfer', 'adjustment');
CREATE TYPE role_name AS ENUM ('admin', 'manager', 'operator', 'viewer');

-- Organizations
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  parent_organization_id UUID REFERENCES organizations(id),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Users & Roles (before transactions which reference users)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name role_name NOT NULL
);

-- Warehouses
CREATE TABLE warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL,
  address TEXT,
  three_scene_config JSONB,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id),
  role_id UUID NOT NULL REFERENCES roles(id),
  warehouse_id UUID REFERENCES warehouses(id),
  PRIMARY KEY (user_id, role_id)
);

-- Warehouse Zones
CREATE TABLE warehouse_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20) NOT NULL,
  type zone_type NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, code)
);

-- Warehouse Groups
CREATE TABLE warehouse_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL
);

-- Rack Locations
CREATE TABLE rack_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  zone_id UUID NOT NULL REFERENCES warehouse_zones(id),
  group_id UUID REFERENCES warehouse_groups(id),
  aisle VARCHAR(20) NOT NULL,
  rack VARCHAR(20) NOT NULL,
  shelf VARCHAR(20) NOT NULL,
  bin VARCHAR(20),
  label VARCHAR(100) NOT NULL,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  z DOUBLE PRECISION NOT NULL,
  width DOUBLE PRECISION NOT NULL,
  height DOUBLE PRECISION NOT NULL,
  depth DOUBLE PRECISION NOT NULL,
  deleted_at TIMESTAMPTZ,
  UNIQUE (warehouse_id, label)
);

-- Items
CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  sku VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  thumbnail_url VARCHAR(500),
  quantity INTEGER NOT NULL DEFAULT 0,
  unit VARCHAR(50) NOT NULL DEFAULT 'each',
  condition item_condition NOT NULL DEFAULT 'new_item',
  status item_status NOT NULL DEFAULT 'active',
  metadata_json JSONB,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sku)
);

-- Item Tags
CREATE TABLE item_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) UNIQUE NOT NULL,
  type VARCHAR(50) NOT NULL
);

CREATE TABLE item_tag_map (
  item_id UUID NOT NULL REFERENCES items(id),
  tag_id UUID NOT NULL REFERENCES item_tags(id),
  PRIMARY KEY (item_id, tag_id)
);

-- Barcodes
CREATE TABLE barcodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id),
  symbology barcode_symbology NOT NULL,
  value VARCHAR(255) UNIQUE NOT NULL,
  image_url VARCHAR(500),
  type barcode_type NOT NULL DEFAULT 'internal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inventory Assignments
CREATE TABLE inventory_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  rack_location_id UUID NOT NULL REFERENCES rack_locations(id),
  quantity INTEGER NOT NULL,
  placed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inventory Transactions (append-only)
CREATE TABLE inventory_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id),
  type transaction_type NOT NULL,
  from_location_id UUID REFERENCES rack_locations(id),
  to_location_id UUID REFERENCES rack_locations(id),
  quantity INTEGER NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Item Photos
CREATE TABLE item_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id),
  url VARCHAR(500) NOT NULL,
  thumbnail_url VARCHAR(500),
  alt_text VARCHAR(255),
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Indexes
CREATE INDEX idx_items_org ON items(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_status ON items(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_rack_locations_warehouse ON rack_locations(warehouse_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_inventory_assignments_item ON inventory_assignments(item_id);
CREATE INDEX idx_inventory_transactions_item ON inventory_transactions(item_id);
CREATE INDEX idx_barcodes_item ON barcodes(item_id);
CREATE INDEX idx_item_photos_item ON item_photos(item_id);
