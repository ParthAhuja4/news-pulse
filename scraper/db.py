"""Database access for the News Pulse scraper (Postgres / psycopg2).

Connects to the same hosted Postgres instance the Node backend reads, via the
shared ``DATABASE_URL`` env var (Neon pooled connection string). psycopg2 is
synchronous, which fits the scraper's straight-line ingest→cluster flow.

The public function names (``connect``, ``init_schema``, ``insert_article``,
``url_exists``, ``fetch_all_articles``, ``replace_clusters``) are unchanged from
the old SQLite version, so ``pipeline.py`` and ``clustering.py`` need no edits.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable, Optional

import psycopg2
from psycopg2.extras import RealDictCursor


def _project_root() -> Path:
    # scraper/db.py -> scraper/ -> project root
    return Path(__file__).resolve().parents[1]


def _schema_path() -> Path:
    return _project_root() / "db" / "schema.sql"


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Copy .env.example to .env at the project "
            "root and paste your Neon (or other Postgres) connection string."
        )
    # Heroku/Render ship postgres:// URLs that psycopg2 rejects; normalize.
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    return url


def connect() -> "psycopg2.extensions.connection":
    """Open a Postgres connection.

    TLS is controlled by the ``sslmode`` query param on ``DATABASE_URL`` itself
    (Neon's pooled string ships ``?sslmode=require``, which is mandatory on
    Neon/Supabase). For a local non-TLS Postgres, append ``?sslmode=disable`` to
    your ``DATABASE_URL`` — unlike the Node backend, psycopg2 here does not read
    a separate ``PGSSLMODE`` env var.
    """
    conn = psycopg2.connect(_database_url(), cursor_factory=RealDictCursor)
    # Explicit transaction control: ingest inserts are small and the one big
    # write (replace_clusters) manages its own commit.
    conn.autocommit = False
    return conn


def init_schema(conn) -> None:
    """Apply db/schema.sql. Idempotent (CREATE ... IF NOT EXISTS)."""
    sql = _schema_path().read_text(encoding="utf-8")
    # schema.sql contains multiple statements separated by ';'. psycopg2's
    # execute() only accepts one statement, so split safely on the terminator.
    statements = [s.strip() for s in sql.split(";") if s.strip()]
    try:
        with conn.cursor() as cur:
            for stmt in statements:
                cur.execute(stmt)
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def url_exists(conn, url: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM articles WHERE url = %s LIMIT 1", (url,))
        return cur.fetchone() is not None


def insert_article(conn, art: dict) -> Optional[int]:
    """Insert one article. Returns the new id, or None if the URL was a dup.

    Uses ``ON CONFLICT (url) DO NOTHING RETURNING id``: if the unique URL
    already exists, no row is returned and we treat it as a skip. (Executed in
    the caller's transaction; the pipeline commits periodically.)
    """
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO articles
                    (title, summary, body, url, source, published_at, fetched_at)
                VALUES (%(title)s, %(summary)s, %(body)s, %(url)s,
                        %(source)s, %(published_at)s, %(fetched_at)s)
                ON CONFLICT (url) DO NOTHING
                RETURNING id
                """,
                art,
            )
            row = cur.fetchone()
            return row["id"] if row else None
    except psycopg2.Error:
        # Roll back just this statement so the connection stays usable for the
        # next article; the pipeline counts it as a skip.
        conn.rollback()
        return None


def fetch_all_articles(conn) -> list[dict]:
    """All articles for clustering, oldest-first. Returns plain dicts."""
    with conn.cursor() as cur:
        cur.execute("SELECT id, title, summary, published_at FROM articles ORDER BY id")
        return cur.fetchall()


def replace_clusters(conn, clusters: Iterable[dict]) -> int:
    """Wipe + rebuild all clusters in one transaction. Returns cluster count.

    Each cluster dict: {"label": str, "article_ids": [int, ...]}.
    Singletons (one article) are still written so the timeline can show them.

    Postgres equivalent of the old SQLite ``DELETE FROM sqlite_sequence`` reset
    is ``TRUNCATE ... RESTART IDENTITY CASCADE``, which also wipes
    ``cluster_articles`` via the FK ON DELETE CASCADE and restarts the SERIAL.
    """
    from datetime import datetime, timezone

    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    inserted = 0
    try:
        with conn.cursor() as cur:
            # Wipe both tables and reset the clusters SERIAL counter.
            cur.execute(
                "TRUNCATE TABLE clusters, cluster_articles " "RESTART IDENTITY CASCADE"
            )
            for cl in clusters:
                if not cl.get("article_ids"):
                    continue
                cur.execute(
                    "INSERT INTO clusters (label, created_at) VALUES (%s, %s) "
                    "RETURNING id",
                    (cl["label"], now_iso),
                )
                cid = cur.fetchone()["id"]
                inserted += 1
                # ON CONFLICT DO NOTHING guards against a cluster listing the
                # same article twice (defensive; shouldn't happen).
                cur.executemany(
                    "INSERT INTO cluster_articles (cluster_id, article_id) "
                    "VALUES (%s, %s) ON CONFLICT DO NOTHING",
                    [(cid, aid) for aid in cl["article_ids"]],
                )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return inserted
