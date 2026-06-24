"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../app/api";

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Right-hand detail panel for a single cluster. Loads its articles on demand
// when a cluster is selected. `activeSources` is the set the user has checked
// in the source filter — applied client-side here too.
export default function ClusterPanel({ clusterId, activeSources }) {
  const [cluster, setCluster] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!clusterId) {
      setCluster(null);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    apiGet(`/clusters/${clusterId}`)
      .then((data) => {
        if (!cancelled) setCluster(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clusterId]);

  if (!clusterId) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center rounded-xl border border-white/10 bg-pulse-panel/40 p-6 text-center text-gray-400">
        Select a cluster from the timeline to see its articles.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center rounded-xl border border-white/10 bg-pulse-panel/60 text-gray-300">
        Loading cluster…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
        Could not load cluster: {error}
      </div>
    );
  }

  const articles = (cluster?.articles || []).filter(
    (a) => activeSources.size === 0 || activeSources.has(a.source),
  );

  return (
    <div className="flex h-full min-h-[400px] flex-col rounded-xl border border-white/10 bg-pulse-panel/60">
      <div className="border-b border-white/10 p-4">
        <div className="text-xs uppercase tracking-wide text-pulse-accent">
          Cluster #{cluster?.id}
        </div>
        <h2 className="mt-1 text-lg font-semibold capitalize text-white">
          {cluster?.label}
        </h2>
        <div className="mt-1 text-xs text-gray-400">
          {cluster?.articles?.length || 0} articles total · {articles.length}{" "}
          shown
        </div>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto p-3">
        {articles.length === 0 ? (
          <div className="p-4 text-sm text-gray-400">
            No articles match the current source filter.
          </div>
        ) : (
          <ul className="space-y-2">
            {articles.map((a) => (
              <li key={a.id}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg border border-white/5 bg-white/[0.03] p-3 transition hover:border-pulse-accent/40 hover:bg-white/[0.06]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-pulse-accent2/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pulse-accent2">
                      {a.source}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      {formatTime(a.published_at)}
                    </span>
                  </div>
                  <div className="mt-1.5 text-sm font-medium text-gray-100">
                    {a.title}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
