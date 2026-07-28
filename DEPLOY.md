# Deploying BACKTEST to a permanent public link

The app ships as **one container**: it builds the React frontend and serves it
*and* the API from a single FastAPI process (one origin, no CORS), with SQLite +
in-process tasks (no Postgres/Redis needed). A **password gate** protects it.

Everything below is verified locally: production build passes, `/` serves the
app, `/api/*` works on the same origin, and the password gate returns 401
without credentials (200 with).

---

## 1. Add your FX data (optional but recommended)

By default the container boots with the **synthetic** provider (fake data — good
for a first deploy to confirm it's live). To serve your real FX data:

1. Copy your parquet into the repo: `cp .../fx_15min.parquet data/fx_15min.parquet`
2. Set these env vars on the host (step 3): `DEFAULT_DATA_PROVIDER=parquet` and
   `FX_PARQUET_PATH=/app/data/fx_15min.parquet`

(Or leave it on `yfinance` for delayed daily FX with no data file.)

---

## 2. Set the password (required before sharing)

A public URL is open to anyone with the link. Set both, or the app has **no auth**:

```
BASIC_AUTH_USER=<pick a username>
BASIC_AUTH_PASS=<pick a strong password>
```

The browser will prompt for these on first load. `/health` stays open so the
host's health check works.

---

## 3. Deploy (pick one)

### Option A — Render (easiest; free tier works)
1. Push this repo to a private GitHub repo.
2. Render → **New → Web Service** → connect the repo.
3. Environment: **Docker** (it finds the `Dockerfile`). Instance: Starter is fine.
4. Add the env vars from steps 1–2 (at minimum `BASIC_AUTH_USER` / `BASIC_AUTH_PASS`).
5. Create — Render builds and gives you `https://<name>.onrender.com` (permanent).

### Option B — Railway or Fly.io
- **Railway:** New Project → Deploy from GitHub repo → it uses the `Dockerfile`;
  add the env vars; you get a permanent `*.up.railway.app` URL.
- **Fly.io:** `fly launch` (detects the Dockerfile) → set secrets with
  `fly secrets set BASIC_AUTH_USER=... BASIC_AUTH_PASS=...` → `fly deploy`.

### Option C — Your own VPS (DigitalOcean / Hetzner / Lightsail)
```bash
# on the box, with Docker installed and the repo cloned:
docker build -t backtest .
docker run -d --restart unless-stopped -p 80:8000 \
  -e BASIC_AUTH_USER=you -e BASIC_AUTH_PASS=strongpass \
  -e DEFAULT_DATA_PROVIDER=parquet -e FX_PARQUET_PATH=/app/data/fx_15min.parquet \
  --name backtest backtest
```
For HTTPS, put **Caddy** in front (auto-TLS): a one-line `Caddyfile`
(`yourdomain.com { reverse_proxy localhost:8000 }`) gives you a real cert.

---

## 4. Custom domain (the "permanent link")
Point a subdomain (e.g. `backtest.yourcompany.com`) at the host per its docs
(Render/Railway/Fly all support custom domains with automatic HTTPS). A real
HTTPS domain is also what gets through **corporate firewalls** — tunnels and odd
ports usually don't, so test the URL on your work computer before relying on it.

---

## Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | (unset = no auth) | password gate |
| `DEFAULT_DATA_PROVIDER` | `synthetic` | `parquet` (your FX file) / `yfinance` / `synthetic` |
| `FX_PARQUET_PATH` | (unset) | `/app/data/fx_15min.parquet` when using parquet |
| `FRONTEND_DIST` | `/app/frontend_dist` | where the built UI is (set in the image) |
| `PORT` | `8000` | host may override |
| `DATABASE_URL` | SQLite file | leave as-is for single-container |

## Notes / limits
- **Data freshness** is still bounded by the feed (parquet is static; yfinance
  daily lags a few days). A public deploy doesn't make it more real-time.
- SQLite is fine for one user; for concurrent heavy use, move to the compose
  stack (Postgres/Redis) in `docker-compose.yml`.
- The build bakes the frontend at image-build time, so rebuild after code changes.
