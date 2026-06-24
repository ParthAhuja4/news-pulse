"""Tiny .env loader with zero third-party dependencies.

Loads the SHARED root .env (../.env relative to this file) into os.environ if it
exists, WITHOUT clobbering values already present in the real environment (so
deploy-platform env vars always win). This mirrors what `dotenv` does in the
backend and guarantees scraper + backend read the same DB_PATH.
"""

from __future__ import annotations

import os
from pathlib import Path


def load() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        # Don't override already-set env vars (real env takes precedence).
        os.environ.setdefault(key, value)
