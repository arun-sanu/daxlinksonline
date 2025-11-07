#!/usr/bin/env bash

# One‑command local runner for PENDAX-SDK demo stack
# - Installs backend deps
# - Pushes Prisma schema and seeds demo data (idempotent)
# - Starts the backend API on PORT (default 4000)
# - Serves the UI on UI_PORT (default 5173)
#
# Usage:
#   bash scripts/daxlinks.sh [--api-port 4000] [--ui-port 5173] [--no-ui] [--skip-db-check]
#
# Optional (if you need a local Postgres):
#   docker run --name daxlinks-postgres -e POSTGRES_USER=daxlinks -e POSTGRES_PASSWORD='#@Nightshade1n' -e POSTGRES_DB=daxlinks -p 5432:5432 -d postgres:16

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
UI_DIR="$REPO_ROOT/ui"
LOG_DIR="$REPO_ROOT/.logs"
mkdir -p "$LOG_DIR"

API_PORT="4000"
UI_PORT="5173"
RUN_UI=1
SKIP_DB_CHECK=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-port)
      API_PORT="$2"; shift 2;;
    --ui-port)
      UI_PORT="$2"; shift 2;;
    --no-ui)
      RUN_UI=0; shift;;
    --skip-db-check)
      SKIP_DB_CHECK=1; shift;;
    -h|--help)
      echo "Usage: bash scripts/daxlinks.sh [--api-port 4000] [--ui-port 5173] [--no-ui]"; exit 0;;
    *)
      echo "Unknown option: $1"; exit 1;;
  esac
done

info() { echo -e "\033[1;34m[info]\033[0m $*"; }
ok()   { echo -e "\033[1;32m[ ok ]\033[0m $*"; }
err()  { echo -e "\033[1;31m[err ]\033[0m $*" 1>&2; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Missing dependency: $1"
    exit 1
  fi
}

need_cmd node
need_cmd npm

# Try to load backend/.env for DATABASE_URL and auth settings
load_env() {
  if [[ -f "$BACKEND_DIR/.env" ]]; then
    # shellcheck disable=SC1091
    set -a; . "$BACKEND_DIR/.env"; set +a
  fi
}

db_ready() {
  # Prefer pg_isready when available (non-interactive)
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -d "${DATABASE_URL:-}" -t 1 >/dev/null 2>&1
    return $?
  fi
  # If psql exists, try a fast, non-interactive check (may prompt; avoid)
  if command -v psql >/dev/null 2>&1; then
    PGSERVICEOPTS="-w" psql "${DATABASE_URL:-}" -Atqc 'SELECT 1;' >/dev/null 2>&1 || return 1
    return 0
  fi
  # No tools to verify; unknown state
  return 2
}

ensure_postgres_running() {
  if [[ "$SKIP_DB_CHECK" -eq 1 ]]; then
    info "Skipping DB readiness check by user request."
    return 0
  fi
  if [[ -z "${DATABASE_URL:-}" ]]; then
    info "DATABASE_URL not set yet; skipping DB preflight (Prisma will fail if unreachable)."
    return 0
  fi
  if db_ready; then
    ok "Postgres is reachable."
    return 0
  fi
  rc=$?
  if [[ $rc -eq 2 ]]; then
    info "No pg_isready/psql found; continuing without preflight (install postgresql-client for checks)."
    return 0
  fi
  info "Postgres not reachable; attempting to start local service..."
  if command -v systemctl >/dev/null 2>&1; then
    systemctl start postgresql 2>/dev/null || true
  fi
  if command -v service >/dev/null 2>&1; then
    service postgresql start 2>/dev/null || true
  fi
  if command -v brew >/dev/null 2>&1; then
    brew services start postgresql 2>/dev/null || true
  fi
  # Wait up to ~15s
  for i in {1..30}; do
    if db_ready; then
      ok "Postgres is up."
      return 0
    fi
    sleep 0.5
  done
  err "Postgres not reachable. Continuing; Prisma will attempt connection and report errors."
  return 0
}

BACKEND_PID=""
UI_PID=""

cleanup() {
  echo
  info "Shutting down..."
  if [[ -n "$UI_PID" ]] && kill -0 "$UI_PID" 2>/dev/null; then
    kill "$UI_PID" 2>/dev/null || true
    wait "$UI_PID" 2>/dev/null || true
  fi
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

pushd "$BACKEND_DIR" >/dev/null

# Load env early to know DATABASE_URL and auth settings
load_env

# Ensure Postgres is up (best-effort) before prisma actions
ensure_postgres_running

info "Installing backend dependencies..."
if [[ -f package-lock.json ]]; then
  if ! npm ci; then
    err "npm ci failed (lockfile likely out-of-sync with package.json). Falling back to npm install to update the lockfile."
    npm install
  fi
else
  npm install
fi

info "Generating Prisma client..."
npx prisma generate

info "Syncing database schema (Prisma db push)..."
npx prisma db push

info "Seeding demo data (idempotent)..."
npm run prisma:seed || true

info "Starting backend API on port $API_PORT..."
# Auto-set CORS_ORIGINS to UI origin if not explicitly set
export CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:$UI_PORT}"
PORT="$API_PORT" node src/server.js > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

# Wait for API to be healthy
HAS_CURL=0
if command -v curl >/dev/null 2>&1; then HAS_CURL=1; fi
if [[ "$HAS_CURL" -eq 1 ]]; then
  info "Waiting for API health check..."
  for i in {1..60}; do
    if curl -fsS "http://localhost:$API_PORT/healthz" >/dev/null 2>&1; then
      ok "API is up at http://localhost:$API_PORT"
      break
    fi
    sleep 0.5
  done
else
  info "curl not found; sleeping briefly for server warmup..."
  sleep 2
fi

popd >/dev/null

if [[ "$RUN_UI" -eq 1 ]]; then
  info "Serving UI from $UI_DIR on port $UI_PORT..."
  if command -v python3 >/dev/null 2>&1; then
    pushd "$UI_DIR" >/dev/null
    python3 -m http.server "$UI_PORT" > "$LOG_DIR/ui.log" 2>&1 &
    UI_PID=$!
    popd >/dev/null
  elif command -v python >/dev/null 2>&1; then
    pushd "$UI_DIR" >/dev/null
    python -m http.server "$UI_PORT" > "$LOG_DIR/ui.log" 2>&1 &
    UI_PID=$!
    popd >/dev/null
  else
    err "Python is not installed; cannot serve UI automatically."
    err "Manually open $UI_DIR/index.html in a browser or run:"
    err "  (cd $UI_DIR && python3 -m http.server $UI_PORT)"
  fi
fi

echo
ok "Backend:  http://localhost:$API_PORT (logs: $LOG_DIR/backend.log)"
if [[ "$RUN_UI" -eq 1 ]]; then
  ok "UI:       http://localhost:$UI_PORT"
fi

echo
info "Seeded login (if fresh DB):"
echo "  Email:    operator@compendium.finance"
echo "  Password: pendax-demo-password"
echo
info "Press Ctrl+C to stop both servers."

# Keep the script running to maintain child processes
wait
