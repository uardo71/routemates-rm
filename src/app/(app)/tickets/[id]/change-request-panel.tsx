"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, XIcon, CheckCircle2Icon, XCircleIcon, ShieldAlertIcon, ArrowRightIcon, Undo2Icon, BanIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  CR_FLOW, CR_STAGES, asCrStage, crRecordFromDraft, exitChecks, formatDuration, isCrTerminal, nextStage, nextStepState, parseHours,
  type CrDraft, type CrStageKey,
} from "@/lib/change-request";
import type { GateCheck } from "@/lib/project-stage";
import { moveChangeRequestAction } from "../cr-actions";

// The change-request lifecycle on the ticket: where it is (stepper with time spent in each stage),
// what this stage is for and what gets it done, what must be true to move on, the next step with
// its owner and due date, and every move so far. The record the checks read is edited in
// CrRecordSection and saved with the ticket's Save button.

export type CrEvent = { id: string; fromKey: string | null; toKey: string; move: string; note: string; overrideReason: string; byName: string; at: string };
export type CrView = {
  stage: CrStageKey | null;
  statusName: string;
  saved: CrDraft;
  events: CrEvent[];
  timeInStage: Record<string, number>;
  stageSince: string;
  loggedMinutes: number;
  evidence: Partial<Record<CrStageKey, number>>;
  todayIso: string;
};
type Opt = { id: string; name: string };

const stageLabel = (k: string | null) => { const s = asCrStage(k); return s ? CR_STAGES[s].label : k ?? "—"; };
const fmtDT = (s: string) => (s ? s.slice(0, 16).replace("T", " ") : "—");

export function ChangeRequestLifecycle({ ticketId, cr, draft, set, editable, canManage, dirty, assigneeId, resolution, users }: {
  ticketId: string; cr: CrView; draft: CrDraft; set: (p: Partial<CrDraft>) => void;
  editable: boolean; canManage: boolean; dirty: boolean; assigneeId: string; resolution: string; users: Opt[];
}) {
  const [dialog, setDialog] = React.useState<"forward" | "back" | "reject" | "reopen" | null>(null);
  const stage = cr.stage;
  const record = crRecordFromDraft(draft, { assigneeId: assigneeId || null, resolution: resolution || null, evidence: cr.evidence });
  const checks = stage ? exitChecks(stage, record) : [];
  const next = stage ? nextStage(stage) : null;
  const rejectedFrom = stage === "rejected" ? [...cr.events].reverse().find((e) => e.toKey === "rejected")?.fromKey ?? null : null;
  const curIdx = (CR_FLOW as readonly string[]).indexOf(stage === "rejected" ? rejectedFrom ?? "" : stage ?? "");
  const since = stage ? cr.timeInStage[stage] : undefined;
  const def = stage ? CR_STAGES[stage] : null;

  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Lifecycle</h2>
        <span className="text-xs text-muted-foreground">No SLA — a change request is tracked by stage, time in stage and its next step.</span>
      </div>

      {/* stepper */}
      <div className="overflow-x-auto pb-1">
        <ol className="flex min-w-max items-start">
          {CR_FLOW.map((k, i) => {
            const state = stage === "closed" || i < curIdx ? "done" : i === curIdx ? (stage === "rejected" ? "stopped" : "current") : "todo";
            const spent = cr.timeInStage[k];
            return (
              <li key={k} className="flex items-start">
                <div className="flex w-24 flex-col items-center gap-1 text-center sm:w-28">
                  <span className={cn(
                    "flex size-7 items-center justify-center rounded-full border-2 text-xs font-semibold tabular-nums",
                    state === "done" && "border-emerald-500 bg-emerald-500 text-white",
                    state === "current" && "border-primary bg-primary/10 text-primary ring-4 ring-primary/15",
                    state === "stopped" && "border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400",
                    state === "todo" && "border-border text-muted-foreground",
                  )}>
                    {state === "done" ? <CheckIcon className="size-4" /> : state === "stopped" ? <XIcon className="size-3.5" /> : i + 1}
                  </span>
                  <span className={cn("text-xs leading-tight", state === "current" ? "font-semibold text-foreground" : "text-muted-foreground")}>{CR_STAGES[k].label}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{spent ? formatDuration(spent) : k === "closed" ? "" : "—"}</span>
                </div>
                {i < CR_FLOW.length - 1 && <span className={cn("mt-3.5 h-0.5 w-5 shrink-0 sm:w-8", stage === "closed" || i < curIdx ? "bg-emerald-500" : "bg-border")} />}
              </li>
            );
          })}
        </ol>
      </div>

      {!stage ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-3 text-sm">
          This ticket is in &ldquo;{cr.statusName}&rdquo;, which isn&apos;t a lifecycle stage. An administrator can check the change-request type in ticket settings.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          {/* current stage */}
          <div className="flex flex-col gap-3 rounded-md border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm">
                <span className={cn("font-semibold", stage === "rejected" && "text-rose-600 dark:text-rose-400", stage === "closed" && "text-emerald-700 dark:text-emerald-400")}>
                  {isCrTerminal(stage) ? def!.label : `Now: ${def!.label}`}
                </span>
                {!isCrTerminal(stage) && <span className="text-muted-foreground"> · for {since ? formatDuration(since) : "<1h"} (since {cr.stageSince.slice(0, 10)})</span>}
              </div>
              {!isCrTerminal(stage) && <span className="text-xs text-muted-foreground">Driven by {def!.owner}</span>}
            </div>
            <p className="text-sm text-muted-foreground">{def!.purpose}</p>

            {def!.steps.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">What gets it done</span>
                <ul className="flex flex-col gap-1 text-sm">
                  {def!.steps.map((s) => <li key={s} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" />{s}</li>)}
                </ul>
              </div>
            )}

            {next && checks.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">To move to {CR_STAGES[next].label}</span>
                <CheckList checks={checks} />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              {next && (
                <Button size="sm" className="gap-1.5" disabled={!editable || dirty} onClick={() => setDialog("forward")}>
                  Move to {CR_STAGES[next].label} <ArrowRightIcon className="size-4" />
                </Button>
              )}
              {!isCrTerminal(stage) && curIdx > 0 && (
                <Button size="sm" variant="outline" className="gap-1.5" disabled={!editable || dirty} onClick={() => setDialog("back")}><Undo2Icon className="size-4" /> Send back</Button>
              )}
              {!isCrTerminal(stage) && canManage && (
                <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={dirty} onClick={() => setDialog("reject")}><BanIcon className="size-4" /> Reject</Button>
              )}
              {isCrTerminal(stage) && canManage && (
                <Button size="sm" variant="outline" className="gap-1.5" disabled={dirty} onClick={() => setDialog("reopen")}>
                  <RotateCcwIcon className="size-4" /> Reopen into {stage === "closed" ? "Closing" : "Evaluation"}
                </Button>
              )}
              {dirty && <span className="text-xs text-amber-700 dark:text-amber-400">Save your changes before moving the stage.</span>}
              {!editable && <span className="text-xs text-muted-foreground">Only the client&apos;s support team and the people on this ticket can move it.</span>}
            </div>
          </div>

          {/* next step + history */}
          <div className="flex flex-col gap-3">
            <NextStep draft={draft} set={set} editable={editable} users={users} todayIso={cr.todayIso} closed={isCrTerminal(stage)} />
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <span className="text-sm font-semibold">Stage history</span>
              <StageHistory events={cr.events} />
            </div>
          </div>
        </div>
      )}

      {dialog && stage && (
        <MoveDialog ticketId={ticketId} mode={dialog} stage={stage} next={next} checks={checks} canManage={canManage} onClose={() => setDialog(null)} />
      )}
    </section>
  );
}

