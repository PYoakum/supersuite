#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_DIR="$ROOT_DIR/apps/api"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[calendar]${NC} $1"; }
ok()   { echo -e "${GREEN}[calendar]${NC} $1"; }
warn() { echo -e "${YELLOW}[calendar]${NC} $1"; }
err()  { echo -e "${RED}[calendar]${NC} $1"; }

cleanup() {
    log "Shutting down..."
    kill "$API_PID" 2>/dev/null || true
    kill "$DESKTOP_PID" 2>/dev/null || true
    wait 2>/dev/null
    ok "All processes stopped."
}
trap cleanup EXIT INT TERM

# ── Preflight checks ──────────────────────────────────────

if ! command -v bun &>/dev/null; then
    err "bun is not installed. See https://bun.sh/"
    exit 1
fi

if ! command -v docker &>/dev/null; then
    err "docker is not installed. See https://www.docker.com/"
    exit 1
fi

# ── Install dependencies ──────────────────────────────────

if [ ! -d "$ROOT_DIR/node_modules" ]; then
    log "Installing dependencies..."
    cd "$ROOT_DIR" && bun install
fi

# ── Start infrastructure (PostgreSQL + Redis) ─────────────

if [ -f "$ROOT_DIR/infra/docker-compose.yml" ]; then
    log "Starting database services..."
    docker compose -f "$ROOT_DIR/infra/docker-compose.yml" up -d
    ok "Database services ready."
else
    warn "No infra/docker-compose.yml found — skipping database services."
fi

# ── Run migrations ────────────────────────────────────────

log "Running database migrations..."
cd "$ROOT_DIR" && bun run db:migrate || warn "Migration step skipped (script may not be configured yet)."

# ── Start API server ──────────────────────────────────────

log "Starting API server..."
cd "$API_DIR" && bun run src/server.ts &
API_PID=$!
ok "API server started (PID $API_PID)"

# Wait for health check
for i in $(seq 1 30); do
    if curl -sf http://localhost:3100/health &>/dev/null; then
        ok "API server healthy at http://localhost:3100"
        break
    fi
    if [ "$i" -eq 30 ]; then
        err "API server failed to start within 30s"
        exit 1
    fi
    sleep 1
done

# ── Start Electron desktop app ────────────────────────────

log "Starting desktop app..."
cd "$DESKTOP_DIR" && bun run dev &
DESKTOP_PID=$!
ok "Desktop app started (PID $DESKTOP_PID)"

echo ""
ok "Calendar is running!"
log "API:     http://localhost:3100"
log "Health:  http://localhost:3100/health"
echo ""
log "Press Ctrl+C to stop all services."

wait
