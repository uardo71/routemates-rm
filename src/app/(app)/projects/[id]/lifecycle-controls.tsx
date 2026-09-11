"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2Icon, XCircleIcon, ShieldAlertIcon, ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PROJECT_STATUS_LABEL, type GateCheck, type ProjectStatusKey, type TransitionRule } from "@/lib/project-stage";
import { changeProjectStatusAction, writeOffMilestoneAction } from "../lifecycle-actions";

type Props = {
  projectId: string;
  projectName: string;
  status: string;
  isAdmin: boolean;
  transitions: TransitionRule[];
  readiness: GateCheck[];
  closure: GateCheck[];
  unbilled: { hours: number; value: number; currency: string };
  openMilestones: { id: string; name: string; status: string }[];
  /** Deep links to the field that fixes each check. */
  fixHrefs: Record<string, string>;
  /** `?lifecycle=start` opens the Start delivery dialog straight away. */
  autoOpen: string | null;
};

const CONFIRM_TEXT: Partial<Record<ProjectStatusKey, string>> = {
  ON_HOLD: "Time entry stops while the project is on hold. Record an open issue saying why and what unblocks it — the hygiene worklist checks for one.",
  CANCELLED: "A cancelled project takes no new time and can't be invoiced. Approved time stays as it is. Only an administrator can reopen it.",
  ACTIVE: "Time entry opens again for everyone assigned.",
  PLANNED: "The project goes back to Planned. It has to pass Prepare for Delivery again before anyone can log time.",
};

