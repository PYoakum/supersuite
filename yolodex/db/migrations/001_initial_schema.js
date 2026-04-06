/**
 * Initial schema: accounts, contacts, organizations, memberships,
 * donations, pledges, interactions, notes, tasks, tags, audit_log.
 */
export async function up(sql) {
  // === Accounts (staff users) ===
  await sql`
    CREATE TABLE accounts (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      first_name    TEXT NOT NULL DEFAULT '',
      last_name     TEXT NOT NULL DEFAULT '',
      role          TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff', 'readonly')),
      is_active     BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // === Contacts (people) ===
  await sql`
    CREATE TABLE contacts (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      first_name              TEXT NOT NULL,
      last_name               TEXT NOT NULL,
      email                   TEXT,
      phone                   TEXT,
      address_line1           TEXT,
      address_line2           TEXT,
      city                    TEXT,
      state                   TEXT,
      postal_code             TEXT,
      country                 TEXT DEFAULT 'US',
      preferred_contact_method TEXT DEFAULT 'email' CHECK (preferred_contact_method IN ('email', 'phone', 'mail')),
      lifecycle_stage         TEXT DEFAULT 'prospect' CHECK (lifecycle_stage IN ('prospect', 'active', 'donor', 'lapsed', 'inactive')),
      is_deleted              BOOLEAN NOT NULL DEFAULT false,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX idx_contacts_name ON contacts (last_name, first_name)`;
  await sql`CREATE INDEX idx_contacts_email ON contacts (email) WHERE email IS NOT NULL`;

  // === Organizations ===
  await sql`
    CREATE TABLE organizations (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name             TEXT NOT NULL,
      address_line1    TEXT,
      city             TEXT,
      state            TEXT,
      postal_code      TEXT,
      country          TEXT DEFAULT 'US',
      phone            TEXT,
      email            TEXT,
      primary_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
      is_deleted       BOOLEAN NOT NULL DEFAULT false,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // === Contact ↔ Organization (many-to-many) ===
  await sql`
    CREATE TABLE contact_organizations (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      role_title      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(contact_id, organization_id)
    )
  `;

  // === Memberships ===
  await sql`
    CREATE TABLE memberships (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      status        TEXT NOT NULL DEFAULT 'prospect' CHECK (status IN ('prospect', 'active', 'lapsed', 'cancelled')),
      level         TEXT NOT NULL DEFAULT 'standard',
      dues_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
      start_date    DATE,
      end_date      DATE,
      renewal_date  DATE,
      notes         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX idx_memberships_status ON memberships (status, renewal_date)`;
  await sql`CREATE INDEX idx_memberships_contact ON memberships (contact_id)`;

  // === Donations ===
  await sql`
    CREATE TABLE donations (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id    UUID REFERENCES contacts(id) ON DELETE SET NULL,
      amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      currency      TEXT NOT NULL DEFAULT 'USD',
      received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      method        TEXT NOT NULL DEFAULT 'other' CHECK (method IN ('cash', 'check', 'card', 'ach', 'other')),
      designation   TEXT,
      fund          TEXT,
      reference_id  TEXT,
      memo          TEXT,
      receipt_number TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      -- Immutable: no updated_at. Corrections via donation_adjustments.
    )
  `;
  await sql`CREATE INDEX idx_donations_contact ON donations (contact_id, received_at DESC)`;
  await sql`CREATE INDEX idx_donations_date ON donations (received_at DESC)`;

  // === Donation Adjustments (corrections without mutating donations) ===
  await sql`
    CREATE TABLE donation_adjustments (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      donation_id     UUID NOT NULL REFERENCES donations(id) ON DELETE RESTRICT,
      adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('correction', 'reversal', 'refund')),
      amount          NUMERIC(12,2) NOT NULL,
      reason          TEXT,
      created_by      UUID REFERENCES accounts(id),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // === Pledges ===
  await sql`
    CREATE TABLE pledges (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      amount_total  NUMERIC(12,2) NOT NULL,
      cadence       TEXT DEFAULT 'one-time' CHECK (cadence IN ('one-time', 'monthly', 'quarterly', 'annually')),
      start_date    DATE NOT NULL,
      end_date      DATE,
      status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fulfilled', 'cancelled')),
      notes         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // === Interactions ===
  await sql`
    CREATE TABLE interactions (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      type        TEXT NOT NULL CHECK (type IN ('call', 'email', 'meeting', 'other')),
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      summary     TEXT,
      outcome     TEXT,
      created_by  UUID REFERENCES accounts(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX idx_interactions_contact ON interactions (contact_id, occurred_at DESC)`;

  // === Notes ===
  await sql`
    CREATE TABLE notes (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      body        TEXT NOT NULL,
      created_by  UUID REFERENCES accounts(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX idx_notes_contact ON notes (contact_id, created_at DESC)`;

  // === Tasks ===
  await sql`
    CREATE TABLE tasks (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id  UUID REFERENCES contacts(id) ON DELETE SET NULL,
      assigned_to UUID REFERENCES accounts(id) ON DELETE SET NULL,
      title       TEXT NOT NULL,
      body        TEXT,
      due_at      TIMESTAMPTZ,
      status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
      created_by  UUID REFERENCES accounts(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX idx_tasks_assigned ON tasks (assigned_to, status)`;

  // === Tags ===
  await sql`
    CREATE TABLE tags (
      id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT UNIQUE NOT NULL
    )
  `;

  await sql`
    CREATE TABLE contact_tags (
      contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      tag_id     UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (contact_id, tag_id)
    )
  `;
  await sql`CREATE INDEX idx_contact_tags_tag ON contact_tags (tag_id, contact_id)`;

  // === Audit Log ===
  await sql`
    CREATE TABLE audit_log (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_account_id  UUID REFERENCES accounts(id),
      entity_type       TEXT NOT NULL,
      entity_id         UUID NOT NULL,
      action            TEXT NOT NULL,
      before_json       JSONB,
      after_json        JSONB,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id)`;
  await sql`CREATE INDEX idx_audit_time ON audit_log (created_at DESC)`;

  // === App Settings ===
  await sql`
    CREATE TABLE app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;

  // Insert default settings
  await sql`
    INSERT INTO app_settings (key, value) VALUES
      ('org_name', 'My Nonprofit'),
      ('receipt_prefix', 'RCP'),
      ('default_currency', 'USD'),
      ('grace_period_days', '30')
  `;
}
