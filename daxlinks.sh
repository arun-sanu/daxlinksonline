#!/usr/bin/env bash
set -euo pipefail

# DaxLinks orchestrator

echo "[daxlinks] starting backend API"
# Existing startup would go here, e.g.:
# (cd backend && npm run start &)

if [ "${FEATURE_NOTIFICATIONS:-true}" = "true" ]; then
  echo "[daxlinks] notifications enabled"
  # If you later move to a separate worker process, spawn it here:
  # node backend/src/workers/standalone.js &
fi

echo "[daxlinks] all services started"

