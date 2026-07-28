# BACKTEST — single-container deploy: builds the frontend, then serves it and
# the API from one FastAPI process (one origin, no CORS). SQLite + in-process
# tasks, so no Postgres/Redis needed.

# --- stage 1: build the React frontend ---
FROM node:20-alpine AS frontend
WORKDIR /fe
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# empty base URL => the app calls the API on the same origin (relative /api)
ENV VITE_API_BASE_URL=""
RUN npm run build

# --- stage 2: backend runtime that also serves the built frontend ---
FROM python:3.13-slim AS app
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
# built SPA (served at "/" by app.main when FRONTEND_DIST is set)
COPY --from=frontend /fe/dist ./frontend_dist
# optional: your FX data. Put fx_15min.parquet in ./data/ before building to
# bake it in, or mount it at runtime and point FX_PARQUET_PATH at it.
COPY data/ ./data/

ENV DATABASE_URL="sqlite:///./backtest.sqlite3" \
    CELERY_TASK_ALWAYS_EAGER=1 \
    DEFAULT_DATA_PROVIDER=parquet \
    FX_PARQUET_PATH=/app/data/fx_15min.parquet \
    FRONTEND_DIST=/app/frontend_dist \
    PORT=8000
# Uses the real FX parquet baked into ./data/. To fall back to fake data set
# DEFAULT_DATA_PROVIDER=synthetic; for delayed live daily FX set it to yfinance.
# Password gate: set BASIC_AUTH_USER and BASIC_AUTH_PASS.

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
