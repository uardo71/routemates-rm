"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { previewRematchAction, applyRematchAction, type RematchSummary } from "./actions";

const h = (n: number) => `${Math.round(n * 100) / 100}h`;

/** Finance-only: preview, then apply, a re-match of approved time against manually typed invoices. */
export function RematchButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<RematchSummary | null>(null);
  const [pending, start] = useTransition();

  function openPreview() {
    setOpen(true);
    setSummary(null);
    start(async () => {
      const r = await previewRematchAction();
      if (r.error) { toast.error(r.error); setOpen(false); return; }
      setSummary(r.summary ?? { periods: [], totalChanges: 0 });
    });
  }
  function apply() {
    start(async () => {
      const r = await applyRematchAction();
      if (r.error) { toast.error(r.error); return; }
      toast.success(`Re-matched ${r.summary?.totalChanges ?? 0} time entr${r.summary?.totalChanges === 1 ? "y" : "ies"} with their invoices.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openPreview} title="Match approved time to invoices typed by hand, per task and service period"><Link2Icon className="size-4" /> Re-match with invoices</Button>
      {open && (
        <Dialog open disablePointerDismissal onOpenChange={(v) => !v && !pending && setOpen(false)}>
          <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
            <DialogHeader><DialogTitle>Re-match time with invoices</DialogTitle></DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 text-sm">
              <p className="text-muted-foreground">
                Invoices typed by hand don&apos;t know which hours they bill. This matches them: a line naming a task
                takes that task&apos;s hours, a correction goes with the hours it corrects, and each service period is matched as a
                whole. Invoices created from approved time are left as they are. Nothing on the invoices themselves changes.
              </p>
              {!summary ? (
                <p className="py-8 text-center text-muted-foreground">Checking…</p>
              ) : summary.totalChanges === 0 ? (
                <p className="py-8 text-center text-muted-foreground">Everything already matches — nothing to change.</p>
              ) : (
                <div className="mt-4 flex flex-col gap-4">
                  {summary.periods.map((p) => (
                    <div key={`${p.projectName}|${p.periodStart}`} className="rounded-md border">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                        <span className="font-medium">{p.projectName} <span className="font-normal text-muted-foreground">· {p.periodStart} → {p.periodEnd}</span></span>
                        <span className="text-xs text-muted-foreground">{p.changes} entr{p.changes === 1 ? "y" : "ies"} change · unbilled after: <span className="font-mono">{h(p.unbilledHours)}</span></span>
                      </div>
                      <table className="w-full text-xs">
                        <thead className="text-muted-foreground">
                          <tr><th className="px-3 py-1.5 text-left font-medium">Invoice line</th><th className="px-2 py-1.5 text-right font-medium">Invoiced</th><th className="px-3 py-1.5 text-right font-medium">Matched time now → after</th></tr>
                        </thead>
                        <tbody>
                          {p.lines.map((l, i) => (
                            <tr key={i} className="border-t">
                              <td className="max-w-md truncate px-3 py-1.5" title={l.description}><span className="font-mono text-muted-foreground">{l.invoiceNumber}</span> {l.description}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{h(l.quantity)}</td>
                              <td className="px-3 py-1.5 text-right font-mono">
                                {l.locked ? <span className="text-muted-foreground">{h(l.before)} · from approved time, untouched</span> : (
                                  <><span className={cn(Math.abs(l.before - l.quantity) > 0.005 && "text-rose-600")}>{h(l.before)}</span> → <span className={cn(Math.abs(l.after - l.quantity) > 0.005 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400")}>{h(l.after)}</span></>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Amber means a line ends up slightly over or under its invoiced hours: a logged day can&apos;t be split between two
                    invoices, so time logged without a task can straddle them. The period total is what matters and it matches.
                  </p>
                </div>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
              <Button size="sm" onClick={apply} disabled={pending || !summary || summary.totalChanges === 0}>{pending && summary ? "Applying…" : "Apply"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
