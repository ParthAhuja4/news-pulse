import { Activity, RefreshCw } from "lucide-react";
import ThemeToggle from "./ThemeToggle";

export default function AppHeader({ refreshing, jobStatus, onRefresh }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-2 text-on-accent"
          >
            <Activity className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight text-text sm:text-[1.75rem]">
              News Pulse
            </h1>
            <p className="hidden truncate text-sm text-text-muted sm:block">
              What the news is covering right now, grouped into topics.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {jobStatus && (
            <span
              aria-hidden="true"
              className="hidden text-sm text-text-muted md:inline"
            >
              {jobStatus}
            </span>
          )}
          <ThemeToggle />
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={refreshing ? "Refreshing data" : "Refresh data"}
            className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-lg bg-accent px-3 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70 sm:px-4"
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-4 w-4 ${refreshing ? "motion-safe:animate-spin" : ""}`}
            />
            <span className="hidden sm:inline">
              {refreshing ? "Working…" : "Refresh data"}
            </span>
          </button>
        </div>
      </div>

      {jobStatus && (
        <p
          aria-hidden="true"
          className="border-t border-border px-4 py-1.5 text-center text-xs text-text-muted md:hidden"
        >
          {jobStatus}
        </p>
      )}
      {/* Single live region, so the status is announced once. */}
      <span role="status" className="sr-only">
        {jobStatus}
      </span>
    </header>
  );
}
