-- ============================================================
-- Calendar Application — Migration 001: Initial Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------
-- users
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    name            TEXT NOT NULL,
    timezone        TEXT NOT NULL DEFAULT 'UTC',
    preferences     JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- -----------------------------------------------
-- calendars
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS calendars (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    color           TEXT NOT NULL DEFAULT '#3B82F6',
    is_default      BOOLEAN NOT NULL DEFAULT false,
    type            TEXT NOT NULL DEFAULT 'local'
                    CHECK (type IN ('local', 'imported', 'subscribed')),
    source_type     TEXT,
    source_ref      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_version    BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_calendars_user ON calendars (user_id);

-- -----------------------------------------------
-- events
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_id     UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    uid             TEXT,
    title           TEXT NOT NULL,
    description     TEXT,
    location        TEXT,
    start_at        TIMESTAMPTZ NOT NULL,
    end_at          TIMESTAMPTZ NOT NULL,
    timezone        TEXT NOT NULL DEFAULT 'UTC',
    all_day         BOOLEAN NOT NULL DEFAULT false,
    recurrence_rule TEXT,
    organizer       TEXT,
    invite_status   TEXT CHECK (invite_status IN (
                        'pending', 'accepted', 'declined', 'tentative'
                    )),
    source_type     TEXT,
    source_ref      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_version    BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_events_calendar ON events (calendar_id);
CREATE INDEX IF NOT EXISTS idx_events_range ON events (start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_events_uid_source ON events (uid, source_type, source_ref);
CREATE INDEX IF NOT EXISTS idx_events_sync ON events (sync_version);

-- -----------------------------------------------
-- event_exceptions (recurrence overrides)
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS event_exceptions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_event_id         UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    recurrence_instance_date DATE NOT NULL,
    overridden_start_at     TIMESTAMPTZ,
    overridden_end_at       TIMESTAMPTZ,
    overridden_title        TEXT,
    overridden_description  TEXT,
    overridden_location     TEXT,
    cancelled               BOOLEAN NOT NULL DEFAULT false,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exceptions_parent ON event_exceptions (parent_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exceptions_unique
    ON event_exceptions (parent_event_id, recurrence_instance_date);

-- -----------------------------------------------
-- reminders
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS reminders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    trigger_type    TEXT NOT NULL DEFAULT 'offset'
                    CHECK (trigger_type IN ('offset', 'absolute')),
    offset_minutes  INTEGER,
    trigger_at      TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN (
                        'pending', 'fired', 'dismissed', 'snoozed'
                    )),
    snoozed_until   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_event ON reminders (event_id);
CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders (status, trigger_at)
    WHERE status IN ('pending', 'snoozed');

-- -----------------------------------------------
-- import_sources
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS import_sources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    calendar_id     UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    source_type     TEXT NOT NULL
                    CHECK (source_type IN ('ics_file', 'ics_feed')),
    source_url      TEXT,
    filename        TEXT,
    polling_interval INTEGER DEFAULT 3600,
    last_run_at     TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'error')),
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_imports_user ON import_sources (user_id);
CREATE INDEX IF NOT EXISTS idx_imports_poll ON import_sources (status, last_run_at)
    WHERE source_type = 'ics_feed' AND status = 'active';

-- -----------------------------------------------
-- refresh_tokens
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens (token_hash);

-- -----------------------------------------------
-- Triggers: auto-update updated_at
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_calendars_updated ON calendars;
CREATE TRIGGER trg_calendars_updated BEFORE UPDATE ON calendars
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_events_updated ON events;
CREATE TRIGGER trg_events_updated BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_exceptions_updated ON event_exceptions;
CREATE TRIGGER trg_exceptions_updated BEFORE UPDATE ON event_exceptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_reminders_updated ON reminders;
CREATE TRIGGER trg_reminders_updated BEFORE UPDATE ON reminders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_imports_updated ON import_sources;
CREATE TRIGGER trg_imports_updated BEFORE UPDATE ON import_sources
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- -----------------------------------------------
-- Triggers: auto-increment sync_version
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION increment_sync_version()
RETURNS TRIGGER AS $$
BEGIN
    NEW.sync_version = OLD.sync_version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calendars_sync ON calendars;
CREATE TRIGGER trg_calendars_sync BEFORE UPDATE ON calendars
    FOR EACH ROW EXECUTE FUNCTION increment_sync_version();
DROP TRIGGER IF EXISTS trg_events_sync ON events;
CREATE TRIGGER trg_events_sync BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION increment_sync_version();