export function LifecycleControls(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const initial = p.autoOpen === "start" ? p.transitions.find((t) => t.gate === "readiness") ?? null : null;
  const [open, setOpen] = useState<TransitionRule | null>(initial);
  const [reason, setReason] = useState("");
  const [uatNa, setUatNa] = useState(false);
  const [wipAck, setWipAck] = useState(false);
  const [writeOff, setWriteOff] = useState<Record<string, string>>({});


  if (p.transitions.length === 0) return null;

  const gate = open?.gate;
  const checks = !gate ? [] : (gate === "readiness" ? p.readiness : p.closure).map((c) => {
    if (c.key === "uat" && uatNa) return { ...c, ok: true };
    if (c.key === "wip" && wipAck) return { ...c, ok: true };
    return c;
  });
  const failing = checks.filter((c) => !c.ok);
  const needsOverride = failing.length > 0;

  function submit() {
    if (!open) return;
    start(async () => {
      const r = await changeProjectStatusAction({
        projectId: p.projectId, to: open.to,
        overrideReason: needsOverride ? reason : null,
        uatNotApplicable: gate === "closure" ? uatNa : undefined,
        wipAcknowledged: gate === "closure" ? wipAck : undefined,
      });
      if (r.error) { toast.error(r.error); return; }
      toast.success(`${p.projectName} is now ${PROJECT_STATUS_LABEL[open.to]}.`);
      setOpen(null);
      router.refresh();
    });
  }
  function doWriteOff(id: string) {
    const why = (writeOff[id] ?? "").trim();
    if (why.length < 3) { toast.error("Say why this milestone is written off."); return; }
    start(async () => {
      const r = await writeOffMilestoneAction({ milestoneId: id, reason: why });
      if (r.error) toast.error(r.error);
      else { toast.success("Milestone written off."); router.refresh(); }
    });
  }

  return (
    <>
      {p.transitions.map((t) => (
        <Button
          key={t.to} size="sm" variant={t.gate === "readiness" ? "default" : "outline"} disabled={pending}
          className={cn(t.to === "CANCELLED" && "text-destructive hover:bg-destructive/10 hover:text-destructive")}
          onClick={() => { setReason(""); setUatNa(false); setWipAck(false); setOpen(t); }}
        >{t.label}</Button>
      ))}

      {open && (
        <Dialog open disablePointerDismissal onOpenChange={(v) => !v && !pending && setOpen(null)}>
          <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>{gate === "readiness" ? "Prepare for Delivery" : gate === "closure" ? "Close the project" : `${open.label}?`}</DialogTitle>
            </DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1 text-sm">
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">{p.projectName}</span>: {PROJECT_STATUS_LABEL[p.status as ProjectStatusKey] ?? p.status} <ArrowRightIcon className="inline size-3.5" /> {PROJECT_STATUS_LABEL[open.to]}.{" "}
                {gate === "readiness" && "Everything below must be in place before anyone logs time."}
                {gate === "closure" && "Closing locks time entry on every milestone and closes every active assignment."}
                {!gate && CONFIRM_TEXT[open.to]}
              </p>

              {gate && (
                <ul className="flex flex-col divide-y rounded-md border">
                  {checks.map((c) => (
                    <li key={c.key} className="flex items-start gap-2.5 px-3 py-2">
                      {c.ok ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircleIcon className="mt-0.5 size-4 shrink-0 text-rose-600" />}
                      <div className="min-w-0 flex-1">
                        <div className={cn("font-medium", c.ok && "text-muted-foreground")}>{c.label}</div>
                        {!c.ok && (
                          <div className="text-xs text-muted-foreground">
                            {c.hint}{" "}
                            {p.fixHrefs[c.key] && <Link href={p.fixHrefs[c.key]} className="font-medium text-primary hover:underline">Fix it</Link>}
                          </div>
                        )}
                        {gate === "closure" && c.key === "uat" && (!c.ok || uatNa) && (
                          <label className="mt-1 flex items-center gap-2 text-xs"><input type="checkbox" className="size-3.5" checked={uatNa} onChange={(e) => setUatNa(e.target.checked)} /> UAT is not applicable to this project</label>
                        )}
                        {gate === "closure" && c.key === "wip" && (!c.ok || wipAck) && (
                          <label className="mt-1 flex items-center gap-2 text-xs"><input type="checkbox" className="size-3.5" checked={wipAck} onChange={(e) => setWipAck(e.target.checked)} /> Close anyway: {p.unbilled.currency} {p.unbilled.value.toFixed(2)} ({p.unbilled.hours}h) stays unbilled, and that goes in the audit log</label>
                        )}
                        {gate === "closure" && c.key === "milestones" && !c.ok && p.openMilestones.length > 0 && (
                          <div className="mt-2 flex flex-col gap-1.5">
                            {p.openMilestones.map((m) => (
                              <div key={m.id} className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-xs">{m.name} <span className="text-muted-foreground">· {m.status.toLowerCase()}</span></span>
                                <Input value={writeOff[m.id] ?? ""} onChange={(e) => setWriteOff((w) => ({ ...w, [m.id]: e.target.value }))} placeholder="Why write it off?" className="h-7 w-44 text-xs" />
                                <Button size="xs" variant="outline" disabled={pending} onClick={() => doWriteOff(m.id)}>Write off</Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {gate && needsOverride && (
                p.isAdmin ? (
                  <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-3">
                    <Label htmlFor="lc-reason" className="inline-flex items-center gap-1.5"><ShieldAlertIcon className="size-4 text-amber-600" /> Override as administrator</Label>
                    <Textarea id="lc-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} placeholder="Why go ahead with checks still failing? (required, recorded in the audit log)" />
                    <p className="text-[11px] text-muted-foreground">The project shows an override badge until the checks pass.</p>
                  </div>
                ) : (
                  <p className="rounded-md border border-rose-500/30 bg-rose-500/[0.05] p-3 text-xs">
                    Fix the red items first — or ask an administrator, who can override with a reason.
                  </p>
                )
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button size="sm" variant="outline" onClick={() => setOpen(null)} disabled={pending}>Cancel</Button>
              <Button
                size="sm" onClick={submit}
                disabled={pending || (needsOverride && (!p.isAdmin || reason.trim().length === 0))}
                className={cn(open.to === "CANCELLED" && "bg-destructive text-white hover:bg-destructive/90")}
              >{pending ? "Saving…" : needsOverride ? `${open.label} anyway` : open.label}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
