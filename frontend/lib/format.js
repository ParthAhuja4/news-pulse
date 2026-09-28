// Date helpers shared by the topic list and the article panel.

function parse(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(iso, fallback = "") {
  const d = parse(iso);
  if (!d) return fallback;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDay(iso, fallback = "") {
  const d = parse(iso);
  if (!d) return fallback;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// "Sep 26 – Sep 28", or a single day when both ends fall on the same date.
export function formatDayRange(start, end) {
  const a = formatDay(start);
  const b = formatDay(end);
  if (!a && !b) return "";
  if (!a || !b || a === b) return a || b;
  return `${a} – ${b}`;
}

// "just now", "12m ago", "3h ago", "2d ago", then a plain date.
export function formatRelative(iso, now = Date.now()) {
  const d = parse(iso);
  if (!d) return "";
  const mins = Math.round((now - d.getTime()) / 60000);
  if (mins < 0) return formatDateTime(iso);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDay(iso);
}

// Splits an api.js error ("500 Internal Server Error — detail") into a short
// message for the reader and the raw text as secondary detail.
export function describeError(message) {
  const raw = String(message || "");
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return {
      title: "Can't reach the server",
      detail: "It may be starting up. Try again in a moment.",
    };
  }
  if (/^404\b/.test(raw)) {
    return { title: "That item is no longer available", detail: raw };
  }
  if (/^5\d\d\b/.test(raw)) {
    return { title: "The server ran into a problem", detail: raw };
  }
  return { title: "Something went wrong", detail: raw };
}
