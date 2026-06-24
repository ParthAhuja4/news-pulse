-- News Pulse schema (Postgres).
--
-- Single source of truth for the database layout. Both the Python scraper
-- (scraper/db.py) and the Node backend (backend/db.js) run this at boot —
-- CREATE ... IF NOT EXISTS makes it safe to apply repeatedly.
--
-- Type notes vs the old SQLite schema:
--   INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL PRIMARY KEY
--   TEXT is preserved (Postgres TEXT has no length limit, same semantics).

CREATE TABLE IF NOT EXISTS articles (
    id           SERIAL PRIMARY KEY,
    title        TEXT NOT NULL,
    summary      TEXT,
    body         TEXT,
    url          TEXT NOT NULL UNIQUE,
    source       TEXT NOT NULL,
    published_at TEXT,
    fetched_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clusters (
    id         SERIAL PRIMARY KEY,
    label      TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cluster_articles (
    cluster_id INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    PRIMARY KEY (cluster_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_articles_published     ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_articles_source         ON articles(source);
CREATE INDEX IF NOT EXISTS idx_cluster_articles_article ON cluster_articles(article_id);
