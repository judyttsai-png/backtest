#!/usr/bin/env bash
# BACKTEST — start backend + frontend together (macOS / Linux). Ctrl+C stops both.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -d "$ROOT/backend/.venv" ] || [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "Not installed yet — run ./install.sh first."
  exit 1
fi

# Backend in the background; --reload picks up code edits.
cd "$ROOT/backend"
./.venv/bin/uvicorn app.main:app --port 8000 --reload &
BACK=$!
trap 'kill "$BACK" 2>/dev/null || true' EXIT INT TERM

echo "→ Backend starting on http://localhost:8000  (give it ~15s to import)"
echo "→ Frontend on http://localhost:5173"

# Frontend in the foreground.
cd "$ROOT/frontend"
npm run dev
