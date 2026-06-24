"use strict";

// Database access for the News Pulse backend (Postgres / node-postgres).
//
// Opens a single shared connection Pool pointed at the hosted Postgres that the
// Python scraper also writes to, via the shared DATABASE_URL env var (Neon
// pooled connection string). A Pool (default 10 connections) is the right
// primitive for a request-handling server: requests borrow/return connections,
// and using Neon's `-pooler` endpoint (PgBouncer) means we won't exhaust
// Postgres' direct-connection cap.

const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SCHEMA_PATH = path.join(PROJECT_ROOT, "db", "schema.sql");

function resolveDatabaseUrl() {
  const raw = (process.env.DATABASE_URL || "").trim();
  if (!raw) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env at the project root " +
        "and paste your Neon (or other Postgres) connection string."
    );
  }
  // Heroku/Render ship `postgres://` which node-postgres rejects.
  return raw.startsWith("postgres://")
    ? "postgresql://" + raw.slice("postgres://".length)
    : raw;
}

// Neon requires TLS. We also honor PGSSLMODE=disable for a local non-TLS
// Postgres during development.
function buildSslConfig() {
  const mode = (process.env.PGSSLMODE || "require").toLowerCase();
  if (mode === "disable" || mode === "false" || mode === "0") return false;
  // `require` lets node-postgres connect over TLS without pinning a CA — fine
  // for Neon/Supabase managed certs. Set PGSSLMODE=verify-full if you want to
  // enforce CA validation and have the CA configured.
  return { rejectUnauthorized: mode === "verify-full" };
}

let _pool = null;

function getPool() {
  if (_pool) return _pool;
  _pool = new Pool({
    connectionString: resolveDatabaseUrl(),
    ssl: buildSslConfig(),
    // Keep the pool modest; Neon's free pooled endpoint caps concurrent conns.
    max: Number(process.env.PG_POOL_MAX) || 10,
    idleTimeoutMillis: 30000,
  });
  // Surface pool errors (e.g. backend idle disconnects) in the log rather than
  // silently dropping the connection.
  _pool.on("error", (err) => {
    console.error("pg pool error:", err.message);
  });
  return _pool;
}

// Thin query helper so handlers stay terse: `const { rows } = await query(sql, [..])`.
async function query(text, params) {
  return getPool().query(text, params);
}

let _schemaApplied = false;

// Apply db/schema.sql once. Idempotent on the DB side (CREATE ... IF NOT
// EXISTS); the local flag just avoids re-reading the file every request.
async function ensureSchema() {
  if (_schemaApplied) return;
  const sql = fs.readFileSync(SCHEMA_PATH, "utf-8");
  await query(sql);
  _schemaApplied = true;
}

async function close() {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _schemaApplied = false;
  }
}

module.exports = { getPool, query, ensureSchema, close, resolveDatabaseUrl };
