"use strict";

// News Pulse backend API (Postgres / node-postgres).
//
// Endpoints
//   GET  /clusters              -> [{id,label,article_count,start,end}]
//   GET  /clusters/:id          -> {id,label,articles:[{id,title,source,published_at,url}]}
//   GET  /timeline              -> [{id,label,start,end,count,intensity}]
//   GET  /sources               -> ["BBC","Guardian",...]
//   POST /ingest/trigger        -> {jobId}
//   GET  /ingest/status/:jobId  -> {status, finishedAt?, error?}
//   GET  /healthz               -> {ok:true}
//
// Errors: 400 bad params, 404 missing cluster/job, 500 unexpected (all in try/catch).

// Load the SHARED root .env first so DATABASE_URL/PORT resolve consistently
// with the scraper. Path is relative to this file: backend/ -> root.
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env") });

const express = require("express");
const cors = require("cors");
const { query, ensureSchema } = require("./db");
const { createJob, getJob, startJob } = require("./jobs");

const app = express();
app.use(cors());
app.use(express.json());

// Tiny request log; helpful when watching the scraper child process run.
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// ---------- helpers ---------------------------------------------------------

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

// ---------- routes ----------------------------------------------------------

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

// GET /sources -> distinct source names present in the corpus. Used to populate
// the frontend's source filter dynamically.
app.get("/sources", async (_req, res) => {
  try {
    const { rows } = await query(
      "SELECT DISTINCT source FROM articles ORDER BY source ASC"
    );
    res.json(rows.map((r) => r.source));
  } catch (err) {
    console.error(err);
    sendError(res, 500, "failed to load sources");
  }
});

// GET /clusters -> list every cluster with size + time span.
app.get("/clusters", async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT c.id                  AS id,
             c.label               AS label,
             COUNT(ca.article_id)  AS article_count,
             MIN(a.published_at)   AS start,
             MAX(a.published_at)   AS end
      FROM clusters c
      LEFT JOIN cluster_articles ca ON ca.cluster_id = c.id
      LEFT JOIN articles a          ON a.id = ca.article_id
      GROUP BY c.id, c.label
      ORDER BY article_count DESC, c.id ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    sendError(res, 500, "failed to load clusters");
  }
});

// GET /clusters/:id -> one cluster + its articles, sorted oldest -> newest.
app.get("/clusters/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return sendError(res, 400, "id must be a positive integer");
    }
    const { rows: clusterRows } = await query(
      "SELECT id, label FROM clusters WHERE id = $1",
      [id]
    );
    const cluster = clusterRows[0];
    if (!cluster) return sendError(res, 404, "cluster not found");

    const { rows: articles } = await query(
      `
      SELECT a.id, a.title, a.source, a.published_at, a.url
      FROM articles a
      JOIN cluster_articles ca ON ca.article_id = a.id
      WHERE ca.cluster_id = $1
      ORDER BY a.published_at ASC, a.id ASC
      `,
      [id]
    );

    res.json({ id: cluster.id, label: cluster.label, articles });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "failed to load cluster");
  }
});

// GET /timeline -> one row per cluster with intensity normalized 0..1.
app.get("/timeline", async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT c.id                  AS id,
             c.label               AS label,
             MIN(a.published_at)   AS start,
             MAX(a.published_at)   AS end,
             COUNT(ca.article_id)  AS count
      FROM clusters c
      LEFT JOIN cluster_articles ca ON ca.cluster_id = c.id
      LEFT JOIN articles a          ON a.id = ca.article_id
      GROUP BY c.id, c.label
      ORDER BY start ASC NULLS LAST, count DESC
    `);

    const max = rows.reduce((m, r) => Math.max(m, Number(r.count)), 0);
    const out = rows.map((r) => ({
      id: r.id,
      label: r.label,
      start: r.start,
      end: r.end,
      count: Number(r.count),
      intensity: max > 0 ? Number(r.count) / max : 0,
    }));
    res.json(out);
  } catch (err) {
    console.error(err);
    sendError(res, 500, "failed to load timeline");
  }
});

// POST /ingest/trigger -> kick off the scraper, return a job id immediately.
app.post("/ingest/trigger", (_req, res) => {
  try {
    const jobId = createJob();
    // Start async; we do not await — the client polls /ingest/status.
    startJob(jobId);
    res.status(202).json({ jobId });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "failed to start ingest");
  }
});

// GET /ingest/status/:jobId -> current job state.
app.get("/ingest/status/:jobId", (req, res) => {
  try {
    const job = getJob(req.params.jobId);
    if (!job) return sendError(res, 404, "job not found");
    const out = { status: job.status };
    if (job.finishedAt) out.finishedAt = job.finishedAt;
    if (job.error) out.error = job.error;
    res.json(out);
  } catch (err) {
    console.error(err);
    sendError(res, 500, "failed to read job status");
  }
});

// 404 for everything else.
app.use((req, res) => sendError(res, 404, "not found"));

// ---------- boot ------------------------------------------------------------

const PORT = Number(process.env.PORT) || 4000;

async function boot() {
  // Warm the pool + ensure the schema exists before serving traffic. Neon
  // cold-starts can take ~1s on the first connection; doing it here means the
  // first user request doesn't pay that latency (or surface a connect error).
  try {
    await ensureSchema();
    // Confirm connectivity with a trivial round-trip.
    const { rows } = await query("SELECT 1 AS ok");
    let host = "unknown";
    try {
      host = new URL(
        (process.env.DATABASE_URL || "").replace(/^postgres:\/\//, "postgresql://")
      ).host;
    } catch {
      /* ignore parse error in log line */
    }
    console.log(`DB ready (host=${host}, check=${rows[0].ok})`);
  } catch (err) {
    console.error("DB init failed:", err.message);
    // Don't crash — let /healthz keep returning and surface the real error on
    // the data endpoints so a misconfigured DATABASE_URL is debuggable.
  }

  app.listen(PORT, () => {
    console.log(`News Pulse backend listening on :${PORT}`);
  });
}

boot();

module.exports = { app };
