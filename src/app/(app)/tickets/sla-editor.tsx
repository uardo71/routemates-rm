"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TicketPriority } from "@prisma/client";
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABEL, TICKET_PRIORITY_DOT } from "@/lib/ticket";
import type { SlaTargets } from "@/lib/sla";

type Draft = Record<TicketPriority, { respond: string; resolve: string }>;
const toDraft = (t: SlaTargets): Draft =>
  Object.fromEntries(TICKET_PRIORITIES.map((p) => [p, { respond: String(t[p].respond), resolve: String(t[p].resolve) }])) as Draft;

/** A 4×2 grid of respond/resolve hour targets. `onSave` receives the targets object.
 *  `disabled` greys the inputs (used when a client is set to "use company default"). */
export function SlaEditor({ initial, onSave, saveLabel = "Save SLA", disabled = false }: {
  initial: SlaTargets; onSave: (t: SlaTargets) => Promise<{ error?: string }>; saveLabel?: string; disabled?: boolean;
}) {
  const [vals, setVals] = React.useState<Draft>(() => toDraft(initial));
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok?: boolean; text: string } | null>(null);
  const set = (p: TicketPriority, k: "respond" | "resolve", v: string) => setVals((s) => ({ ...s, [p]: { ...s[p], [k]: v } }));

  async function save() {
    setSaving(true); setMsg(null);
    const targets = Object.fromEntries(TICKET_PRIORITIES.map((p) => [p, { respond: Number(vals[p].respond) || 0, resolve: Number(vals[p].resolve) || 0 }])) as SlaTargets;
    const r = await onSave(targets);
    setSaving(false);
    setMsg(r.error ? { text: r.error } : { ok: true, text: "Saved." });
  }

  return (
    <div className={cn("flex flex-col gap-3", disabled && "pointer-events-none opacity-50")}>
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-2">
        <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">Priority</span>
        <span className="w-24 text-center text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">Respond (h)</span>
        <span className="w-24 text-center text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">Resolve (h)</span>
        {TICKET_PRIORITIES.map((p) => (
          <React.Fragment key={p}>
            <span className="flex items-center gap-1.5 text-sm"><span className={cn("size-2 rounded-full", TICKET_PRIORITY_DOT[p])} /> {TICKET_PRIORITY_LABEL[p]}</span>
            <Input className="h-8 w-24 text-center" type="number" min="1" step="1" value={vals[p].respond} onChange={(e) => set(p, "respond", e.target.value)} disabled={disabled} />
            <Input className="h-8 w-24 text-center" type="number" min="1" step="1" value={vals[p].resolve} onChange={(e) => set(p, "resolve", e.target.value)} disabled={disabled} />
          </React.Fragment>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={saving || disabled}>{saving ? "Saving…" : saveLabel}</Button>
        {msg && <span className={cn("text-sm", msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>{msg.text}</span>}
      </div>
    </div>
  );
}
