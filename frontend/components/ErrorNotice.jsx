import { TriangleAlert, X } from "lucide-react";
import { describeError } from "../lib/format";

// One error style for the page banner and the article panel.
export default function ErrorNotice({ message, onRetry, onDismiss, className = "" }) {
  const { title, detail } = describeError(message);
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 ${className}`}
    >
      <TriangleAlert
        aria-hidden="true"
        className="mt-0.5 h-5 w-5 shrink-0 text-danger"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text">{title}</p>
        {detail && (
          <p className="mt-0.5 break-words text-xs text-text-muted">{detail}</p>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 inline-flex h-9 items-center rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text transition-colors hover:bg-surface-2"
          >
            Try again
          </button>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="-mr-2 -mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
