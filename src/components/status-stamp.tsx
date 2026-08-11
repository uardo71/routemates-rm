import { cn } from "@/lib/utils";

// A rubber-stamp status marker for detail-page headlines — uppercase, letter-spaced, boxed, and
// tilted a couple of degrees like an ink stamp. Dashed border reads as "provisional" (draft /
// pending). Deliberately NOT for dense tables (the tilt looks like misalignment there — tables
// keep the flat pill Badge); use it where a single prominent status sits next to a title.

export type StampTone = "neutral" | "brass" | "green" | "rust" | "amber" | "blue";

const TONE: Record<StampTone, string> = {
  neutral: "border-muted-foreground/50 text-muted-foreground",
  brass: "border-primary/70 text-primary",
  green: "border-emerald-600/60 text-emerald-700 dark:border-emerald-400/60 dark:text-emerald-400",
  rust: "border-destructive/60 text-destructive",
  amber: "border-amber-600/60 text-amber-700 dark:border-amber-400/60 dark:text-amber-400",
  blue: "border-blue-600/60 text-blue-700 dark:border-blue-400/60 dark:text-blue-400",
};

export function StatusStamp({
  label,
  tone = "neutral",
  dashed = false,
  className,
}: {
  label: string;
  tone?: StampTone;
  dashed?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex -rotate-2 select-none items-center rounded-[3px] border-2 px-2 py-0.5 text-xs font-bold uppercase tracking-widest",
        dashed ? "border-dashed" : "border-solid",
        TONE[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}
