"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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

export function TicketStageLifecycle({ ticketId, view, editable, canManage, dirty, fields, values, onChange, users }: {
  ticketId: string; view: StageView; editable: boolean; canManage: boolean; dirty: boolean;
  /** The type's stage-scoped fields. They render INSIDE the lifecycle panel, under the stage the
   *  stepper is showing — the page has no second copy of them. */
  fields: StageFieldVal[]; values: Record<string, unknown>;
  onChange: (fieldId: string, value: unknown) => void; users: { id: string; name: string }[];
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
      flow={stages.map((s) => ({ key: s.key, label: s.name, terminal: s.isTerminal, purpose: s.description ?? "" }))}
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
      checksFor={(key) => gateChecks(stageByKey(stages, key), ticked)}
      onToggleCheck={toggle}
      stageBody={(key) => (
        <TicketStageFields stageKey={key} fields={fields} values={values} onChange={onChange} editable={editable} users={users} />
      )}
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

// ---------- the fields of ONE stage, edited with the ticket's Save ----------

export type StageFieldVal = PubField & { stageKey: string; value: unknown; display: string };

/** The fields ONE stage recorded, drawn inside the lifecycle panel. Values ride the ticket's own
 *  draft and Save. There is deliberately no "every stage at once" rendering: the stepper is how you
 *  reach another stage, and a ticket shows exactly one lifecycle panel. */
export function TicketStageFields({ stageKey, fields, values, onChange, editable, users }: {
  stageKey: string; fields: StageFieldVal[]; values: Record<string, unknown>;
  onChange: (fieldId: string, value: unknown) => void; editable: boolean; users: { id: string; name: string }[];
}) {
  const mine = fields.filter((f) => f.stageKey === stageKey);
  if (mine.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border/60 bg-background p-3">
      {editable
        ? mine.map((f) => <FieldControl key={f.id} field={f} users={users} value={values[f.id]} onChange={(v) => onChange(f.id, v)} />)
        : mine.map((f) => (
            <div key={f.id} className="flex min-w-0 flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">{f.name}</span>
              {f.display ? <span className="text-sm whitespace-pre-wrap">{f.display}</span> : <span className="text-sm text-muted-foreground/40">—</span>}
            </div>
          ))}
    </div>
  );
}
