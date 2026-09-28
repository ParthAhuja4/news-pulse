"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "./api";
import AppHeader from "../components/AppHeader";
import ClusterBars from "../components/ClusterBars";
import ClusterPanel from "../components/ClusterPanel";
import ClusterSheet from "../components/ClusterSheet";
import ErrorNotice from "../components/ErrorNotice";
import StatTiles from "../components/StatTiles";
import useCluster from "../lib/useCluster";
import useMediaQuery from "../lib/useMediaQuery";
import { formatRelative } from "../lib/format";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export default function Page() {
  const [timeline, setTimeline] = useState([]);
  const [sources, setSources] = useState([]); // [{name, checked}]
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [jobStatus, setJobStatus] = useState("");
  const [error, setError] = useState("");
  const pollTimer = useRef(null);
  const statusTimer = useRef(null);

  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const clusterState = useCluster(selectedId);

  const loadTimeline = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [tl, srcs] = await Promise.all([
        apiGet("/timeline"),
        apiGet("/sources").catch(() => []),
      ]);
      setTimeline(tl);
      // Cluster ids are reissued on every ingest run, so a selection from
      // before the reload may point at nothing, or at a different topic.
      setSelectedId((id) => (tl.some((c) => c.id === id) ? id : null));
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
  function toggleSource(name) {
    setSources((prev) => {
      // From "All", picking a source narrows to just that source.
      if (prev.every((s) => s.checked)) {
        return prev.map((s) => ({ ...s, checked: s.name === name }));
      }
      const next = prev.map((s) =>
        s.name === name ? { ...s, checked: !s.checked } : s
      );
      // Clearing the last source goes back to "All" rather than to nothing.
      return next.some((s) => s.checked)
        ? next
        : prev.map((s) => ({ ...s, checked: true }));
    });
  }

  function selectAllSources() {
    setSources((prev) => prev.map((s) => ({ ...s, checked: true })));
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
    setJobStatus("Starting…");
    setError("");
    clearTimeout(statusTimer.current);
    try {
      const { jobId } = await apiPost("/ingest/trigger");
      // The ingest rebuilds every cluster, so the old selection is void.
      setSelectedId(null);
      setJobStatus("Collecting articles…");
      stopPolling();
      const startedAt = Date.now();
      pollTimer.current = setInterval(async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          stopPolling();
          setJobStatus("");
          setRefreshing(false);
          setError(
            "The refresh is taking longer than expected. It may still finish; reload the page in a few minutes."
          );
          return;
        }
        try {
          const st = await apiGet(`/ingest/status/${jobId}`);
          if (st.status === "done") {
            stopPolling();
            setJobStatus("Updated");
            setRefreshing(false);
            await loadTimeline();
            statusTimer.current = setTimeout(() => setJobStatus(""), 2500);
          } else if (st.status === "error") {
            stopPolling();
            setJobStatus("");
            setRefreshing(false);
            setError(st.error || "scraper failed");
          }
        } catch (e) {
          stopPolling();
          setJobStatus("");
          setRefreshing(false);
          setError(e.message);
        }
      }, POLL_INTERVAL_MS);
    } catch (e) {
      setRefreshing(false);
      setJobStatus("");
      setError(e.message);
    }
  }

  useEffect(
    () => () => {
      stopPolling();
      clearTimeout(statusTimer.current);
    },
    []
  );

  const totalArticles = timeline.reduce((sum, c) => sum + (c.count || 0), 0);
  const latest = timeline.reduce(
    (max, c) => (c.end && (!max || c.end > max) ? c.end : max),
    null
  );
  // After a failed load there is nothing to count; "0" would read as a fact.
  const unknown = Boolean(error) && timeline.length === 0;
  const stats = [
    { label: "Topics", value: unknown ? "—" : timeline.length },
    { label: "Articles", value: unknown ? "—" : totalArticles },
    { label: "Sources", value: unknown ? "—" : sources.length },
    { label: "Latest article", value: formatRelative(latest) || "—" },
  ];

  const panel = (onClose) => (
    <ClusterPanel
      clusterId={selectedId}
      cluster={clusterState.cluster}
      loading={clusterState.loading}
      error={clusterState.error}
      onRetry={clusterState.retry}
      sources={sources}
      onToggleSource={toggleSource}
      onSelectAllSources={selectAllSources}
      onClose={onClose}
    />
  );

  return (
    <>
      <a
        href="#topics-heading"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-accent"
      >
        Skip to topics
      </a>

      <AppHeader
        refreshing={refreshing}
        jobStatus={jobStatus}
        onRefresh={refresh}
      />

      <main className="mx-auto max-w-screen-2xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        {error && (
          <ErrorNotice
            message={error}
            onRetry={refreshing ? undefined : loadTimeline}
            onDismiss={() => setError("")}
            className="mb-4"
          />
        )}

        <StatTiles stats={stats} loading={loading && timeline.length === 0} />

        <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]">
          <ClusterBars
            data={timeline}
            loading={loading}
            failed={Boolean(error)}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRefresh={refresh}
            onRetry={loadTimeline}
            refreshing={refreshing}
          />

          <aside
            aria-label="Articles in the selected topic"
            className="sticky top-24 hidden max-h-[calc(100dvh-7.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-surface/70 lg:flex"
          >
            {isDesktop && panel()}
          </aside>
        </div>
      </main>

      <footer className="mx-auto max-w-screen-2xl px-4 pb-8 sm:px-6 lg:px-8">
        <p className="border-t border-border pt-4 text-center text-xs text-text-subtle">
          News Pulse groups articles that share significant keywords into
          topics.
        </p>
      </footer>

      {!isDesktop && (
        <ClusterSheet
          open={selectedId !== null}
          onClose={() => setSelectedId(null)}
        >
          {panel(() => setSelectedId(null))}
        </ClusterSheet>
      )}
    </>
  );
}
