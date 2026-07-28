"""Application configuration loaded from environment / .env."""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database. Default to a local SQLite file so the app runs with zero infra;
    # docker-compose overrides this with the Postgres/TimescaleDB URL.
    database_url: str = "sqlite:///./parabola.sqlite3"

    # Celery / Redis
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"
    # When true, tasks execute synchronously in-process (no worker/Redis).
    celery_task_always_eager: bool = False

    # Data providers: "yfinance", "synthetic", or "parquet"
    default_data_provider: str = "synthetic"
    # Path to the wide 15-min FX close panel used by the parquet provider.
    fx_parquet_path: str = ""
    # When true, the parquet provider tops up recent bars from yfinance for any
    # requested range that extends past the parquet's last timestamp (gap-fill).
    fx_live_gapfill: bool = True

    # CORS (comma separated)
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Deploy: serve the built frontend from this dir (single origin) when set,
    # and require HTTP basic auth when a user is configured (password gate).
    frontend_dist: str = ""
    basic_auth_user: str = ""
    basic_auth_pass: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
