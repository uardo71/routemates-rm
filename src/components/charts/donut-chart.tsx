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
                  className={cn(seg.colorClass.replaceAll("fill-", "stroke-"))}
                />
              );
              cumulativePercent += percent;
              return el;
            })
          )}
        </svg>
        {(centerLabel || centerSublabel) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {centerLabel && <span className="text-lg font-semibold tabular-nums leading-tight">{centerLabel}</span>}
            {centerSublabel && <span className="text-[10px] text-muted-foreground">{centerSublabel}</span>}
          </div>
        )}
      </div>
      {legend && (
        <div className="flex flex-col gap-1.5 min-w-0">
          {segments.map((seg, i) => (
            <div key={i} className="flex items-center gap-2 text-xs min-w-0">
              <span className={cn("size-2 shrink-0 rounded-full", seg.colorClass.replaceAll("fill-", "bg-"))} />
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
