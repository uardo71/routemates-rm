"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CR_FLOW, CR_STAGES, asCrStage, crRecordFromDraft, exitChecks, isCrTerminal, nextStage, nextStepState, parseHours,
  type CrDraft, type CrStageKey,
} from "@/lib/change-request";
import { StageLifecycle, type StageEvent } from "./stage-lifecycle";
import { moveChangeRequestAction } from "../cr-actions";

// The change request's lifecycle: its rules (src/lib/change-request.ts) turned into the model the
// shared panel draws (./stage-lifecycle.tsx). What is particular to a change request and stays here:
// its checks read the record rather than a hand-ticked gate, Rejected is a terminal state outside the
// flow, and the next step — which applies at any stage — is edited in the panel's sidebar and saved
// with the ticket's Save button, alongside the record in CrRecordSection.

export type CrEvent = StageEvent;
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

export function ChangeRequestLifecycle({ ticketId, cr, draft, set, editable, canManage, dirty, assigneeId, resolution, users }: {
  ticketId: string; cr: CrView; draft: CrDraft; set: (p: Partial<CrDraft>) => void;
  editable: boolean; canManage: boolean; dirty: boolean; assigneeId: string; resolution: string; users: Opt[];
}) {
  const stage = cr.stage;
  const record = crRecordFromDraft(draft, { assigneeId: assigneeId || null, resolution: resolution || null, evidence: cr.evidence });
  const next = stage ? nextStage(stage) : null;
  const rejectedFrom = stage === "rejected" ? [...cr.events].reverse().find((e) => e.toKey === "rejected")?.fromKey ?? null : null;
  const curIdx = (CR_FLOW as readonly string[]).indexOf(stage === "rejected" ? rejectedFrom ?? "" : stage ?? "");
  const def = stage ? CR_STAGES[stage] : null;

  return (
    <StageLifecycle
      ticketId={ticketId}
      note="No SLA — a change request is tracked by stage, time in stage and its next step."
      flow={CR_FLOW.map((k) => ({ key: k, label: CR_STAGES[k].label, terminal: isCrTerminal(k), purpose: CR_STAGES[k].purpose }))}
      timeInStage={cr.timeInStage}
      current={stage && def ? {
        key: stage, label: def.label, owner: def.owner, purpose: def.purpose, steps: def.steps,
        terminal: isCrTerminal(stage), stopped: stage === "rejected", index: curIdx,
      } : null}
      offFlowNotice={<>This ticket is in &ldquo;{cr.statusName}&rdquo;, which isn&apos;t a lifecycle stage. An administrator can check the change-request type in ticket settings.</>}
      stageSince={cr.stageSince}
      checksFor={(key) => { const st = asCrStage(key); return st ? exitChecks(st, record) : []; }}
      stageBody={(key) => <CrRecordSection stage={asCrStage(key)} draft={draft} set={set} editable={editable} loggedMinutes={cr.loggedMinutes} />}
      next={next ? { key: next, label: CR_STAGES[next].label } : null}
      backOptions={curIdx > 0 ? CR_FLOW.slice(0, curIdx).map((k) => ({ key: k, label: CR_STAGES[k].label })) : []}
      close={{ key: "rejected", label: "Reject", title: "Reject the change request", noteLabel: "Why is it rejected?" }}
      reopen={stage && isCrTerminal(stage)
        ? (stage === "closed" ? { key: "closing", label: "Closing" } : { key: "evaluation", label: "Evaluation" })
        : null}
      editable={editable} canManage={canManage} dirty={dirty}
      notEditableNotice={<>Only the client&apos;s support team and the people on this ticket can move it.</>}
      sidebar={<NextStep draft={draft} set={set} editable={editable} users={users} todayIso={cr.todayIso} closed={!!stage && isCrTerminal(stage)} />}
      events={cr.events}
      labelOf={stageLabel}
      move={(input) => moveChangeRequestAction(ticketId, input)}
    />
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

// ---------- the record (what each stage produced), edited with the ticket's Save ----------

/** What ONE stage of a change request recorded, drawn inside the lifecycle panel under the stage the
 *  stepper is showing. Edited with the ticket's Save, as before.
 *
 *  This replaced a fixed stack of six cards — Evaluation, Customer approval, Development, Unit
 *  testing, UAT, Go-live — that rendered ALL of them on every change request whatever stage it was
 *  in. That stack was the duplicate-lifecycle problem this redesign set out to remove, so it is
 *  gone rather than hidden: reach another stage by clicking its step. "Customer approval" was never
 *  a stage of its own and now sits inside Evaluation, where its gate is checked. */
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

  const body = stage === "evaluation" ? (
    <>
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
            <div className={cn("h-full rounded-full", pct > 1 ? "bg-destructive" : pct > 0.9 ? "bg-warning" : "bg-success")} style={{ width: `${Math.min(100, pct * 100)}%` }} />
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {txt("approvedByName", "Approved by")}
        {date("approvedOn", "Approved on")}
      </div>
      {txt("approvalReference", "PO / e-mail reference")}
    </>
  ) : stage === "development" ? (
    <>
      {date("plannedGoLive", "Planned go-live")}
      {area("buildReference", "Transports / release", 2, "e.g. DA1K900123, DA1K900124")}
    </>
  ) : stage === "unit_testing" ? (
    <>
      {area("unitTestNotes", "Results", 3, "Scenarios tested and their outcome — or attach the evidence under Unit testing")}
      {date("unitTestedOn", "Tested on")}
    </>
  ) : stage === "uat" ? (
    <>
      <div className="grid grid-cols-2 gap-2">
        {txt("uatSignedOffBy", "Signed off by")}
        {date("uatSignedOffOn", "Signed off on")}
      </div>
      {area("uatNotes", "Notes", 2)}
    </>
  ) : stage === "go_live" ? (
    date("goLiveOn", "Went live on")
  ) : null;

  if (!body) return null;
  return <div className="flex flex-col gap-3 rounded-md border border-border/60 bg-background p-3">{body}</div>;
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-1"><span className="text-[11px] text-muted-foreground">{label}</span>{children}</div>;
}
function Ro({ children, pre }: { children: string; pre?: boolean }) {
  return children ? <span className={cn("text-sm", pre && "whitespace-pre-wrap")}>{children}</span> : <span className="text-sm text-muted-foreground/40">—</span>;
}
