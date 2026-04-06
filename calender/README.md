# Calendar Desktop Application

A desktop calendar application built with Electron, React, and a centralized Bun API server.

## Architecture

- **Desktop Client**: Electron + React + TypeScript + TanStack Query + Zustand
- **API Server**: Bun + Hono + Drizzle ORM + PostgreSQL + Redis
- **Monorepo**: Turborepo with Bun workspaces

## Prerequisites

- [Bun](https://bun.sh/) >= 1.1
- [Docker](https://www.docker.com/) (for PostgreSQL and Redis)
- [Node.js](https://nodejs.org/) >= 20 (for Electron)

## Getting Started

### 1. Install dependencies

```bash
bun install
```

### 2. Start database services

```bash
cd infra
docker-compose up -d
```

### 3. Run database migrations

```bash
bun run db:migrate
```

### 4. Start the API server

```bash
bun run dev:api
```

The API server starts on `http://localhost:3100`. Verify with:

```bash
curl http://localhost:3100/health
```

### 5. Start the Electron app (in a separate terminal)

```bash
bun run dev:desktop
```

## Project Structure

```
calendar-app/
├── apps/
│   ├── api/          # Bun API server (Hono + Drizzle + PostgreSQL)
│   └── desktop/      # Electron desktop client (React + TanStack Query)
├── packages/
│   ├── types/        # Shared TypeScript type definitions
│   └── shared-utils/ # Shared utility functions (date, validation)
├── infra/            # Docker Compose for dev services
└── docs/             # Architecture and planning documents
```

## API Endpoints

| Group | Base Path | Auth Required |
|-------|-----------|---------------|
| Auth | `/api/auth/*` | Partial |
| Calendars | `/api/calendars/*` | Yes |
| Events | `/api/events/*` | Yes |
| Reminders | `/api/reminders/*` | Yes |
| Imports | `/api/imports/*` | Yes |
| Sync | `/api/sync/*` | Yes |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `T` | Go to today |
| `M` | Month view |
| `W` | Week view |
| `D` | Day view |
| `N` | New event |
| `←` / `→` | Navigate previous / next period |
| `Escape` | Close current modal |
| `Cmd+N` | New event (menu) |
| `Cmd+I` | Import .ics file (menu) |
| `Cmd+1/2/3` | Switch to month/week/day view (menu) |

## Environment Variables

Copy `.env.example` to `.env` in the project root and adjust values as needed.

## Development

```bash
# Run API tests
cd apps/api && bun test

# Generate new migration after schema changes
bun run db:generate

# Build for production
bun run build

# Package Electron app
cd apps/desktop && npm run build
```

## Implementation Status

- [x] Phase 0: Architecture and planning
- [x] Phase 1: Foundation (monorepo, auth, database, Electron shell)
- [x] Phase 2: Core calendar rendering (month/week/day views, sidebar, sync)
- [x] Phase 3: Event CRUD (create/edit/delete, recurrence, optimistic updates)
- [x] Phase 4: Reminders and notifications (engine, snooze/dismiss, recovery)
- [x] Phase 5: Imports (.ics upload with preview, feed subscriptions, polling)
- [x] Phase 6: Hardening and polish (accessibility, keyboard nav, error boundaries, packaging)

## Test Coverage (49 tests)

- Date utilities: month ranges, week ranges, grid generation, overlap detection
- Validation: email, timezone, hex color, date range, UUID
- Recurrence: RRULE parsing, daily/weekly/monthly/yearly expansion, COUNT, UNTIL, INTERVAL
- ICS parser: basic events, all-day, recurring, organizer/attendees, line folding, malformed data
- Reminder logic: trigger calculation, snooze arithmetic
- E2E contracts: auth, calendar, event, reminder, and import validation schemas
- Edge cases: year boundary crossings, leap years, single-occurrence recurrences

## Accessibility

- Keyboard navigation for all calendar views and modals
- ARIA grid semantics on month view
- Focus trapping in modals
- Skip-to-content link
- Screen-reader-friendly event labels
- `prefers-reduced-motion` support
- `prefers-contrast: high` support
- Visible focus indicators on all interactive elements
