"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createMilestoneAdjustmentAction, deleteMilestoneAdjustmentAction } from "../../../milestone-actions";

export type AdjustmentRow = { id: string; amount: number; reason: string; opportunity: { id: string; number: string | null; name: string } | null; byName: string; at: string };
export type OppOption = { id: string; label: string };

const NONE = "NONE";

export function MilestoneAdjustments({
  milestoneId, currency, baseValue, adjustments, opportunities, canManage,
}: {
  milestoneId: string;
  currency: string;
  baseValue: number;
  adjustments: AdjustmentRow[];
  opportunities: OppOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [dir, setDir] = useState<"REMOVE" | "ADD">("REMOVE");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [oppId, setOppId] = useState(NONE);

  const total = adjustments.reduce((s, a) => s + a.amount, 0);
  const effective = baseValue + total;

  function add() {
    const abs = Math.abs(Number(amount) || 0);
    if (abs <= 0) return toast.error("Enter an amount.");
    if (!reason.trim()) return toast.error("Enter a reason.");
    start(async () => {
      const r = await createMilestoneAdjustmentAction({ milestoneId, amount: dir === "REMOVE" ? -abs : abs, reason: reason.trim(), opportunityId: oppId === NONE ? null : oppId });
      if (r.error) toast.error(r.error);
      else { toast.success("Adjustment recorded."); setAmount(""); setReason(""); setOppId(NONE); setAdding(false); router.refresh(); }
    });
  }
  function remove(id: string) {
    if (!confirm("Remove this adjustment?")) return;
    start(async () => { const r = await deleteMilestoneAdjustmentAction(id); if (r.error) toast.error(r.error); else { toast.success("Removed."); router.refresh(); } });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Value &amp; adjustments</CardTitle>
        {canManage && <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}><PlusIcon className="size-3.5" /> Adjust value</Button>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Original value</div>
            <div className="text-lg font-semibold tabular-nums">{formatMoney(baseValue, currency)}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Adjustments</div>
            <div className={cn("text-lg font-semibold tabular-nums", total < 0 ? "text-amber-600" : total > 0 ? "text-emerald-600" : "")}>{total === 0 ? "—" : `${total > 0 ? "+" : "−"}${formatMoney(Math.abs(total), currency)}`}</div>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Effective value</div>
            <div className="text-lg font-semibold tabular-nums">{formatMoney(effective, currency)}</div>
          </div>
        </div>

        {adding && (
          <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Action</Label>
                <Select value={dir} items={[{ value: "REMOVE", label: "Remove (take out)" }, { value: "ADD", label: "Absorb (add)" }]} onValueChange={(v) => setDir((v as "REMOVE" | "ADD") ?? "REMOVE")}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="REMOVE">Remove (take out)</SelectItem><SelectItem value="ADD">Absorb (add)</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Amount</Label>
                <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-36" placeholder="e.g. 7700" />
              </div>
              <div className="flex flex-col gap-1.5 flex-1 min-w-52">
                <Label>Reason</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Austria self-managed by client; moved to new PO" />
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Link to opportunity (optional)</Label>
                <Select value={oppId} items={[{ value: NONE, label: "— none —" }, ...opportunities.map((o) => ({ value: o.id, label: o.label }))]} onValueChange={(v) => setOppId(v ?? NONE)}>
                  <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— none —</SelectItem>
                    {opportunities.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={add} disabled={pending}>{pending ? "Saving…" : "Record adjustment"}</Button>
            </div>
          </div>
        )}

        {adjustments.length > 0 && (
          <div className="flex flex-col gap-2 border-t pt-3">
            {adjustments.map((a) => (
              <div key={a.id} className="flex items-start gap-2.5 text-sm group">
                <span className={cn("mt-1 tabular-nums font-medium w-24 shrink-0 text-right", a.amount < 0 ? "text-amber-600" : "text-emerald-600")}>{a.amount > 0 ? "+" : "−"}{formatMoney(Math.abs(a.amount), currency)}</span>
                <div className="flex-1 min-w-0">
                  <div>{a.reason}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.byName} · {a.at}
                    {a.opportunity && <> · moved to <Link href={`/opportunities/${a.opportunity.id}`} className="text-primary hover:underline font-mono">{a.opportunity.number ?? a.opportunity.name}</Link></>}
                  </div>
                </div>
                {canManage && <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive" onClick={() => remove(a.id)} disabled={pending}><Trash2Icon className="size-3.5" /></Button>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
