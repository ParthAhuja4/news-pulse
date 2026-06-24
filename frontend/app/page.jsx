"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "./api";
import Timeline from "../components/Timeline";
import ClusterPanel from "../components/ClusterPanel";

export default function Page() {
  const [timeline, setTimeline] = useState([]);
  const [sources, setSources] = useState([]); // [{name, checked}]
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [jobStatus, setJobStatus] = useState("");
  const [error, setError] = useState("");
  const pollTimer = useRef(null);

  const loadTimeline = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [tl, srcs] = await Promise.all([
        apiGet("/timeline"),
        apiGet("/sources").catch(() => []),
      ]);
      setTimeline(tl);
      setSources((prev) => {
        // Preserve existing checked state where possible; default new ones on.
        return srcs.map((name) => {
          const found = prev.find((s) => s.name === name);
          return found ? found : { name, checked: true };
        });
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  // ---- Source filter -------------------------------------------------------
  const activeSources = new Set(
    sources.filter((s) => s.checked).map((s) => s.name)
  );

  function toggleSource(name) {
    setSources((prev) =>
      prev.map((s) => (s.name === name ? { ...s, checked: !s.checked } : s))
    );
  }

  // ---- Refresh: trigger ingest + poll ------------------------------------
  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  async function refresh() {
    setRefreshing(true);
    setJobStatus("triggering scraper…");
    setError("");
    try {
      const { jobId } = await apiPost("/ingest/trigger");
      setJobStatus("scraper running…");
      stopPolling();
      pollTimer.current = setInterval(async () => {
        try {
          const st = await apiGet(`/ingest/status/${jobId}`);
          if (st.status === "done") {
            stopPolling();
            setJobStatus("done ✓");
            setRefreshing(false);
            await loadTimeline();
            setTimeout(() => setJobStatus(""), 2500);
          } else if (st.status === "error") {
            stopPolling();
            setJobStatus("");
            setRefreshing(false);
            setError(st.error || "scraper failed");
          } else {
            setJobStatus(`scraper ${st.status}…`);
          }
        } catch (e) {
          stopPolling();
          setJobStatus("");
          setRefreshing(false);
          setError(e.message);
        }
      }, 2000);
    } catch (e) {
      setRefreshing(false);
      setJobStatus("");
      setError(e.message);
    }
  }

  useEffect(() => () => stopPolling(), []);

  const totalArticles = timeline.reduce((sum, c) => sum + (c.count || 0), 0);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            News{" "}
            <span className="bg-gradient-to-r from-pulse-accent to-pulse-accent2 bg-clip-text text-transparent">
              Pulse
            </span>
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            Topic clusters across the active sources, refreshed on demand.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {jobStatus && (
            <span className="text-xs text-gray-400">{jobStatus}</span>
          )}
          <button
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg bg-pulse-accent px-4 py-2 text-sm font-semibold text-[#0b1020] transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshing && (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#0b1020]/40 border-t-[#0b1020]" />
            )}
            {refreshing ? "Working…" : "Refresh data"}
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-gray-400">
        <span className="uppercase tracking-wide">Sources:</span>
        {sources.length === 0 && <span className="text-gray-500">(none yet)</span>}
        {sources.map((s) => (
          <label
            key={s.name}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/10 bg-pulse-panel/60 px-3 py-1"
          >
            <input
              type="checkbox"
              checked={s.checked}
              onChange={() => toggleSource(s.name)}
              className="accent-pulse-accent"
            />
            <span>{s.name}</span>
          </label>
        ))}
      </div>

      <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
        <span>
          {loading
            ? "Loading…"
            : `${timeline.length} clusters · ${totalArticles} articles`}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Timeline
            data={timeline}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
        <div className="lg:col-span-1">
          <ClusterPanel clusterId={selectedId} activeSources={activeSources} />
        </div>
      </div>

      <footer className="mt-10 border-t border-white/10 pt-4 text-center text-xs text-gray-600">
        News Pulse — keyword-overlap union-find clustering (threshold = 3 shared
        significant words).
      </footer>
    </main>
  );
}
