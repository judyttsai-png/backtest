#!/usr/bin/env bash
# Serve BACKTEST on a public URL via a Cloudflare quick tunnel (macOS).
# Keeps the Mac awake, runs the backend single-origin, and opens the tunnel.
# Requires: ./install.sh already run, and cloudflared installed (brew install cloudflared).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v cloudflared >/dev/null || { echo "cloudflared not found — run: brew install cloudflared"; exit 1; }

# Keep the Mac awake while this is running (idle + system sleep). Note: closing a
# laptop lid still sleeps unless plugged in with an external display.
caffeinate -dimsu &
CAF=$!
trap 'kill $CAF 2>/dev/null || true' EXIT INT TERM

# Backend serves the built frontend + API on :8000 (FRONTEND_DIST + BASIC_AUTH in .env).
cd "$ROOT/backend"
./.venv/bin/uvicorn app.main:app --port 8000 >/tmp/backtest-backend.log 2>&1 &
BACK=$!
trap 'kill $CAF $BACK 2>/dev/null || true' EXIT INT TERM

echo "→ Backend starting on :8000 …"
until curl -s -o /dev/null http://localhost:8000/health 2>/dev/null; do sleep 1; done
echo "→ Backend ready. Opening the public tunnel — the https URL prints below."
echo "→ Log in with username 'desk' and your password."
echo ""

cd "$ROOT"
cloudflared tunnel --url http://localhost:8000
