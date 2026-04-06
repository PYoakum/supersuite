# Phase 0: Technical Architecture & Implementation Plan

## Calendar Desktop Application — Architecture Decision Record

**Status:** Draft
**Date:** 2026-03-08
**Author:** Implementation LLM

---

## 1. Technical Architecture

### 1.1 System Overview

The system consists of three principal tiers:

1. **Electron Desktop Client** — renders the calendar UI, manages local cache, displays OS-native notifications, and communicates with the API server.
2. **Bun API Server** — serves as the system of record for all calendar data, handles authentication, event CRUD, reminder scheduling, import processing, and sync.
3. **PostgreSQL + Redis** — PostgreSQL stores persistent state; Redis provides job queuing, caching, and pub/sub for reminder orchestration.

```
┌─────────────────────────────────────┐
│         Electron Desktop App        │
│  ┌───────────┐   ┌───────────────┐  │
│  │  React UI │   │  Local SQLite │  │
│  │ (Renderer)│   │    Cache      │  │
│  └─────┬─────┘   └───────┬───────┘  │
│        │                 │          │
│  ┌─────┴─────────────────┴───────┐  │
│  │       Sync Service Layer      │  │
│  └─────────────┬─────────────────┘  │
│                │                    │
│  ┌─────────────┴─────────────────┐  │
│  │   Notification Manager (Main) │  │
│  └───────────────────────────────┘  │
└────────────────┬────────────────────┘
                 │ HTTPS / REST
┌────────────────┴────────────────────┐
│          Bun API Server             │
│  ┌──────┐ ┌──────┐ ┌────────────┐  │
│  │ Auth │ │ CRUD │ │  Sync API  │  │
│  └──────┘ └──────┘ └────────────┘  │
│  ┌──────────┐ ┌──────────────────┐  │
│  │ Imports  │ │ Reminder Engine  │  │
│  └──────────┘ └──────────────────┘  │
│        │               │            │
│  ┌─────┴───────────────┴─────────┐  │
│  │   PostgreSQL   │    Redis     │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### 1.2 Component Responsibilities

#### Electron Main Process
- Application lifecycle management
- Native notification dispatch (via Electron `Notification` API)
- Local SQLite database management (via `better-sqlite3`)
- Background polling for pending reminders
- Deep-link handling from notification click-through
- IPC bridge to renderer process

#### Electron Renderer Process (React)
- Calendar rendering (month, week, day views)
- Day detail modal
- Event CRUD forms
- Import/feed management UI
- State management via React Query (TanStack Query) for server-synchronized caching
- Optimistic UI updates

#### Bun API Server
- RESTful JSON API over HTTPS
- JWT-based authentication with refresh tokens
- Event/calendar/reminder CRUD
- Recurrence expansion (RFC 5545 RRULE processing)
- ICS file parsing and feed polling
- Change tracking for incremental sync
- Background job execution via Redis-backed queue

### 1.3 Data Flow

**Read path (month view load):**
1. Renderer requests events for date range via React Query.
2. Sync service checks local SQLite cache for valid cached data.
3. If stale or missing, fetches from Bun API (`GET /api/events?start=...&end=...`).
4. API expands recurring events for the range, returns event instances.
5. Sync service writes to local cache, renderer displays.

**Write path (event creation):**
1. User submits event form in renderer.
2. Optimistic update applied locally.
3. Sync service posts to API (`POST /api/events`).
4. API validates, persists, schedules reminders, returns canonical record.
5. Local cache reconciled with server response.

**Reminder path:**
1. API reminder engine runs on a 30-second polling interval (Redis-sorted-set based).
2. When a reminder triggers, it marks status as `fired` and stores the payload.
3. Electron main process polls `GET /api/reminders/pending` every 30 seconds.
4. On receipt, displays OS notification and updates local state.
5. Notification click deep-links into the app, opening the relevant day modal.

**Import path:**
1. User uploads `.ics` file or provides feed URL.
2. API parses ICS data using `ical.js` library.
3. Events are deduplicated by UID + source identity.
4. Imported events are written with `source_type` and `source_ref` provenance.
5. Feed subscriptions are polled on configurable intervals via background jobs.

### 1.4 Key Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Client framework | React 18 + TypeScript | Mature ecosystem, component model fits calendar UI well |
| Client state | TanStack Query + Zustand | Query handles server cache; Zustand for UI-only state |
| Local persistence | better-sqlite3 | Synchronous reads for fast UI, no native compilation issues with Electron |
| API runtime | Bun | Fast startup, native TypeScript, built-in test runner |
| API framework | Hono | Lightweight, fast, works well with Bun |
| Database | PostgreSQL 16 | Robust, timezone-aware types, JSONB for flexible fields |
| Job queue | BullMQ on Redis | Proven, supports delayed/repeating jobs, good for reminders and feed polling |
| Auth | JWT (access + refresh) | Stateless verification, refresh for session continuity |
| ICS parsing | ical.js | Mature RFC 5545 parser, handles RRULE, VTIMEZONE |
| Recurrence | rrule.js | Reliable RRULE expansion, DST-safe with timezone support |
| Monorepo tool | Turborepo | Minimal config, good caching, works with Bun workspaces |

### 1.5 API Boundaries

All client-server communication uses JSON over HTTPS REST. The API is organized into these route groups:

- `/api/auth/*` — authentication and session management
- `/api/calendars/*` — calendar CRUD and subscription management
- `/api/events/*` — event CRUD, recurrence expansion, range queries
- `/api/reminders/*` — reminder CRUD, pending delivery, snooze/dismiss
- `/api/imports/*` — ICS upload, feed subscription, import history
- `/api/sync/*` — incremental change polling

### 1.6 Persistence Decisions

**Server-side (PostgreSQL):**
- All timestamps stored as `TIMESTAMPTZ` (UTC).
- Recurrence rules stored as RRULE strings on the parent event.
- Event exceptions stored in a dedicated table referencing the parent.
- Import provenance tracked via `source_type` and `source_ref` columns.
- Change tracking via `updated_at` + monotonic `sync_version` column.

**Client-side (SQLite):**
- Mirror tables for events, calendars, reminders (read cache).
- `sync_token` table tracking last successful sync per entity type.
- Data is authoritative only for display; server always wins on conflict.

---

## 2. Monorepo Folder Structure

```
calendar-app/
├── apps/
│   ├── api/                          # Bun API server
│   │   ├── src/
│   │   │   ├── server.ts             # Entry point
│   │   │   ├── config/
│   │   │   │   ├── index.ts          # Environment config
│   │   │   │   └── database.ts       # DB connection config
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts           # JWT verification
│   │   │   │   ├── error-handler.ts  # Global error handler
│   │   │   │   └── logger.ts         # Request logging
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── auth.routes.ts
│   │   │   │   │   ├── auth.service.ts
│   │   │   │   │   └── auth.validators.ts
│   │   │   │   ├── calendars/
│   │   │   │   │   ├── calendars.routes.ts
│   │   │   │   │   ├── calendars.service.ts
│   │   │   │   │   └── calendars.validators.ts
│   │   │   │   ├── events/
│   │   │   │   │   ├── events.routes.ts
│   │   │   │   │   ├── events.service.ts
│   │   │   │   │   ├── events.validators.ts
│   │   │   │   │   └── recurrence.service.ts
│   │   │   │   ├── reminders/
│   │   │   │   │   ├── reminders.routes.ts
│   │   │   │   │   ├── reminders.service.ts
│   │   │   │   │   └── reminder-engine.ts
│   │   │   │   ├── imports/
│   │   │   │   │   ├── imports.routes.ts
│   │   │   │   │   ├── imports.service.ts
│   │   │   │   │   ├── ics-parser.ts
│   │   │   │   │   └── feed-poller.ts
│   │   │   │   └── sync/
│   │   │   │       ├── sync.routes.ts
│   │   │   │       └── sync.service.ts
│   │   │   ├── db/
│   │   │   │   ├── migrations/
│   │   │   │   │   └── 001_initial_schema.ts
│   │   │   │   ├── schema.ts          # Drizzle schema definitions
│   │   │   │   └── client.ts          # Drizzle client
│   │   │   ├── jobs/
│   │   │   │   ├── queue.ts           # BullMQ setup
│   │   │   │   ├── reminder-worker.ts
│   │   │   │   └── feed-worker.ts
│   │   │   └── lib/
│   │   │       ├── errors.ts          # Typed error classes
│   │   │       ├── logger.ts          # Structured logger
│   │   │       └── jwt.ts             # Token utilities
│   │   ├── tests/
│   │   │   ├── modules/
│   │   │   │   ├── events.test.ts
│   │   │   │   ├── recurrence.test.ts
│   │   │   │   ├── reminders.test.ts
│   │   │   │   └── ics-parser.test.ts
│   │   │   └── helpers/
│   │   │       └── test-db.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── drizzle.config.ts
│   │
│   └── desktop/                       # Electron application
│       ├── src/
│       │   ├── main/
│       │   │   ├── index.ts           # Electron main entry
│       │   │   ├── notifications.ts   # OS notification manager
│       │   │   ├── local-db.ts        # SQLite cache setup
│       │   │   └── ipc-handlers.ts    # IPC bridge
│       │   ├── preload/
│       │   │   └── index.ts           # Context bridge
│       │   └── renderer/
│       │       ├── index.html
│       │       ├── main.tsx           # React entry
│       │       ├── App.tsx
│       │       ├── components/
│       │       │   ├── ui/            # Shared UI primitives
│       │       │   │   ├── Button.tsx
│       │       │   │   ├── Modal.tsx
│       │       │   │   ├── Input.tsx
│       │       │   │   └── Badge.tsx
│       │       │   ├── calendar/
│       │       │   │   ├── MonthView.tsx
│       │       │   │   ├── WeekView.tsx
│       │       │   │   ├── DayView.tsx
│       │       │   │   ├── DayCell.tsx
│       │       │   │   ├── EventStub.tsx
│       │       │   │   └── CalendarNav.tsx
│       │       │   └── layout/
│       │       │       ├── Sidebar.tsx
│       │       │       └── Header.tsx
│       │       ├── features/
│       │       │   ├── events/
│       │       │   │   ├── EventForm.tsx
│       │       │   │   ├── EventDetail.tsx
│       │       │   │   └── useEvents.ts
│       │       │   ├── reminders/
│       │       │   │   ├── ReminderConfig.tsx
│       │       │   │   └── useReminders.ts
│       │       │   ├── imports/
│       │       │   │   ├── IcsUpload.tsx
│       │       │   │   ├── FeedSubscribe.tsx
│       │       │   │   └── useImports.ts
│       │       │   └── day-modal/
│       │       │       ├── DayModal.tsx
│       │       │       ├── DayEventList.tsx
│       │       │       └── DayActions.tsx
│       │       ├── services/
│       │       │   ├── api-client.ts   # HTTP client wrapper
│       │       │   ├── sync.ts         # Sync orchestration
│       │       │   └── cache.ts        # Local cache reads
│       │       ├── state/
│       │       │   ├── calendar-store.ts
│       │       │   └── ui-store.ts
│       │       ├── hooks/
│       │       │   ├── useCalendarNav.ts
│       │       │   └── useNotifications.ts
│       │       └── styles/
│       │           ├── global.css
│       │           └── theme.ts
│       ├── electron-builder.yml
│       ├── package.json
│       ├── tsconfig.json
│       └── vite.config.ts
│
├── packages/
│   ├── types/                         # Shared TypeScript types
│   │   ├── src/
│   │   │   ├── models.ts             # Domain model types
│   │   │   ├── api.ts                # API request/response types
│   │   │   └── enums.ts              # Shared enumerations
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── shared-utils/                  # Shared utility functions
│       ├── src/
│       │   ├── date-utils.ts          # Timezone and date helpers
│       │   ├── recurrence-utils.ts    # RRULE helper functions
│       │   └── validation.ts          # Shared validation logic
│       ├── package.json
│       └── tsconfig.json
│
├── infra/
│   ├── docker-compose.yml             # PostgreSQL + Redis for dev
│   └── init.sql                       # Dev seed data
│
├── docs/
│   ├── phase-0-architecture.md        # This document
│   └── wireframes/                    # UI wireframes (future)
│
├── package.json                       # Root workspace config
├── turbo.json                         # Turborepo pipeline config
├── tsconfig.base.json                 # Shared TS config
└── README.md
```

---

## 3. Database Schema Draft

### 3.1 Entity Relationship Summary

```
users 1──* calendars 1──* events 1──* reminders
                               │
                               ├──* event_exceptions
                               │
calendars 1──* import_sources
```

### 3.2 Table Definitions

```sql
-- ============================================================
-- Migration 001: Initial Schema
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------
-- users
-- -----------------------------------------------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    name            TEXT NOT NULL,
    timezone        TEXT NOT NULL DEFAULT 'UTC',
    preferences     JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users (email);

-- -----------------------------------------------
-- calendars
-- -----------------------------------------------
CREATE TABLE calendars (
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

CREATE INDEX idx_calendars_user ON calendars (user_id);

-- -----------------------------------------------
-- events
-- -----------------------------------------------
CREATE TABLE events (
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

CREATE INDEX idx_events_calendar ON events (calendar_id);
CREATE INDEX idx_events_range ON events (start_at, end_at);
CREATE INDEX idx_events_uid_source ON events (uid, source_type, source_ref);
CREATE INDEX idx_events_sync ON events (sync_version);

-- -----------------------------------------------
-- event_exceptions (recurrence overrides)
-- -----------------------------------------------
CREATE TABLE event_exceptions (
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

CREATE INDEX idx_exceptions_parent ON event_exceptions (parent_event_id);
CREATE UNIQUE INDEX idx_exceptions_unique
    ON event_exceptions (parent_event_id, recurrence_instance_date);

-- -----------------------------------------------
-- reminders
-- -----------------------------------------------
CREATE TABLE reminders (
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

CREATE INDEX idx_reminders_event ON reminders (event_id);
CREATE INDEX idx_reminders_pending ON reminders (status, trigger_at)
    WHERE status IN ('pending', 'snoozed');

-- -----------------------------------------------
-- import_sources
-- -----------------------------------------------
CREATE TABLE import_sources (
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

CREATE INDEX idx_imports_user ON import_sources (user_id);
CREATE INDEX idx_imports_poll ON import_sources (status, last_run_at)
    WHERE source_type = 'ics_feed' AND status = 'active';

-- -----------------------------------------------
-- refresh_tokens
-- -----------------------------------------------
CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens (token_hash);

-- -----------------------------------------------
-- Trigger: auto-update updated_at
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_calendars_updated BEFORE UPDATE ON calendars
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_events_updated BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_exceptions_updated BEFORE UPDATE ON event_exceptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_reminders_updated BEFORE UPDATE ON reminders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_imports_updated BEFORE UPDATE ON import_sources
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- -----------------------------------------------
-- Trigger: auto-increment sync_version
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION increment_sync_version()
RETURNS TRIGGER AS $$
BEGIN
    NEW.sync_version = OLD.sync_version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_calendars_sync BEFORE UPDATE ON calendars
    FOR EACH ROW EXECUTE FUNCTION increment_sync_version();
CREATE TRIGGER trg_events_sync BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION increment_sync_version();
```

### 3.3 Schema Notes

- **sync_version**: Monotonically incrementing per-row version used for incremental sync. The client tracks the maximum sync_version it has seen and requests changes where `sync_version > last_known`.
- **uid + source deduplication**: The composite index on `(uid, source_type, source_ref)` enables efficient dedup during ICS imports.
- **Partial indexes**: The pending reminders index and active feed polling index use partial filters to keep lookups fast on the hot paths.
- **JSONB preferences**: User preferences (default reminder offset, week start day, time format) stored as JSONB for schema flexibility during early development.

---

## 4. API Endpoint Draft

### 4.1 Authentication

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account (email, password, name, timezone) |
| POST | `/api/auth/login` | Authenticate, returns access + refresh tokens |
| POST | `/api/auth/refresh` | Exchange refresh token for new access token |
| POST | `/api/auth/logout` | Revoke refresh token |
| GET | `/api/auth/me` | Current user profile |
| PATCH | `/api/auth/me` | Update profile (name, timezone, preferences) |

### 4.2 Calendars

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/calendars` | List all calendars for current user |
| POST | `/api/calendars` | Create a new calendar |
| PATCH | `/api/calendars/:id` | Update calendar (name, color, default) |
| DELETE | `/api/calendars/:id` | Delete calendar and all its events |

### 4.3 Events

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/events` | List events in date range (`?start=...&end=...`), expands recurrences |
| GET | `/api/events/:id` | Get single event detail |
| POST | `/api/events` | Create event |
| PATCH | `/api/events/:id` | Update event |
| DELETE | `/api/events/:id` | Delete event (with option: `?scope=this\|following\|all` for recurring) |
| GET | `/api/events/day/:date` | Get all events for a specific day (expanded) |

**Query parameters for `GET /api/events`:**
- `start` (required): ISO 8601 date, range start
- `end` (required): ISO 8601 date, range end
- `calendar_id` (optional): filter to specific calendar
- `search` (optional): full-text search across title, description, location

**Create/Update event body:**
```json
{
    "calendar_id": "uuid",
    "title": "Team Standup",
    "description": "Daily sync",
    "location": "Room 4B",
    "start_at": "2026-03-09T09:00:00Z",
    "end_at": "2026-03-09T09:30:00Z",
    "timezone": "America/New_York",
    "all_day": false,
    "recurrence_rule": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    "reminders": [
        { "offset_minutes": 10 },
        { "offset_minutes": 0 }
    ]
}
```

### 4.4 Reminders

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reminders/pending` | Get fired reminders not yet dismissed (polled by client) |
| POST | `/api/reminders` | Create reminder for an event |
| PATCH | `/api/reminders/:id` | Update reminder |
| DELETE | `/api/reminders/:id` | Delete reminder |
| POST | `/api/reminders/:id/snooze` | Snooze reminder (`{ "minutes": 10 }`) |
| POST | `/api/reminders/:id/dismiss` | Dismiss reminder |

### 4.5 Imports

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/imports/ics` | Upload and import `.ics` file |
| POST | `/api/imports/ics/preview` | Parse `.ics` and return preview without importing |
| POST | `/api/imports/feeds` | Subscribe to ICS feed URL |
| POST | `/api/imports/feeds/:id/sync` | Trigger immediate feed sync |
| DELETE | `/api/imports/feeds/:id` | Unsubscribe from feed |
| GET | `/api/imports` | List all import sources with status |
| GET | `/api/imports/:id/history` | Get import run history and errors |

### 4.6 Sync

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sync/changes` | Incremental changes since `?since_version=N` |

**Response shape for sync:**
```json
{
    "changes": {
        "calendars": { "upserted": [...], "deleted": ["uuid", ...] },
        "events": { "upserted": [...], "deleted": ["uuid", ...] },
        "reminders": { "upserted": [...], "deleted": ["uuid", ...] }
    },
    "current_version": 1042
}
```

### 4.7 Common Response Patterns

**Success:** `{ "data": ... }`
**Error:** `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }`
**Pagination:** `{ "data": [...], "pagination": { "total": 50, "limit": 25, "offset": 0 } }`

---

## 5. Milestone-Based Implementation Plan

### Phase 1: Foundation (Estimated: 5 days)

**Goal:** Runnable API server and Electron shell with auth and database ready.

| # | Task | Deliverable | Acceptance Criteria |
|---|------|-------------|---------------------|
| 1.1 | Initialize monorepo with Turborepo + Bun workspaces | Root config, packages/types, packages/shared-utils | `bun install` succeeds from root |
| 1.2 | Scaffold Bun API with Hono | Server starts, health endpoint responds | `GET /health` returns 200 |
| 1.3 | Set up PostgreSQL via Docker Compose + Drizzle ORM | docker-compose.yml, schema.ts, migration | Tables created in dev database |
| 1.4 | Implement auth module | Register, login, refresh, logout, me | Token-based auth flow works end-to-end |
| 1.5 | Scaffold Electron app with Vite + React | App opens, renders placeholder | Electron window launches |
| 1.6 | Set up local SQLite cache in Electron | better-sqlite3 initialized, cache tables created | Cache reads/writes work |
| 1.7 | API client and auth integration in Electron | Login flow connects client to server | User can sign in from desktop app |
| 1.8 | Logging and error handling baseline | Structured logger, global error middleware | Errors logged with request context |

### Phase 2: Core Calendar Rendering (Estimated: 5 days)

**Goal:** Month view with day cells showing schedule stubs, clickable day modal.

| # | Task | Deliverable | Acceptance Criteria |
|---|------|-------------|---------------------|
| 2.1 | Calendar CRUD API | List, create, update, delete calendars | API tests pass |
| 2.2 | Events range query API | `GET /api/events?start=...&end=...` with recurrence expansion | Returns correct events for any month |
| 2.3 | Month view component | Grid with day cells, navigation (prev/next month) | Renders current month correctly |
| 2.4 | Day cell with schedule stubs | Shows up to 3 events, overflow indicator | Dense month displays correctly |
| 2.5 | Day detail modal | Opens on day click, lists all events chronologically | Modal shows full day schedule |
| 2.6 | Week and day views | Alternative view rendering | View toggle works |
| 2.7 | Sync service and cache hydration | Fetches and caches events for visible range | Month view loads from cache on revisit |

### Phase 3: Event CRUD (Estimated: 4 days)

**Goal:** Full event creation, editing, and deletion with recurrence support.

| # | Task | Deliverable | Acceptance Criteria |
|---|------|-------------|---------------------|
| 3.1 | Event create/edit form | Modal form with all fields, validation | Events persist to server |
| 3.2 | Event deletion | Delete single, this-and-following, all (recurring) | Correct instances removed |
| 3.3 | Recurrence rule support | RRULE creation UI, expansion logic | Recurring events display correctly across months |
| 3.4 | Recurrence exceptions | Override or cancel individual instances | Exceptions render correctly |
| 3.5 | Optimistic updates | Immediate UI feedback on mutations | No visible lag on create/edit/delete |
| 3.6 | Validation and tests | API validation, domain logic unit tests | Critical paths covered |

### Phase 4: Reminders & Notifications (Estimated: 3 days)

**Goal:** Configurable reminders that produce OS-native desktop notifications.

| # | Task | Deliverable | Acceptance Criteria |
|---|------|-------------|---------------------|
| 4.1 | Reminder CRUD API + engine | Create, update, delete reminders; background firing | Reminders fire at correct times |
| 4.2 | Redis + BullMQ setup | Job queue for reminder scheduling | Jobs process reliably |
| 4.3 | Desktop notification integration | Electron main process displays OS notifications | Notifications appear on time |
| 4.4 | Snooze and dismiss | Snooze pushes trigger forward; dismiss clears | State transitions work correctly |
| 4.5 | Restart recovery | On app start, fetch missed reminders | No silent losses after restart |

### Phase 5: Imports (Estimated: 4 days)

**Goal:** Import events from `.ics` files and subscribe to ICS feeds.

| # | Task | Deliverable | Acceptance Criteria |
|---|------|-------------|---------------------|
| 5.1 | ICS parser module | Parse `.ics` files with ical.js | Handles standard event/invite fields |
| 5.2 | File upload import flow | Upload UI, preview, confirm | Events appear in calendar after import |
| 5.3 | Feed subscription | Subscribe to URL, initial sync | Feed events populate calendar |
| 5.4 | Background feed polling | BullMQ repeating job for each active feed | Feed updates reflected in calendar |
| 5.5 | Deduplication and update | UID-based dedup, update on re-import | No duplicates; changes reflected |
| 5.6 | Import status and errors | Error logging, UI for import history | User can see import results |

### Phase 6: Hardening & Polish (Estimated: 3 days)

**Goal:** Production-quality reliability, accessibility, and performance.

| # | Task | Deliverable | Acceptance Criteria |
|---|------|-------------|---------------------|
| 6.1 | Accessibility pass | Keyboard nav, focus trapping, ARIA labels | Keyboard-only navigation works |
| 6.2 | Performance tuning | Lazy-load modal details, optimize range queries | Month view renders in < 200ms |
| 6.3 | Offline and reconnect | Graceful degradation, sync on reconnect | App usable without connectivity |
| 6.4 | End-to-end test coverage | Critical path integration tests | Auth, CRUD, reminders, import covered |
| 6.5 | Electron packaging | electron-builder config for macOS/Windows/Linux | Installable builds produced |

**Total estimated MVP timeline: ~24 working days**

---

## 6. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Timezone/DST rendering bugs | High | High | Use `luxon` or `date-fns-tz` exclusively for date math; extensive test cases for DST transitions |
| Recurring event complexity | Medium | High | Rely on `rrule.js` for expansion; model exceptions explicitly; defer complex UI editing of RRULE to post-MVP |
| Duplicate imports | Medium | Medium | Composite dedup key (uid + source_type + source_ref); upsert semantics |
| Malformed ICS data | High | Low | Tolerant parser with validation layer; skip invalid events with logged warnings |
| Reminder delivery gaps | Medium | High | Persistent reminder state; startup recovery scan; 30s polling ceiling |
| Electron performance on dense months | Medium | Medium | Virtualized rendering for >50 events; compact stubs; lazy modal loading |
| Offline data staleness | Low | Medium | Clear staleness indicators in UI; auto-sync on reconnect; server-wins conflict policy |

---

## 7. Assumptions

1. Single-user MVP (multi-user auth exists but no shared/team calendars).
2. PostgreSQL and Redis are available in the deployment environment (Docker Compose for dev).
3. Electron auto-update is out of scope for MVP.
4. The Bun API runs on `localhost` during development; deployment configuration is deferred.
5. Feed polling interval minimum is 15 minutes to avoid abuse of external servers.
6. All-day events are stored as start-of-day to start-of-next-day in the user's timezone.
7. RRULE editing UI is limited to common patterns (daily, weekly, monthly, yearly) in MVP; raw RRULE entry is a fallback.

---

## Next Step

With Phase 0 deliverables complete, the next action is to begin **Phase 1: Foundation** — initializing the monorepo, scaffolding the API and Electron app, setting up the database, and implementing authentication.
