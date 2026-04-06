# Nonprofit CRM

A combined Donation Tracking + CRM platform for nonprofits.

**Stack:** Bun · Vanilla JS · PostgreSQL

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- PostgreSQL 15+

### Setup

```bash
# 1. Clone and install
git clone <repo-url> && cd nonprofit-crm
bun install

# 2. Configure
cp .env.example .env
# Edit .env with your DATABASE_URL

# 3. Create database
createdb nonprofit_crm

# 4. Run migrations and seed
bun run db:migrate
bun run db:seed

# 5. Start dev server
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in:

| Account              | Password   | Role    |
|----------------------|------------|---------|
| admin@nonprofit.org  | admin123   | Admin   |
| staff@nonprofit.org  | staff123   | Staff   |

## Scripts

| Command              | Description                        |
|----------------------|------------------------------------|
| `bun run dev`        | Start server with file watching    |
| `bun run start`      | Start server (production)          |
| `bun run test`       | Run test suite                     |
| `bun run db:migrate` | Apply database migrations          |
| `bun run db:seed`    | Populate sample data               |
| `bun run db:reset`   | Drop and recreate schema           |

## Project Structure

```
nonprofit-crm/
├── server/           # Bun HTTP server
│   ├── index.js      # Entry point
│   ├── lib/          # Core: router, templates, db, validation
│   ├── middleware/    # Auth, body parsing
│   └── routes/       # Route handlers
├── public/           # Static assets (CSS, JS)
├── db/               # Migrations and seeds
├── test/             # Test files
└── docs/             # Documentation
```

## Architecture

- **Server:** Bun.serve with a custom minimal router
- **Views:** Server-rendered HTML via template literals
- **Auth:** Cookie-based sessions with CSRF protection
- **Database:** PostgreSQL with parameterized queries (no ORM)
- **Donations:** Append-only ledger; corrections via adjustment records
- **Audit:** All mutations logged with actor + before/after snapshots
