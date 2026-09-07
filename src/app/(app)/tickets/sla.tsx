"use client";

import { AlertTriangleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { isOpenCategory } from "@/lib/ticket-config";
import type { TicketRow } from "./serialize";

export type SlaState = { show: boolean; breached: boolean; label: string; tone: string };

function rel(ms: number): string {
  const h = Math.round(ms / 3_600_000);
  if (h < 24) return `in ${Math.max(1, h)}h`;
  return `in ${Math.round(h / 24)}d`;
}

/** SLA display state for a ticket: the active target (respond until first response, then resolve),
 *  whether it's breached, and a colour. Clocks stop once the ticket leaves an open status. */
export function slaState(r: Pick<TicketRow, "statusCategory" | "firstResponseAt" | "respondBy" | "resolveBy">): SlaState {
  if (!isOpenCategory(r.statusCategory)) return { show: false, breached: false, label: "", tone: "" };
  const responded = !!r.firstResponseAt;
  const targetIso = responded ? r.resolveBy : r.respondBy;
  if (!targetIso) return { show: false, breached: false, label: "", tone: "" };
  const now = Date.now();
  const target = new Date(targetIso).getTime();
  const breached = now > target;
  const kind = responded ? "Resolve" : "Respond";
  const label = breached ? `${kind} overdue` : `${kind} ${rel(target - now)}`;
  const tone = breached
    ? "border-rose-500/40 bg-rose-500/8 text-rose-700 dark:text-rose-400"
    : target - now < 4 * 3_600_000
      ? "border-amber-500/40 bg-amber-500/8 text-amber-700 dark:text-amber-400"
      : "border-border bg-muted/40 text-muted-foreground";
  return { show: true, breached, label, tone };
}

export function SlaPill({ state, className }: { state: SlaState; className?: string }) {
  if (!state.show) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs", state.tone, className)}>
      {state.breached && <AlertTriangleIcon className="size-3" />}
      {state.label}
    </span>
  );
}
