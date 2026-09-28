"use client";

import { useMemo, useState } from "react";
import { Inbox, RefreshCw } from "lucide-react";
import Skeleton from "./Skeleton";
import { formatDateTime, formatDayRange } from "../lib/format";

// Topic list: one row per cluster, with a bar whose length is the cluster's
// share of the largest cluster. Rows are buttons, so they work by touch and
// keyboard; selecting one opens its articles.

const INITIAL_ROWS = 15;

const SORTS = [
  { key: "size", label: "Largest" },
  { key: "recent", label: "Most recent" },
];

function time(iso) {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
}

export default function ClusterBars({
  data,
  loading,
  failed,
  selectedId,
  onSelect,
  onRefresh,
  onRetry,
  refreshing,
}) {
  const [sort, setSort] = useState("size");
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    const sorted = [...(data || [])];
    if (sort === "recent") {
      sorted.sort((a, b) => time(b.end) - time(a.end) || b.count - a.count);
    } else {
      sorted.sort((a, b) => b.count - a.count || time(b.end) - time(a.end));
    }
    return sorted;
  }, [data, sort]);

  const max = rows.reduce((m, c) => Math.max(m, c.count || 0), 0);
  const visible = showAll ? rows : rows.slice(0, INITIAL_ROWS);
  const hasData = rows.length > 0;

  return (
    <section
      aria-labelledby="topics-heading"
      className="rounded-2xl border border-border bg-surface/70"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div>
          <h2
            id="topics-heading"
            tabIndex={-1}
            className="font-display text-xl font-semibold text-text"
          >
            Topics
          </h2>
          <p className="text-xs text-text-subtle">
            Bar length shows how many articles cover the topic.
          </p>
        </div>
        {hasData && (
          <div
            role="group"
            aria-label="Sort topics"
            className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5"
          >
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={sort === s.key}
                onClick={() => setSort(s.key)}
                className={`h-9 rounded-md px-3 text-sm font-medium transition-colors ${
                  sort === s.key
                    ? "bg-surface text-text shadow-sm"
                    : "text-text-muted hover:text-text"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="p-2 sm:p-3">
        {loading && !hasData ? (
          <div role="status" aria-label="Loading topics" className="space-y-1">
            {[72, 58, 46, 40, 31, 24].map((w) => (
              <div key={w} className="px-3 py-3">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="mt-2.5 h-2" />
                <Skeleton className="mt-2 h-3 w-24" />
              </div>
            ))}
          </div>
        ) : !hasData && failed ? (
          <div className="flex flex-col items-center px-4 py-12 text-center">
            <p className="text-sm text-text-muted">
              Topics couldn't be loaded.
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex h-11 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium text-text transition-colors hover:bg-surface-2"
            >
              Try again
            </button>
          </div>
        ) : !hasData ? (
          <div className="flex flex-col items-center px-4 py-12 text-center">
            <Inbox aria-hidden="true" className="h-10 w-10 text-text-subtle" />
            <p className="mt-3 font-medium text-text">No topics yet</p>
            <p className="mt-1 max-w-sm text-sm text-text-muted">
              Refresh to collect the latest articles and group them into topics.
            </p>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="mt-4 inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <RefreshCw
                aria-hidden="true"
                className={`h-4 w-4 ${refreshing ? "motion-safe:animate-spin" : ""}`}
              />
              {refreshing ? "Working…" : "Refresh data"}
            </button>
          </div>
        ) : (
          <>
            <ol className="space-y-1">
              {visible.map((c, i) => {
                const selected = c.id === selectedId;
                const pct = max > 0 ? Math.max(2, (c.count / max) * 100) : 0;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSelect(c.id)}
                      className={`flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
                        selected
                          ? "border-accent bg-accent/10"
                          : "border-transparent hover:bg-surface-2"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="w-6 shrink-0 pt-0.5 text-right text-xs tabular-nums text-text-subtle"
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="line-clamp-2 break-words text-sm font-medium capitalize text-text sm:text-base">
                            {c.label}
                          </span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-text">
                            {c.count}
                            <span className="sr-only">
                              {c.count === 1 ? " article" : " articles"}
                            </span>
                          </span>
                        </span>
                        <span
                          aria-hidden="true"
                          className="mt-2 block h-2 overflow-hidden rounded-full bg-surface-2"
                        >
                          <span
                            className={`block h-full rounded-full ${
                              selected ? "bg-accent" : "bg-accent/70"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span
                          className="mt-1.5 block text-xs text-text-subtle"
                          title={`${formatDateTime(c.start, "—")} → ${formatDateTime(c.end, "—")}`}
                        >
                          {formatDayRange(c.start, c.end) || "No date"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {rows.length > INITIAL_ROWS && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                aria-expanded={showAll}
                className="mt-2 h-11 w-full rounded-lg text-sm font-medium text-accent transition-colors hover:bg-surface-2"
              >
                {showAll ? "Show fewer" : `Show all ${rows.length} topics`}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
