import { ExternalLink, FilterX, MousePointerClick, X } from "lucide-react";
import ErrorNotice from "./ErrorNotice";
import Skeleton from "./Skeleton";
import SourceFilter from "./SourceFilter";
import { formatDateTime, formatRelative } from "../lib/format";

// Detail view for a single cluster: header, source filter and article list.
// Rendered inside the sticky desktop panel and inside the mobile sheet; the
// data comes from useCluster in the page, so both share one request.
export default function ClusterPanel({
  clusterId,
  cluster,
  loading,
  error,
  onRetry,
  sources,
  onToggleSource,
  onSelectAllSources,
  onClose,
}) {
  if (!clusterId) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center p-6 text-center">
        <MousePointerClick
          aria-hidden="true"
          className="h-10 w-10 text-text-subtle"
        />
        <p className="mt-3 font-medium text-text">Pick a topic</p>
        <p className="mt-1 max-w-xs text-sm text-text-muted">
          Select a topic from the list to read the articles covering it.
        </p>
      </div>
    );
  }

  // Keep the previous cluster hidden while the next one loads.
  const current = cluster && cluster.id === clusterId ? cluster : null;
  const all = current?.articles || [];
  const active = new Set(
    (sources || []).filter((s) => s.checked).map((s) => s.name),
  );
  const filtering = (sources || []).length > 0;
  const articles = filtering ? all.filter((a) => active.has(a.source)) : all;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 pb-3 pt-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">
            Topic
          </p>
          {current ? (
            <>
              <h2 className="mt-1 break-words font-display text-xl font-semibold capitalize leading-snug text-text">
                {current.label}
              </h2>
              <p className="mt-1 text-xs text-text-muted">
                {articles.length === all.length
                  ? `${all.length} ${all.length === 1 ? "article" : "articles"}`
                  : `${articles.length} of ${all.length} articles shown`}
              </p>
            </>
          ) : (
            !error && (
              <>
                <Skeleton className="mt-2 h-6 w-48" />
                <Skeleton className="mt-2 h-3 w-24" />
              </>
            )
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close articles"
            className="-mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        )}
      </div>

      {current && (
        <div className="border-b border-border">
          <SourceFilter
            sources={sources}
            onToggle={onToggleSource}
            onSelectAll={onSelectAllSources}
          />
        </div>
      )}

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {error ? (
          <ErrorNotice message={error} onRetry={onRetry} />
        ) : loading || !current ? (
          <div role="status" aria-label="Loading articles" className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg border border-border p-3">
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-12" />
                </div>
                <Skeleton className="mt-3 h-4" />
                <Skeleton className="mt-2 h-4 w-3/4" />
              </div>
            ))}
          </div>
        ) : articles.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <FilterX aria-hidden="true" className="h-8 w-8 text-text-subtle" />
            <p className="mt-3 text-sm text-text-muted">
              No articles from the selected sources in this topic.
            </p>
            <button
              type="button"
              onClick={onSelectAllSources}
              className="mt-3 inline-flex h-11 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium text-text transition-colors hover:bg-surface-2"
            >
              Show all sources
            </button>
          </div>
        ) : (
          <ul className="space-y-2">
            {articles.map((a) => (
              <li key={a.id}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block rounded-lg border border-border bg-surface p-3 transition-colors hover:border-accent/50 hover:bg-surface-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-full bg-accent-2/15 px-2.5 py-0.5 text-xs font-semibold text-accent-2">
                      {a.source}
                    </span>
                    <time
                      dateTime={a.published_at || undefined}
                      title={formatDateTime(a.published_at)}
                      className="shrink-0 text-xs text-text-muted"
                    >
                      {formatRelative(a.published_at)}
                    </time>
                  </div>
                  <div className="mt-2 flex items-start gap-2">
                    <h3 className="line-clamp-3 min-w-0 flex-1 break-words text-sm font-medium leading-snug text-text">
                      {a.title}
                    </h3>
                    <ExternalLink
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-text-subtle transition-colors group-hover:text-accent"
                    />
                  </div>
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
