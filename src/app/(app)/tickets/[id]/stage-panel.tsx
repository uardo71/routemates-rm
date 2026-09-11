"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  closeTarget, earlierStages, gateChecks, nextStage, reopenTarget, sortStages, stageByKey, stageIndex,
  type StageDef,
} from "@/lib/ticket-stages";
import { FieldControl, type PubField } from "../field-control";
import { StageLifecycle, type StageEvent } from "./stage-lifecycle";
import { setGateCheckAction, moveTicketStageAction } from "../stage-actions";

// The lifecycle panel for a STAGE-mode ticket type (Bug, and any type an administrator puts on
// stages). Everything it decides comes from the pure rules in src/lib/ticket-stages.ts over the
// stages the type carries in the DB; the drawing is the shared panel the change request also uses.

export type StageView = {
  /** The type's stages, in order, with their gates. */
  stages: StageDef[];
  /** Where the ticket is, or null when it carries no stage yet. */
  stageKey: string | null;
  /** The legacy status, shown when the ticket sits outside the stage list. */
  statusName: string;
  typeName: string;
  /** Gate keys someone has ticked on this ticket. */
  ticked: string[];
  events: StageEvent[];
  timeInStage: Record<string, number>;
  stageSince: string;
};

export function TicketStageLifecycle({ ticketId, view, editable, canManage, dirty }: {
  ticketId: string; view: StageView; editable: boolean; canManage: boolean; dirty: boolean;
}) {
  const router = useRouter();
  const [, start] = React.useTransition();
  // A tick is saved on the spot (it isn't part of the ticket's draft), so the row is moved here
  // first and only rolled back if the server refuses it.
  const [pending, setPending] = React.useState<Record<string, boolean>>({});

  const stages = sortStages(view.stages);
  const current = stageByKey(stages, view.stageKey);
  const ticked = new Set(view.ticked);
  for (const [key, on] of Object.entries(pending)) { if (on) ticked.add(key); else ticked.delete(key); }

  const next = current ? nextStage(stages, current.key) : null;
  const close = current ? closeTarget(stages, current.key) : null;
  const reopen = current ? reopenTarget(stages, current.key) : null;
  const labelOf = (key: string | null) => stageByKey(stages, key)?.name ?? key ?? "—";

  function toggle(key: string, on: boolean) {
    setPending((p) => ({ ...p, [key]: on }));
    start(async () => {
      const r = await setGateCheckAction(ticketId, key, on);
      if (r.error) {
        toast.error(r.error);
        setPending((p) => { const q = { ...p }; delete q[key]; return q; });
        return;
      }
      router.refresh();
    });
  }

  return (
    <StageLifecycle
      ticketId={ticketId}
      note={`No SLA — a ${view.typeName.toLowerCase()} is tracked by stage and time in stage.`}
      flow={stages.map((s) => ({ key: s.key, label: s.name, terminal: s.isTerminal }))}
      timeInStage={view.timeInStage}
      current={current ? {
        key: current.key, label: current.name, owner: null,
        purpose: current.description ?? "", steps: [],
        terminal: current.isTerminal, stopped: false, index: stageIndex(stages, current.key),
      } : null}
      offFlowNotice={
        <>This ticket is in &ldquo;{view.statusName}&rdquo;, which isn&apos;t one of {view.typeName}&apos;s stages. An administrator can check the type in ticket settings.</>
      }
      stageSince={view.stageSince}
      checks={gateChecks(current, ticked)}
      onToggleCheck={toggle}
      next={next ? { key: next.key, label: next.name } : null}
      backOptions={current ? earlierStages(stages, current.key).map((s) => ({ key: s.key, label: s.name })) : []}
      close={close ? { key: close.key, label: `Close as ${close.name}`, title: `Close as ${close.name}`, noteLabel: "Why is it closed without going through the remaining stages?" } : null}
      reopen={reopen ? { key: reopen.key, label: reopen.name } : null}
      editable={editable} canManage={canManage} dirty={dirty}
      notEditableNotice={<>Only the client&apos;s support team and the people on this ticket can move it.</>}
      events={view.events}
      labelOf={labelOf}
      move={(input) => moveTicketStageAction(ticketId, input)}
    />
  );
}

// ---------- the stage-scoped fields, edited with the ticket's Save ----------

export type StageFieldVal = PubField & { stageKey: string; value: unknown; display: string };

/** A STAGE-mode type's fields, grouped under the stage they belong to — the generic counterpart of
 *  the change request's record section. Values ride the ticket's own draft and Save. */
export function TicketStageFields({ typeName, stages, stageKey, fields, values, onChange, editable, users }: {
  typeName: string; stages: StageDef[]; stageKey: string | null;
  fields: StageFieldVal[]; values: Record<string, unknown>;
  onChange: (fieldId: string, value: unknown) => void; editable: boolean; users: { id: string; name: string }[];
}) {
  const groups = sortStages(stages)
    .map((s) => ({ stage: s, fields: fields.filter((f) => f.stageKey === s.key) }))
    .filter((g) => g.fields.length > 0);
  if (groups.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="border-b pb-1.5 text-sm font-semibold">{typeName} record</h2>
      {groups.map(({ stage, fields: fs }) => {
        const active = stage.key === stageKey;
        return (
          <div key={stage.key} className={cn("flex flex-col gap-2 rounded-md border p-3", active ? "border-primary/50 bg-primary/[0.03]" : "border-border/60")}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{stage.name}</span>
              {active && <span className="text-[11px] font-medium text-primary">current stage</span>}
            </div>
            {editable ? (
              <div className="grid grid-cols-1 gap-3">
                {fs.map((f) => <FieldControl key={f.id} field={f} users={users} value={values[f.id]} onChange={(v) => onChange(f.id, v)} />)}
              </div>
            ) : (
              fs.map((f) => (
                <div key={f.id} className="flex min-w-0 flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">{f.name}</span>
                  {f.display ? <span className="text-sm whitespace-pre-wrap">{f.display}</span> : <span className="text-sm text-muted-foreground/40">—</span>}
                </div>
              ))
            )}
          </div>
        );
      })}
    </section>
  );
}
