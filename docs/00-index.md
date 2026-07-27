# PARABOLA Agent Reference Index

This folder is the canonical handoff reference for coding agents building **PARABOLA**, a professional full-stack quantitative trading backtest, optimization, and paper-trading terminal.

The original MVP is a single-file browser prototype named `parabola.html`. It demonstrates the intended product feel: dark terminal-style UI, parameter sliders, strategy model selection, synthetic data generation, inline SVG charts, linked crosshairs, metric cards, trade logs, a portfolio mode, and a 2D Sharpe heatmap. The production version must preserve the clean UX while moving compute, persistence, real data ingestion, and long-running sweeps into backend services.

## Documents

Read in this order:

1. [`01-product-brief.md`](01-product-brief.md) — product goal, user intent, v1/v2 scope.
2. [`02-prototype-audit.md`](02-prototype-audit.md) — what the current `parabola.html` already does and what must change.
3. [`03-system-architecture.md`](03-system-architecture.md) — target full-stack architecture and service boundaries.
4. [`04-data-flow.md`](04-data-flow.md) — end-to-end workflows from UI run request to rendered result.
5. [`05-database-schema.md`](05-database-schema.md) — PostgreSQL/TimescaleDB schema.
6. [`06-api-and-worker-contracts.md`](06-api-and-worker-contracts.md) — FastAPI endpoints, request/response shapes, Celery task contracts.
7. [`07-strategy-engine.md`](07-strategy-engine.md) — strategy engine abstractions, execution assumptions, metrics, anti-lookahead rules.
8. [`08-frontend-architecture.md`](08-frontend-architecture.md) — React state, charting, workers, performance rules.
9. [`09-parameter-sweeps.md`](09-parameter-sweeps.md) — scalable optimization design.
10. [`10-implementation-roadmap.md`](10-implementation-roadmap.md) — incremental build phases and acceptance criteria.
11. [`11-agent-build-instructions.md`](11-agent-build-instructions.md) — explicit instructions for Codex/other coding agents.

## Non-negotiable design principles

- The browser must not run heavy backtests or parameter sweeps.
- Backend workers own real computation.
- PostgreSQL/TimescaleDB is the system of record.
- Redis/Celery are orchestration infrastructure, not long-term storage.
- The frontend is a responsive trading terminal, not a computational engine.
- Backtests must be reproducible.
- Execution timing must be explicit to avoid lookahead bias.
- Parameter sweeps must have guardrails to avoid accidental combinatorial explosions.
- Paper trading must be implemented only after historical backtesting and data ingestion are stable.

## Suggested repo placement

```text
repo-root/
  docs/
    agent-reference/
      00-index.md
      01-product-brief.md
      ...
  frontend/
  backend/
  docker-compose.yml
  README.md
```
