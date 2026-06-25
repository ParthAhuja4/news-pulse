# PROJECT.md — News Pulse engineering notes

---

## 1. Postgres (Neon) vs SQLite vs Mongo

**Choice:** Hosted Postgres on Neon (free tier), connected via `DATABASE_URL`
using `psycopg2` (Python) and `pg` Pool (Node).

**Why not stick with SQLite.** SQLite worked great locally but needed a persistent
local file on the deploy host. Render's free-tier filesystem is **ephemeral** —
the DB file is wiped on every deploy and the backend/scraper can't share a disk
across services. A persistent Render disk costs $5/mo and is single-service, so
the scraper cron and backend web service would need the same disk attached to the
same process — awkward for the planned architecture. Postgres removes all of
that: both services point at one URL, no disk management, survives redeploys,
and scales horizontally.

**Gained.** Persistent data that survives container restarts and redeploys.
Both the scraper and backend connect via the same `DATABASE_URL` — no file-path
coordination. Managed `pgvector` extension if we ever want embedding-based
clustering. Proper concurrent writers (multiple scraper runs can safely insert).
`ON CONFLICT DO NOTHING` / `RETURNING id` for cleaner upsert logic vs SQLite's
`lastrowid`. Real `TRUNCATE ... RESTART IDENTITY CASCADE` instead of hacking
`sqlite_sequence`. Connection pooling (Neon's PgBouncer) lets many concurrent
backend requests share a small pool of server-side connections.

**Gave up.** Requires a hosted database (Neon free tier, but still external).
Cold-start latency on the first connection (Neon scales-to-zero). The backend is
now async (pg Pool returns Promises), which means all route handlers became
`async` — a small surface-area change but one that touches every endpoint.
Scrapers that run from a laptop need a `PGSSLMODE=disable` override for local
non-TLS Postgres.

**With more time.** Add connection health-checks with exponential backoff so a
transient Neon cold-start doesn't surface as a 500 to the first user request
(currently handled by catching errors at boot and letting /healthz succeed).
Add a `pg_dump` backup cron to an S3 bucket for point-in-time recovery.

---

## 2. IDF-weighted keyword-overlap clustering (DBSCAN, evolved from raw overlap)

**Choice:** IDF-weighted token overlap + **DBSCAN**. For corpora ≥ 30 articles
(`MIN_CORPUS`): compute smoothed IDF per token, hard-prune tokens with df > 8%
(`MAX_DF_FRAC=0.08`, corpus-wide boilerplate), build a pairwise IDF-similarity
graph via an inverted index, convert similarity to distance `d = 1/(1+S)`, and run
DBSCAN (`DBSCAN_EPS=0.05`, `DBSCAN_MIN_SAMPLES=2`). Two articles are neighbours
only when they share ≥ 3 surviving tokens (`MIN_SHARED_TOKENS`) **and** sit within
`eps`; a core point needs ≥ 2 such neighbours. For small corpora (< 30) IDF is
unreliable, so we fall back to raw shared-count ≥ `CLUSTER_THRESHOLD` + union-find.

**Why the evolution.** The initial implementation used raw shared-token count
(`≥ 3 significant words in common`). On a real corpus of ~90 articles from 3
feeds, this collapsed nearly all articles into a single mega-cluster. The root
cause: generic news words (`world`, `country`, `against`, `police`, `years`)
each appear in ~10% of articles and chain together through union-find's
transitivity — two unrelated stories that happen to share 3 of these words
merge, and through intermediate articles the entire corpus chains into one
component.

Adding IDF weighting was step one: it down-weights common tokens. But even with
IDF, the weight distribution on news vocabulary is flat (IDF ≈ 3.0–4.8 across
the board), so cumulative weight still isn't discriminating enough. The real fix
was a hard max-df cutoff at 8% — removing the generic news-vocabulary tail —
combined with requiring **≥ 3 independently shared surviving tokens**
(`MIN_SHARED_TOKENS=3`) to even form a neighbour edge. This defeats the "single
coincidental shared word" failure mode that caused the chaining.

The final step was replacing union-find with **DBSCAN** on the large-corpus path.
Union-find uses single linkage — A~B and B~C merge A/B/C even when A and C share
nothing — so even a few weak bridging articles chain unrelated stories together.
DBSCAN is density-based: a point must have ≥ `DBSCAN_MIN_SAMPLES` neighbours
within `DBSCAN_EPS` to be a core point, and points that don't meet this density
criterion are labelled **noise** and dropped instead of joining a cluster. That
breaks the transitive chains while still grouping genuinely-coherent stories.

**Gained.** Clusters are now genuinely topical (e.g., `toxic / report /
maternity` across BBC + Guardian; `nuclear / inspectors / visit` across BBC +
NPR). Mega-clusters eliminated. Still deterministic, debuggable, zero-ML-deps.
The two-tier system (IDF+DBSCAN for large corpora, raw count + union-find for
small) avoids the cold-start problem where IDF is unreliable with < 30 articles.

**Gave up.** An 8% max-df cutoff still prunes some legitimately useful
moderate-frequency tokens, so a few same-story pairs that share only moderate
words won't link. DBSCAN noise points are dropped entirely from clusters rather
than being kept as singletons-in-context (they reappear only as standalone
clusters of size 1, which `min_cluster_size` filters out anyway). The
small-corpus union-find fallback still has transitive chaining — acceptable
because below `MIN_CORPUS` there usually aren't enough articles to chain
catastrophically.

**With more time.** Two upgrades:

1. **Stable, incremental clustering** with an inverted `token → [article_id]`
   index: on each new article, only compare it against candidates sharing ≥ 1
   token (drops O(n²) to roughly O(k)). Assign new articles to existing clusters
   when they link, only spawn a new cluster otherwise. This also gives stable ids.
2. **Sentence-embedding clustering** (e.g. `sentence-transformers` + HDBSCAN).
   This is the right answer for semantic story grouping but adds ~400MB of model
   weight; overkill for the assessment and a burden on free tiers.

---

## 3. Recompute-every-run vs incremental clustering

**Choice:** Full rebuild each run (`TRUNCATE cluster_articles, clusters RESTART
IDENTITY CASCADE` then re-run clustering over all articles — DBSCAN on the
large-corpus path, union-find on the small-corpus fallback).

**Gained.** The cluster graph is always internally consistent — no leftover
edges from a stale run, no half-merged components. Code is simple. New articles
can shift old clusters in a way incremental merging would have to special-case.

**Gave up.** O(n²) pairwise comparison every run — fine for a few thousand
articles, painful past ~10k. **Cluster ids are not stable over time** (ids are
reissued each rebuild via `RESTART IDENTITY`), so deep-linking `/clusters/42`
is fragile across refreshes.

**With more time.** Incremental clustering with **stable cluster ids**: only
new articles are compared against the existing graph (see §2 "with more time"
for the inverted-index mechanism), so an unchanged cluster keeps its id and
`/clusters/42` deep links survive a refresh. Today the full `RESTART IDENTITY`
rebuild reissues every id every run, which is the tradeoff being accepted here.

---

## 4. URL-uniqueness dedup vs cross-source story merging

**Choice:** Dedup is strictly by `articles.url UNIQUE`. Cross-source merging is
_deliberately not_ a dedup pass — it's handled by clustering.

**Gained.** Two distinct URLs always produce two distinct rows, even when BBC
and the Guardian run the same wire story. The corpus is a faithful record of
what was published. Story-merging happens _one layer up_, in clustering: if the
two articles share enough significant words they land in the same cluster.

**Gave up.** A story can be represented by N near-identical article rows. The
cluster panel lists them all rather than collapsing to "1 story from 2 outlets".

**With more time.** Add a _story_ layer above clusters with a representative
article and a "see also N more from other outlets" affordance. MinHash/SimHash
over bodies could pre-collapse literal reprints before clustering.

---

## 5. Subprocess trigger vs proper job queue for /ingest/trigger

**Choice:** `POST /ingest/trigger` `spawn()`s `python pipeline.py` and tracks
status in module-scope in-memory state.

**Gained.** Zero infrastructure. No Redis, no worker process, no broker. The
whole job lifecycle (pending→running→done/error) is ~60 lines in `jobs.js`.

**Gave up.** **State is in RAM** — restart the backend mid-run and the job
record vanishes. **Single-process only**: scale the backend horizontally and
instance A can't see the job running on instance B. Two rapid `/trigger` calls
launch two scrapers (mitigated by idempotent inserts via `ON CONFLICT DO
NOTHING`, but wasteful).

**With more time.** A real queue: BullMQ on Redis, or a managed option (Inngest,
AWS SQS + Lambda). Persist job state in a `jobs` table. Add a per-run lock so
only one ingest runs at a time.

---

## 6. trafilatura vs newspaper3k vs plain BeautifulSoup

**Choice:** trafilatura first, BeautifulSoup `<p>`-join fallback.

**Gained.** trafilatura is purpose-built for news-article main-text extraction;
it consistently beats alternatives on boilerplate stripping. A failed extraction
never discards the article: we keep it with title + summary for clustering.

**Gave up.** trafilatura pulls lxml (compiled C dep). newspaper3k we skipped:
largely unmaintained, Python 3.12+ compatibility is shaky.

---

## 7. Charting library: recharts

**Choice:** recharts.

**Gained.** Declarative React components, built-in responsive container,
tooltips, click handlers — the whole timeline is ~80 lines.

**Gave up.** recharts is not designed for **true Gantt-style time-span bars**. We
encoded magnitude as bar **height/color** and ordered clusters by start time.

---

## 8. Stretch goals deliberately skipped

- **Embeddings/HDBSCAN clustering** — best quality but ~400MB model + heavier
  runtime; out of scope for a free-tier deploy.
- **Full-text + semantic search** — natural product feature, would add an indexing
  layer and UI. With Postgres we now have `tsvector` FTS available.
- **Incremental/stable-id clustering** — correctness > stability for v1.
- **Auth, rate limiting, multi-tenancy** — single-user tool.
- **Per-article sentiment / entity extraction** — orthogonal; would pull in spaCy.
- **WebSocket push instead of 2s polling** — polling is simpler and good enough.
- **Headless-rendered body extraction (Playwright)** — none of the three feeds
  require it.

---
