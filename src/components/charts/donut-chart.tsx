import { cn } from "@/lib/utils";

export type DonutSegment = { label: string; value: number; colorClass: string };

/** A small set of hues distinguishable from each other and from the app's primary blue —
 *  matches the tint set InitialsAvatar uses, so donut legends and avatar chips read as one
 *  consistent palette rather than two competing color systems. */
export const DONUT_COLORS = [
  "fill-blue-500 dark:fill-blue-400",
  "fill-violet-500 dark:fill-violet-400",
  "fill-emerald-500 dark:fill-emerald-400",
  "fill-amber-500 dark:fill-amber-400",
  "fill-rose-500 dark:fill-rose-400",
  "fill-cyan-500 dark:fill-cyan-400",
];

// Tailwind only emits utility classes it can see as *literal strings* in source. The ring stroke
// and legend dot colors are keyed off each segment's `fill-*` class, so the matching `stroke-*` and
// `bg-*` classes must exist literally here — deriving them with `.replaceAll("fill-","stroke-")` at
// runtime produced class names the Tailwind scanner never saw, so `stroke-blue-500` & co. were
// never generated and every donut ring rendered with no colour. These maps keep the literals in
// source; fall back to muted for any unknown class.
const FILL_TO_STROKE: Record<string, string> = {
  "fill-blue-500 dark:fill-blue-400": "stroke-blue-500 dark:stroke-blue-400",
  "fill-violet-500 dark:fill-violet-400": "stroke-violet-500 dark:stroke-violet-400",
  "fill-emerald-500 dark:fill-emerald-400": "stroke-emerald-500 dark:stroke-emerald-400",
  "fill-amber-500 dark:fill-amber-400": "stroke-amber-500 dark:stroke-amber-400",
  "fill-rose-500 dark:fill-rose-400": "stroke-rose-500 dark:stroke-rose-400",
  "fill-cyan-500 dark:fill-cyan-400": "stroke-cyan-500 dark:stroke-cyan-400",
};
const FILL_TO_BG: Record<string, string> = {
  "fill-blue-500 dark:fill-blue-400": "bg-blue-500 dark:bg-blue-400",
  "fill-violet-500 dark:fill-violet-400": "bg-violet-500 dark:bg-violet-400",
  "fill-emerald-500 dark:fill-emerald-400": "bg-emerald-500 dark:bg-emerald-400",
  "fill-amber-500 dark:fill-amber-400": "bg-amber-500 dark:bg-amber-400",
  "fill-rose-500 dark:fill-rose-400": "bg-rose-500 dark:bg-rose-400",
  "fill-cyan-500 dark:fill-cyan-400": "bg-cyan-500 dark:bg-cyan-400",
};
// Hand-rolled rather than pulling in a charting library — same call this codebase already made
// for the Resource Planner (no external Gantt dependency), and a handful of static donuts don't
// justify the bundle weight. Uses SVG's pathLength=100 normalization so segment math is plain
// percentages regardless of the actual circle radius.
export function DonutChart({
  segments,
  size = 112,
  thickness = 14,
  centerLabel,
  centerSublabel,
  legend = true,
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSublabel?: string;
  legend?: boolean;
}) {
  const radius = (size - thickness) / 2;
  const total = segments.reduce((sum, seg) => sum + Math.max(0, seg.value), 0);
  const positive = segments.filter((seg) => seg.value > 0);

  // Keep the center label inside the ring hole: constrain it to the hole diameter and shrink the
  // font for long strings (e.g. a big "ALL 947,915.00") so it never overlaps the ring.
  const hole = size - thickness * 2;
  const labelLen = centerLabel?.length ?? 0;
  const centerLabelSize = labelLen > 11 ? "text-xs" : labelLen > 8 ? "text-sm" : "text-lg";

  let cumulativePercent = 0;

  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          {total <= 0 ? (
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={thickness} className="stroke-muted" />
          ) : (
            positive.map((seg, i) => {
              const percent = (seg.value / total) * 100;
              const el = (
                <circle
                  key={i}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  strokeWidth={thickness}
                  pathLength={100}
                  strokeDasharray={`${percent} ${100 - percent}`}
                  strokeDashoffset={-cumulativePercent}
                  className={cn(FILL_TO_STROKE[seg.colorClass] ?? "stroke-muted")}
                />
              );
              cumulativePercent += percent;
              return el;
            })
          )}
        </svg>
        {(centerLabel || centerSublabel) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-1 text-center">
            {centerLabel && (
              <span className={cn(centerLabelSize, "font-semibold tabular-nums leading-tight")} style={{ maxWidth: hole }}>
                {centerLabel}
              </span>
            )}
            {centerSublabel && <span className="text-[10px] text-muted-foreground">{centerSublabel}</span>}
          </div>
        )}
      </div>
      {legend && (
        <div className="flex flex-col gap-1.5 min-w-0">
          {segments.map((seg, i) => (
            <div key={i} className="flex items-center gap-2 text-xs min-w-0">
              <span className={cn("size-2 shrink-0 rounded-full", FILL_TO_BG[seg.colorClass] ?? "bg-muted")} />
              <span className="truncate text-muted-foreground">{seg.label}</span>
              <span className="ml-auto shrink-0 font-medium tabular-nums">
                {total > 0 ? `${Math.round((seg.value / total) * 100)}%` : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
