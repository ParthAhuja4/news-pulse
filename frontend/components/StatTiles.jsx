import Skeleton from "./Skeleton";

export default function StatTiles({ stats, loading }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-2xl border border-border bg-surface/70 px-4 py-3"
        >
          <dt className="text-xs font-medium uppercase tracking-wide text-text-subtle">
            {s.label}
          </dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums text-text sm:text-2xl">
            {loading ? <Skeleton className="h-7 w-16 sm:h-8" /> : s.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
