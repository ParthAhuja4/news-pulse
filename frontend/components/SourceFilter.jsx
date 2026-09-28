// Source chips for the article list. Scrolls sideways when the chips don't fit.
export default function SourceFilter({ sources, onToggle, onSelectAll }) {
  if (!sources || sources.length === 0) return null;
  const allOn = sources.every((s) => s.checked);

  const chip = (on) =>
    `inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-sm font-medium transition-colors ${
      on
        ? "border-accent bg-accent/10 text-text"
        : "border-border bg-surface text-text-muted hover:bg-surface-2 hover:text-text"
    }`;

  return (
    <div
      role="group"
      aria-label="Filter articles by source"
      className="scroll-thin flex gap-2 overflow-x-auto px-4 py-3"
    >
      <button
        type="button"
        aria-pressed={allOn}
        onClick={onSelectAll}
        className={chip(allOn)}
      >
        All
      </button>
      {sources.map((s) => (
        <button
          key={s.name}
          type="button"
          aria-pressed={s.checked && !allOn}
          onClick={() => onToggle(s.name)}
          className={chip(s.checked && !allOn)}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}
