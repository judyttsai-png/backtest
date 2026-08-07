# BACKTEST

A full-stack **FX strategy backtesting + live-signals terminal**. Configure trading
models, backtest them across 11 years of FX data, find which strategy fits which
currency, and read live per-currency recommendations with volatility-scaled stops —
all in a dark, dense, terminal-style UI.

**Stack:** React + Vite (frontend) · FastAPI + SQLite + Celery-eager (backend) ·
pandas / numpy / scipy for the strategy engine. Runs entirely on your machine — no
Docker, Postgres, or Redis needed for local use.

---

## Prerequisites

| Tool | Version | Where to get it |
| --- | --- | --- |
| **Python** | **3.10 – 3.13** (3.13 recommended) | https://www.python.org/downloads/ |
| **Node.js** | 18+ (LTS) | https://nodejs.org/ |

> ⚠️ **Do not use Python 3.14.** The pinned `numpy` / `pandas` / `scipy` versions
> have no 3.14 wheels yet, so installation will fail. 3.13 is the sweet spot. The
> installer checks this for you and picks a compatible Python automatically.

---

## Install (one command)

Clone the repo, then from the project root:

**macOS / Linux**
```bash
./install.sh
```

**Windows** (PowerShell)
```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

This creates the Python virtualenv, installs backend + frontend dependencies, and
writes `backend/.env` pointing at the bundled FX data. It's safe to re-run.

## Run

**macOS / Linux**
```bash
./start.sh
```

**Windows** (PowerShell)
```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Then open **http://localhost:5173**. (Give the backend ~15s to finish importing on
first start — the masthead shows "backend online" when it's ready.)

To stop: `Ctrl+C` (macOS/Linux stops both; on Windows close the extra backend window).

<details>
<summary>Prefer to run the two services manually?</summary>

```bash
# Terminal 1 — backend
cd backend && ./.venv/bin/uvicorn app.main:app --port 8000 --reload
# Windows: .\.venv\Scripts\uvicorn.exe app.main:app --port 8000 --reload

# Terminal 2 — frontend
cd frontend && npm run dev
```
Keep `--reload` on the backend so code edits take effect without a restart.
</details>

---

## What's inside

Four tabs, all reading the same saved settings (persisted in your browser):

- **Backtest** — run a strategy on one pair or scan all 16; equity curve, metrics, trade log.
- **Signals** — live per-currency recommendations from your Playbook, each with a
  conviction score, suggested share of book, and an ATR-based stop/target. Plus a
  Velocity-Crossover **basket** view.
- **Fit** — a strategy × currency heatmap (out-of-sample net Sharpe): which model
  fits which currency.
- **Playbook** — assign each currency its strategies, bars, and constants (global
  defaults with per-currency overrides), then score them out-of-sample.

**Strategies:** SMA Divergence · DMI / ADX Trend · Velocity Crossover (cross-sectional) · Mean Reversion.

**Data:** a bundled 15-minute FX parquet (`data/fx_15min.parquet`, 16 major/cross
pairs, ~11 years) resampled to any bar. Emerging-market pairs and recent intraday
bars fall back to yfinance automatically (needs internet; ~60-day intraday history).

> ⚠️ Backtests are historical and, where noted, in-sample. Validate out-of-sample
> (the Fit/Playbook use a holdout) before trusting any result. Not investment advice.

---

## On a company computer

It's all **local** — the app serves `http://localhost:8000` (API) and `:5173` (UI),
and never exposes anything to the network, so a corporate firewall won't block *running*
it. A few things to know:

- **No admin rights needed.** The virtualenv is user-local and npm installs into the
  project folder. Nothing is installed system-wide.
- **Behind a proxy?** `pip` and `npm` honor proxy env vars. Set them before installing:
  ```bash
  export HTTPS_PROXY=http://your.proxy:port   # macOS/Linux
  $env:HTTPS_PROXY="http://your.proxy:port"    # Windows PowerShell
  ```
- **Python/Node blocked from python.org/nodejs.org?** Install them from your company
  software center instead — any Python 3.10–3.13 and Node 18+ works.
- **Ports 8000 / 5173** must be free. If one is taken:
  ```bash
  lsof -ti:8000 -ti:5173 | xargs kill -9          # macOS/Linux
  Get-NetTCPConnection -LocalPort 8000,5173 | %{ Stop-Process -Id $_.OwningProcess -Force }  # Windows
  ```
- **PowerShell script blocked?** That's the `-ExecutionPolicy Bypass` in the commands
  above — it runs the script without changing any machine policy.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Install fails compiling numpy/pandas | You're on Python 3.14 — install 3.13 and re-run `install`. |
| "backend offline" in the UI | Backend still importing (wait ~15s), or it isn't running — check the backend terminal. |
| Signals/Fit show nothing | Backend not reachable — confirm it's on `:8000`; the frontend proxies `/api` there. |
| Backend edits don't take effect | Make sure it's started with `--reload` (the start scripts do this). |
| Port already in use | Free ports 8000 / 5173 (see the company-computer section). |

---

## Deploy

To host it (single container, FastAPI serves the built frontend + API on one origin,
optional HTTP basic-auth gate), see **[`DEPLOY.md`](DEPLOY.md)** and the `Dockerfile`.

## Project layout

```
backend/    FastAPI + SQLAlchemy + Celery(eager) + strategy engine
  app/routers/     health, strategies, backtests, signals, fit, data, sweeps, walkforward
  app/services/    strategies/, backtest_engine, metrics, portfolio_opt, providers/
frontend/   React + TS + Vite terminal
  src/features/    backtest/, signals/, fit/, playbook/
data/       fx_15min.parquet (bundled FX history)
install.sh / install.ps1 / start.sh / start.ps1
```
