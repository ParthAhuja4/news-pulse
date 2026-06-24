"""News Pulse scraper entry point.

Run:
    python pipeline.py

Does ingest (RSS -> extract body -> write articles) then clustering (rebuild all
clusters). Prints a one-line summary and exits 0 on success, 1 on any unexpected
error. Per-feed / per-page failures are caught and counted, never fatal.
"""

from __future__ import annotations

from envload import load
import logging
import sys
import time
from datetime import datetime, timezone

load()
import db
import clustering
from feeds import extract_body, parse_feeds

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("news_pulse.pipeline")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def run() -> int:
    started = time.time()
    log.info("News Pulse pipeline starting")

    conn = db.connect()
    db.init_schema(conn)

    # ---- Ingest ---------------------------------------------------------
    candidates = parse_feeds()
    log.info("parsed %d feed items across all sources", len(candidates))

    new_count = 0
    dup_count = 0
    body_fail = 0

    for art in candidates:
        if db.url_exists(conn, art["url"]):
            dup_count += 1
            continue
        body = extract_body(art["url"])
        if not body:
            body_fail += 1
            # Still insert — we have title + summary for clustering, and the
            # backend can render the article even without a long body.
        row = {
            "title": art["title"],
            "summary": art["summary"],
            "body": body,
            "url": art["url"],
            "source": art["source"],
            "published_at": art["published_at"],
            "fetched_at": _now_iso(),
        }
        if db.insert_article(conn, row) is not None:
            new_count += 1

    log.info(
        "ingest: %d new, %d duplicate/skipped, %d with empty body",
        new_count,
        dup_count,
        body_fail,
    )

    # ---- Cluster (full rebuild) ----------------------------------------
    articles = [dict(row) for row in db.fetch_all_articles(conn)]
    # Let cluster_articles pick the right linking scale itself: IDF cumulative
    # weight (LINK_WEIGHT) for corpora >= MIN_CORPUS, raw shared-token count
    # (get_threshold()) as the small-corpus fallback otherwise. Passing
    # get_threshold() in as link_weight here would feed the small-corpus
    # threshold into the IDF path, which is a different scale entirely.
    clusters = clustering.cluster_articles(articles)
    cluster_count = db.replace_clusters(conn, clusters)
    log.info(
        "clustered %d articles into %d clusters (corpus_size=%d, mode=%s)",
        len(articles),
        cluster_count,
        len(articles),
        "idf" if len(articles) >= clustering.MIN_CORPUS else "raw-count",
    )

    elapsed = time.time() - started
    print(
        f"\n=== News Pulse run complete in {elapsed:.1f}s ===\n"
        f"  feed items parsed : {len(candidates)}\n"
        f"  new articles      : {new_count}\n"
        f"  duplicates skipped: {dup_count}\n"
        f"  empty body (kept) : {body_fail}\n"
        f"  total in db       : {len(articles)}\n"
        f"  clusters          : {cluster_count}",
        flush=True,
    )
    return 0


def main() -> int:
    try:
        return run()
    except KeyboardInterrupt:
        log.warning("interrupted by user")
        return 1
    except Exception as e:
        log.exception("pipeline failed: %s", e)
        return 1


if __name__ == "__main__":
    sys.exit(main())
