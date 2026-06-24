"use strict";

// In-memory ingest job tracker.
//
// The /ingest/trigger endpoint spawns the Python scraper as a child process.
// Job state lives in module-scope memory: fine for a single-process deploy
// (Render free tier, a single container) and matches the simplicity-first goal
// of the assessment. Tradeoffs are discussed in PROJECT.md.

const { spawn } = require("child_process");
const path = require("path");
const crypto = require("crypto");

const SCRAPER_DIR = path.resolve(__dirname, "..", "scraper");
const SCRAPER_CMD = path.join(SCRAPER_DIR, "pipeline.py");

const jobs = new Map(); // jobId -> {status, startedAt, finishedAt, error?}

function createJob() {
  const jobId = crypto.randomUUID();
  jobs.set(jobId, {
    status: "pending",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  });
  return jobId;
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

function _resolvePython() {
  // Prefer an explicit override, then common venv locations, then PATH.
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  const local = path.join(SCRAPER_DIR, ".venv", "Scripts", "python.exe");
  const localNx = path.join(SCRAPER_DIR, ".venv", "bin", "python");
  const fs = require("fs");
  if (fs.existsSync(local)) return local;
  if (fs.existsSync(localNx)) return localNx;
  return process.platform === "win32" ? "python" : "python3";
}

function startJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = "running";
  const py = _resolvePython();

  // Inherit DB_PATH/CLUSTER_THRESHOLD so the child shares the same DB.
  const child = spawn(py, [SCRAPER_CMD], {
    cwd: SCRAPER_DIR,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderrTail = "";
  child.stdout.on("data", () => { /* streamed; summary printed by pipeline */ });
  child.stderr.on("data", (chunk) => {
    stderrTail += chunk.toString();
    if (stderrTail.length > 4000) {
      stderrTail = stderrTail.slice(-4000);
    }
  });

  child.on("error", (err) => {
    job.status = "error";
    job.finishedAt = new Date().toISOString();
    job.error = `spawn failed: ${err.message}`;
  });

  child.on("close", (code) => {
    job.finishedAt = new Date().toISOString();
    if (code === 0) {
      job.status = "done";
    } else {
      job.status = "error";
      const tail = stderrTail.trim().split("\n").slice(-6).join(" | ");
      job.error = `pipeline exited with code ${code}` + (tail ? `: ${tail}` : "");
    }
  });
}

module.exports = { createJob, getJob, startJob };
