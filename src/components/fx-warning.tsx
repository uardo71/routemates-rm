import { AlertTriangleIcon } from "lucide-react";
import type { ExcludedGroup } from "@/lib/fx";

/** Visible warning for rows a report could not convert to the reporting currency (missing rate).
 *  Renders nothing when everything converted. `noun` is the plural row name, e.g. "invoices". */
export function FxWarning({ excluded, noun, reporting }: { excluded: ExcludedGroup[]; noun: string; reporting: string }) {
  if (!excluded.length) return null;
  const total = excluded.reduce((s, g) => s + g.count, 0);
  const details = excluded.map((g) => `no ${reporting} rate for ${g.currency} on ${g.date}`).join("; ");
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
      <span>
        <span className="font-medium">{total} {noun} excluded</span> from the totals: {details}. Add the missing exchange rate to include them.
      </span>
    </div>
  );
}
