export type BarPoint = { label: string; value: number };

// A small trend chart (weekly hours, monthly invoiced value) — plain divs, no SVG needed since
// bars are just rectangles. Bars and labels are separate flex rows sharing the same column
// widths so percentage heights resolve cleanly against the bars row's own fixed height.
export function MiniBarChart({
  data,
  height = 80,
  valueFormatter = (v: number) => String(v),
}: {
  data: BarPoint[];
  height?: number;
  valueFormatter?: (value: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No data yet.</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((d, i) => (
          <div key={i} className="flex-1 h-full flex items-end" title={`${d.label}: ${valueFormatter(d.value)}`}>
            <div
              className="w-full rounded-t bg-primary/70 hover:bg-primary transition-colors min-h-[2px]"
              style={{ height: `${(d.value / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        {data.map((d, i) => (
          <span key={i} className="flex-1 text-center text-[10px] text-muted-foreground truncate">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