function CheckList({ checks }: { checks: GateCheck[] }) {
  return (
    <ul className="flex flex-col divide-y rounded-md border">
      {checks.map((c) => (
        <li key={c.key} className="flex items-start gap-2 px-2.5 py-1.5 text-sm">
          {c.ok ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircleIcon className="mt-0.5 size-4 shrink-0 text-rose-600" />}
          <div className="min-w-0">
            <div className={cn(c.ok && "text-muted-foreground")}>{c.label}</div>
            {!c.ok && <div className="text-xs text-muted-foreground">{c.hint}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function NextStep({ draft, set, editable, users, todayIso, closed }: {
  draft: CrDraft; set: (p: Partial<CrDraft>) => void; editable: boolean; users: Opt[]; todayIso: string; closed: boolean;
}) {
  const state = closed ? "none" : nextStepState(draft.nextStepDue || null, todayIso);
  const owner = users.find((u) => u.id === draft.nextStepOwnerId)?.name;
  return (
    <div className={cn("flex flex-col gap-2 rounded-md border p-3", state === "overdue" && "border-rose-500/40 bg-rose-500/[0.04]")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">Next step</span>
        {state === "overdue" && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-400">Overdue since {draft.nextStepDue}</span>}
        {state === "today" && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">Due today</span>}
        {state === "upcoming" && <span className="text-xs text-muted-foreground">Due {draft.nextStepDue}</span>}
      </div>
      {editable ? (
        <>
          <Input value={draft.nextStep} onChange={(e) => set({ nextStep: e.target.value })} maxLength={500} placeholder="e.g. Send the estimate to the customer for approval" className="h-8" aria-label="Next step" />
          <div className="grid grid-cols-2 gap-2">
            <select value={draft.nextStepOwnerId} onChange={(e) => set({ nextStepOwnerId: e.target.value })} className="h-8 rounded-md border border-border/60 bg-background px-2 text-sm" aria-label="Next step owner">
              <option value="">Owner…</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <Input type="date" value={draft.nextStepDue} onChange={(e) => set({ nextStepDue: e.target.value })} className="h-8" aria-label="Next step due" />
          </div>
        </>
      ) : draft.nextStep ? (
        <p className="text-sm">{draft.nextStep}<span className="text-muted-foreground">{owner ? ` · ${owner}` : ""}</span></p>
      ) : (
        <p className="text-sm text-muted-foreground">No next step recorded.</p>
      )}
    </div>
  );
}

function StageHistory({ events }: { events: CrEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">No moves yet.</p>;
  const text = (e: CrEvent) => {
    switch (e.move) {
      case "START": return `Started in ${stageLabel(e.toKey)}`;
      case "BACK": return `Sent back to ${stageLabel(e.toKey)}`;
      case "REJECT": return "Rejected";
      case "REOPEN": return `Reopened into ${stageLabel(e.toKey)}`;
      default: return `${stageLabel(e.fromKey)} → ${stageLabel(e.toKey)}`;
    }
  };
  const dot = (m: string) => (m === "BACK" ? "bg-amber-500" : m === "REJECT" ? "bg-rose-500" : m === "REOPEN" ? "bg-sky-500" : "bg-emerald-500");
  return (
    <ol className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
      {[...events].reverse().map((e) => (
        <li key={e.id} className="flex gap-2 text-xs">
          <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", dot(e.move))} />
          <div className="min-w-0">
            <div><span className="font-medium text-foreground">{text(e)}</span> <span className="text-muted-foreground">· {e.byName} · {fmtDT(e.at)}</span></div>
            {e.note && <div className="whitespace-pre-wrap text-muted-foreground">&ldquo;{e.note}&rdquo;</div>}
            {e.overrideReason && <div className="text-amber-700 dark:text-amber-400">Checks overridden: {e.overrideReason}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function MoveDialog({ ticketId, mode, stage, next, checks, canManage, onClose }: {
  ticketId: string; mode: "forward" | "back" | "reject" | "reopen"; stage: CrStageKey; next: CrStageKey | null;
  checks: GateCheck[]; canManage: boolean; onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const earlier = CR_FLOW.slice(0, Math.max(0, (CR_FLOW as readonly string[]).indexOf(stage)));
  const [backTo, setBackTo] = React.useState<string>(earlier[earlier.length - 1] ?? "evaluation");
  const [note, setNote] = React.useState("");
  const [override, setOverride] = React.useState("");
  const failing = mode === "forward" ? checks.filter((c) => !c.ok) : [];
  const needsOverride = failing.length > 0;
  const to = mode === "forward" ? next! : mode === "back" ? backTo : mode === "reject" ? "rejected" : stage === "closed" ? "closing" : "evaluation";
  const needsNote = mode !== "forward";
  const title = mode === "forward" ? `Move to ${CR_STAGES[next!].label}` : mode === "back" ? "Send back" : mode === "reject" ? "Reject the change request" : `Reopen into ${stageLabel(to)}`;
  const blocked = pending || (needsNote && note.trim().length < 3) || (needsOverride && (!canManage || override.trim().length === 0));

  function submit() {
    start(async () => {
      const r = await moveChangeRequestAction(ticketId, { to, note, overrideReason: needsOverride ? override : undefined });
      if (r.error) { toast.error(r.error); return; }
      toast.success(`Moved to ${stageLabel(to)}.`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open disablePointerDismissal onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1 text-sm">
          <p className="text-muted-foreground">{stageLabel(stage)} <ArrowRightIcon className="inline size-3.5" /> {stageLabel(to)}</p>
          {mode === "forward" && checks.length > 0 && <CheckList checks={checks} />}
          {mode === "back" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="cr-back">Back to</Label>
              <select id="cr-back" value={backTo} onChange={(e) => setBackTo(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm">
                {earlier.map((k) => <option key={k} value={k}>{CR_STAGES[k].label}</option>)}
              </select>
            </div>
          )}
          {needsOverride && (canManage ? (
            <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-3">
              <Label htmlFor="cr-override" className="inline-flex items-center gap-1.5"><ShieldAlertIcon className="size-4 text-amber-600" /> Go ahead anyway</Label>
              <Textarea id="cr-override" value={override} onChange={(e) => setOverride(e.target.value)} rows={2} maxLength={1000} placeholder="Why move on with checks not met? (required, kept in the stage history)" />
            </div>
          ) : (
            <p className="rounded-md border border-rose-500/30 bg-rose-500/[0.05] p-3 text-xs">Fix the red items first — or ask someone on the client&apos;s support team, who can go ahead with a reason.</p>
          ))}
          <div className="flex flex-col gap-1">
            <Label htmlFor="cr-note">{mode === "back" ? "What has to be redone?" : mode === "reject" ? "Why is it rejected?" : mode === "reopen" ? "Why is it reopened?" : "Note for the history (optional)"}</Label>
            <Textarea id="cr-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button size="sm" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={blocked} className={cn(mode === "reject" && "bg-destructive text-white hover:bg-destructive/90")}>
            {pending ? "Saving…" : needsOverride ? `${title} anyway` : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- the record (what each stage produced), edited with the ticket's Save ----------

export function CrRecordSection({ draft, set, editable, loggedMinutes, stage }: {
  draft: CrDraft; set: (p: Partial<CrDraft>) => void; editable: boolean; loggedMinutes: number; stage: CrStageKey | null;
}) {
  const est = parseHours(draft.estimateHours);
  const logged = Math.round((loggedMinutes / 60) * 100) / 100;
  const pct = est && est > 0 ? logged / est : null;
  const txt = (k: keyof CrDraft, label: string, placeholder?: string) => (
    <Fld label={label}>{editable ? <Input value={draft[k]} onChange={(e) => set({ [k]: e.target.value })} placeholder={placeholder} className="h-8" /> : <Ro>{draft[k]}</Ro>}</Fld>
  );
  const date = (k: keyof CrDraft, label: string) => (
    <Fld label={label}>{editable ? <Input type="date" value={draft[k]} onChange={(e) => set({ [k]: e.target.value })} className="h-8" /> : <Ro>{draft[k]}</Ro>}</Fld>
  );
  const area = (k: keyof CrDraft, label: string, rows: number, placeholder?: string) => (
    <Fld label={label}>{editable ? <Textarea value={draft[k]} onChange={(e) => set({ [k]: e.target.value })} rows={rows} placeholder={placeholder} className="border-border/60 bg-background" /> : <Ro pre>{draft[k]}</Ro>}</Fld>
  );

  return (
    <section className="flex flex-col gap-3">
      <h2 className="border-b pb-1.5 text-sm font-semibold">Change request</h2>
      <Group title="Evaluation" active={stage === "evaluation"}>
        {area("assessment", "Impact assessment and proposed solution", 4, "What changes, what it touches, how it will be built")}
        <div className="grid grid-cols-2 gap-2">
          {txt("estimateHours", "Estimate (hours)", "e.g. 16")}
          {txt("quoteReference", "Quote / offer ref.")}
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Logged on the ticket</span>
            <span className="tabular-nums">{logged}h{est && est > 0 ? ` of ${est}h` : ""}</span>
          </div>
          {pct !== null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full", pct > 1 ? "bg-rose-500" : pct > 0.9 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, pct * 100)}%` }} />
            </div>
          )}
        </div>
      </Group>
      <Group title="Customer approval" active={stage === "evaluation"}>
        <div className="grid grid-cols-2 gap-2">
          {txt("approvedByName", "Approved by")}
          {date("approvedOn", "Approved on")}
        </div>
        {txt("approvalReference", "PO / e-mail reference")}
      </Group>
      <Group title="Development" active={stage === "development"}>
        {date("plannedGoLive", "Planned go-live")}
        {area("buildReference", "Transports / release", 2, "e.g. DA1K900123, DA1K900124")}
      </Group>
      <Group title="Unit testing" active={stage === "unit_testing"}>
        {area("unitTestNotes", "Results", 3, "Scenarios tested and their outcome — or attach the evidence under Unit testing")}
        {date("unitTestedOn", "Tested on")}
      </Group>
      <Group title="UAT" active={stage === "uat"}>
        <div className="grid grid-cols-2 gap-2">
          {txt("uatSignedOffBy", "Signed off by")}
          {date("uatSignedOffOn", "Signed off on")}
        </div>
        {area("uatNotes", "Notes", 2)}
      </Group>
      <Group title="Go-live" active={stage === "go_live"}>
        {date("goLiveOn", "Went live on")}
      </Group>
    </section>
  );
}

function Group({ title, active, children }: { title: string; active: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-md border p-3", active ? "border-primary/50 bg-primary/[0.03]" : "border-border/60")}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        {active && <span className="text-[11px] font-medium text-primary">current stage</span>}
      </div>
      {children}
    </div>
  );
}
function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-1"><span className="text-[11px] text-muted-foreground">{label}</span>{children}</div>;
}
function Ro({ children, pre }: { children: string; pre?: boolean }) {
  return children ? <span className={cn("text-sm", pre && "whitespace-pre-wrap")}>{children}</span> : <span className="text-sm text-muted-foreground/40">—</span>;
}
