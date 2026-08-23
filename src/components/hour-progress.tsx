import { cn } from "@/lib/utils";

export function HourProgress({
  used,
  cap,
  label,
  suffix = "h",
}: {
  used: number;
  cap: number | null;
  label?: string;
  suffix?: string;
}) {
  const over = cap !== null && used > cap;
  const pct = cap !== null && cap > 0 ? Math.min(100, (used / cap) * 100) : null;
  // Round for display only — summed even-split hours are repeating decimals that otherwise render as
  // float noise like 2959.9999999999986h.
  const show = (n: number) => Math.round(n * 100) / 100;

  return (
    <div className="flex flex-col gap-1 min-w-32">
      <div className="flex items-center justify-between gap-2 text-xs">
        {label && <span className="text-muted-foreground">{label}</span>}
        <span className={cn("font-medium tabular-nums", over && "text-destructive")}>
          {show(used)}
          {suffix} {cap !== null ? `/ ${show(cap)}${suffix}` : "(no cap)"}
        </span>
      </div>
      {pct !== null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", over ? "bg-destructive" : "bg-primary")}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
