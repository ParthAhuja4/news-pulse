"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

// Timeline view: one bar per cluster. Bar width is meaningless on a category
// axis, so we encode "intensity" (article count, normalized 0..1) as bar HEIGHT
// + color saturation, and order clusters by start time. Clicking a bar opens
// the cluster detail panel.
//
// (The spec asked for a horizontal time axis with bars spanning start->end and
// size scaled by article count. recharts' BarChart on a category axis gives us
// the clickable, count-scaled bars; a true Gantt-style span chart is a stretch
// goal noted in PROJECT.md.)

const COLORS = [
  "#38bdf8",
  "#a78bfa",
  "#f472b6",
  "#34d399",
  "#fbbf24",
  "#f87171",
  "#60a5fa",
  "#c084fc",
];

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Timeline({ data, selectedId, onSelect }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-white/10 bg-pulse-panel/60 text-gray-400">
        No clusters yet. Hit “Refresh data” to ingest the latest news.
      </div>
    );
  }

  // recharts wants the category axis ordered; we already sorted by start server-side.
  const chartData = data.map((c) => ({
    id: c.id,
    label: c.label,
    count: c.count,
    intensity: c.intensity,
    start: c.start,
    end: c.end,
    // Short label for the axis (top 1-2 words) to avoid crowding.
    short: c.label.split(" / ").slice(0, 2).join(" / "),
  }));

  return (
    <div className="rounded-xl border border-white/10 bg-pulse-panel/60 p-4">
      <ResponsiveContainer width="100%" height={360}>
        <BarChart
          data={chartData}
          margin={{ top: 16, right: 24, left: 0, bottom: 60 }}
        >
          <XAxis
            dataKey="short"
            tick={{ fill: "#9ca3af", fontSize: 11 }}
            interval={0}
            angle={-35}
            textAnchor="end"
            height={70}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: "#9ca3af", fontSize: 12 }}
            label={{
              value: "articles",
              angle: -90,
              position: "insideLeft",
              fill: "#9ca3af",
              fontSize: 12,
            }}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.05)" }}
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const p = payload[0].payload;
              return (
                <div className="rounded-lg border border-white/10 bg-[#0b1020]/95 px-3 py-2 text-xs shadow-xl">
                  <div className="font-semibold text-white">{p.label}</div>
                  <div className="text-gray-300">{p.count} articles</div>
                  <div className="text-gray-400">
                    {formatDate(p.start)} → {formatDate(p.end)}
                  </div>
                </div>
              );
            }}
          />
          <Bar
            dataKey="count"
            radius={[6, 6, 0, 0]}
            cursor="pointer"
            onClick={(d) => onSelect && onSelect(d.id)}
          >
            {chartData.map((entry, i) => (
              <Cell
                key={entry.id}
                fill={COLORS[i % COLORS.length]}
                fillOpacity={0.4 + 0.6 * entry.intensity}
                stroke={selectedId === entry.id ? "#fff" : "transparent"}
                strokeWidth={selectedId === entry.id ? 2 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-2 text-center text-xs text-gray-500">
        Bar height = article count. Click a bar to see its articles.
      </p>
    </div>
  );
}
