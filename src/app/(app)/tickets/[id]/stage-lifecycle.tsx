"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, XIcon, CheckCircle2Icon, XCircleIcon, ShieldAlertIcon, ArrowRightIcon, Undo2Icon, BanIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/change-request";
import type { GateCheck } from "@/lib/project-stage";

// The lifecycle panel every staged ticket type draws: where it is (a stepper with time spent in each
// stage), what this stage is for and what gets it done, what must be true to move on, an optional
// sidebar (the change request's next step), and every move so far.
//
// It renders; it does not decide. The two rule sources feed it a model of their own:
//   • change-request-panel.tsx — src/lib/change-request.ts (checks read the record; Rejected sits
//     outside the flow, which is what `stopped` draws)
//   • stage-panel.tsx          — src/lib/ticket-stages.ts (stages and gates come from the DB, and
//     the gates are ticked by hand, which is what `onToggleCheck` is for)

export type StageEvent = {
  id: string; fromKey: string | null; toKey: string; move: string;
  note: string; overrideReason: string; byName: string; at: string;
};
/** One box of the stepper. `terminal` only decides whether a blank stage shows "—" or nothing. */
export type StageStep = { key: string; label: string; terminal: boolean };
export type StageTarget = { key: string; label: string };
/** The terminal stage a ticket can be dropped into early, with the words its dialog uses. */
export type CloseTarget = StageTarget & { title: string; noteLabel: string };

export type CurrentStage = {
  key: string; label: string; owner: string | null; purpose: string; steps: string[];
  /** An end state: the move buttons give way to Reopen. */
  terminal: boolean;
  /** A terminal stage the flow did not reach (a rejected change request) — drawn in rose, and every
   *  earlier step keeps its own state instead of all reading as done. */
  stopped: boolean;
  /** Index in `flow`; for a stopped stage, the step it stopped at. */
  index: number;
};

const fmtDT = (s: string) => (s ? s.slice(0, 16).replace("T", " ") : "—");

export function StageLifecycle({
  ticketId, note, flow, timeInStage, current, offFlowNotice, stageSince, checks, onToggleCheck,
  next, backOptions, close, reopen, editable, canManage, dirty, notEditableNotice, sidebar, events,
  labelOf, move,
}: {
  ticketId: string;
  /** The line at the top right — what this type is tracked by. */
  note: string;
  flow: StageStep[];
  timeInStage: Record<string, number>;
  current: CurrentStage | null;
  /** Shown instead of the panel when the ticket sits outside the flow. */
  offFlowNotice: React.ReactNode;
  stageSince: string;
  checks: GateCheck[];
  /** Set for hand-ticked gates; left out when the checks are computed from a record. */
  onToggleCheck?: (key: string, next: boolean) => void;
  next: StageTarget | null;
  backOptions: StageTarget[];
  close: CloseTarget | null;
  reopen: StageTarget | null;
  editable: boolean; canManage: boolean; dirty: boolean;
  notEditableNotice: React.ReactNode;
  sidebar?: React.ReactNode;
  events: StageEvent[];
  labelOf: (key: string | null) => string;
  move: (input: { to: string; note: string; overrideReason?: string }) => Promise<{ error?: string }>;
}) {
  const [dialog, setDialog] = React.useState<"forward" | "back" | "close" | "reopen" | null>(null);
  const curIdx = current?.index ?? -1;
  const allDone = !!current?.terminal && !current.stopped;
  const since = current ? timeInStage[current.key] : undefined;

  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Lifecycle</h2>
        <span className="text-xs text-muted-foreground">{note}</span>
      </div>

      {/* stepper */}
      <div className="overflow-x-auto pb-1">
        <ol className="flex min-w-max items-start">
          {flow.map((step, i) => {
            const state = allDone || i < curIdx ? "done" : i === curIdx ? (current?.stopped ? "stopped" : "current") : "todo";
            const spent = timeInStage[step.key];
            return (
              <li key={step.key} className="flex items-start">
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
                  <span className={cn("text-xs leading-tight", state === "current" ? "font-semibold text-foreground" : "text-muted-foreground")}>{step.label}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{spent ? formatDuration(spent) : step.terminal ? "" : "—"}</span>
                </div>
                {i < flow.length - 1 && <span className={cn("mt-3.5 h-0.5 w-5 shrink-0 sm:w-8", allDone || i < curIdx ? "bg-emerald-500" : "bg-border")} />}
              </li>
            );
          })}
        </ol>
      </div>

      {!current ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-3 text-sm">{offFlowNotice}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          {/* current stage */}
          <div className="flex flex-col gap-3 rounded-md border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm">
                <span className={cn("font-semibold", current.stopped && "text-rose-600 dark:text-rose-400", allDone && "text-emerald-700 dark:text-emerald-400")}>
                  {current.terminal ? current.label : `Now: ${current.label}`}
                </span>
                {!current.terminal && <span className="text-muted-foreground"> · for {since ? formatDuration(since) : "<1h"} (since {stageSince.slice(0, 10)})</span>}
              </div>
              {!current.terminal && current.owner && <span className="text-xs text-muted-foreground">Driven by {current.owner}</span>}
            </div>
            <p className="text-sm text-muted-foreground">{current.purpose}</p>

            {current.steps.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">What gets it done</span>
                <ul className="flex flex-col gap-1 text-sm">
                  {current.steps.map((s) => <li key={s} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" />{s}</li>)}
                </ul>
              </div>
            )}

            {next && checks.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">To move to {next.label}</span>
                <CheckList checks={checks} onToggle={editable ? onToggleCheck : undefined} />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              {next && (
                <Button size="sm" className="gap-1.5" disabled={!editable || dirty} onClick={() => setDialog("forward")}>
                  Move to {next.label} <ArrowRightIcon className="size-4" />
                </Button>
              )}
              {!current.terminal && backOptions.length > 0 && (
                <Button size="sm" variant="outline" className="gap-1.5" disabled={!editable || dirty} onClick={() => setDialog("back")}><Undo2Icon className="size-4" /> Send back</Button>
              )}
              {!current.terminal && close && canManage && (
                <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={dirty} onClick={() => setDialog("close")}><BanIcon className="size-4" /> {close.label}</Button>
              )}
              {current.terminal && reopen && canManage && (
                <Button size="sm" variant="outline" className="gap-1.5" disabled={dirty} onClick={() => setDialog("reopen")}>
                  <RotateCcwIcon className="size-4" /> Reopen into {reopen.label}
                </Button>
              )}
              {dirty && <span className="text-xs text-amber-700 dark:text-amber-400">Save your changes before moving the stage.</span>}
              {!editable && <span className="text-xs text-muted-foreground">{notEditableNotice}</span>}
            </div>
          </div>

          {/* sidebar + history */}
          <div className="flex flex-col gap-3">
            {sidebar}
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <span className="text-sm font-semibold">Stage history</span>
              <StageHistory events={events} labelOf={labelOf} />
            </div>
          </div>
        </div>
      )}

      {dialog && current && (
        <MoveDialog
          ticketId={ticketId} mode={dialog} from={current} next={next} backOptions={backOptions} close={close} reopen={reopen}
          checks={checks} canManage={canManage} labelOf={labelOf} move={move} onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}

export function CheckList({ checks, onToggle }: { checks: GateCheck[]; onToggle?: (key: string, next: boolean) => void }) {
  return (
    <ul className="flex flex-col divide-y rounded-md border">
      {checks.map((c) => onToggle ? (
        <li key={c.key} className="flex items-start gap-2 px-2.5 py-1.5 text-sm">
          <button
            type="button" onClick={() => onToggle(c.key, !c.ok)} aria-pressed={c.ok}
            title={c.ok ? "Untick this check" : "Tick this check"}
            className="mt-0.5 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {c.ok ? <CheckCircle2Icon className="size-4 text-emerald-600" /> : <XCircleIcon className="size-4 text-rose-600 hover:text-muted-foreground" />}
          </button>
          <div className="min-w-0">
            <button type="button" onClick={() => onToggle(c.key, !c.ok)} className={cn("text-left outline-none hover:underline focus-visible:underline", c.ok && "text-muted-foreground")}>{c.label}</button>
            {!c.ok && <div className="text-xs text-muted-foreground">{c.hint}</div>}
          </div>
        </li>
      ) : (
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

function StageHistory({ events, labelOf }: { events: StageEvent[]; labelOf: (key: string | null) => string }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">No moves yet.</p>;
  const text = (e: StageEvent) => {
    switch (e.move) {
      case "START": return `Started in ${labelOf(e.toKey)}`;
      case "BACK": return `Sent back to ${labelOf(e.toKey)}`;
      case "REJECT": return "Rejected";
      case "CLOSE": return `Closed as ${labelOf(e.toKey)}`;
      case "REOPEN": return `Reopened into ${labelOf(e.toKey)}`;
      default: return `${labelOf(e.fromKey)} → ${labelOf(e.toKey)}`;
    }
  };
  const dot = (m: string) => (m === "BACK" ? "bg-amber-500" : m === "REJECT" || m === "CLOSE" ? "bg-rose-500" : m === "REOPEN" ? "bg-sky-500" : "bg-emerald-500");
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

function MoveDialog({ ticketId, mode, from, next, backOptions, close, reopen, checks, canManage, labelOf, move, onClose }: {
  ticketId: string; mode: "forward" | "back" | "close" | "reopen"; from: CurrentStage;
  next: StageTarget | null; backOptions: StageTarget[]; close: CloseTarget | null; reopen: StageTarget | null;
  checks: GateCheck[]; canManage: boolean; labelOf: (key: string | null) => string;
  move: (input: { to: string; note: string; overrideReason?: string }) => Promise<{ error?: string }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [backTo, setBackTo] = React.useState<string>(backOptions[backOptions.length - 1]?.key ?? "");
  const [note, setNote] = React.useState("");
  const [override, setOverride] = React.useState("");
  const failing = mode === "forward" ? checks.filter((c) => !c.ok) : [];
  const needsOverride = failing.length > 0;
  const to = mode === "forward" ? next?.key ?? "" : mode === "back" ? backTo : mode === "close" ? close?.key ?? "" : reopen?.key ?? "";
  const needsNote = mode !== "forward";
  const title = mode === "forward" ? `Move to ${next?.label ?? ""}` : mode === "back" ? "Send back" : mode === "close" ? close?.title ?? "" : `Reopen into ${labelOf(to)}`;
  const blocked = pending || !to || (needsNote && note.trim().length < 3) || (needsOverride && (!canManage || override.trim().length === 0));

  function submit() {
    start(async () => {
      const r = await move({ to, note, overrideReason: needsOverride ? override : undefined });
      if (r.error) { toast.error(r.error); return; }
      toast.success(`Moved to ${labelOf(to)}.`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open disablePointerDismissal onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1 text-sm">
          <p className="text-muted-foreground">{labelOf(from.key)} <ArrowRightIcon className="inline size-3.5" /> {labelOf(to)}</p>
          {mode === "forward" && checks.length > 0 && <CheckList checks={checks} />}
          {mode === "back" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor={`stage-back-${ticketId}`}>Back to</Label>
              <select id={`stage-back-${ticketId}`} value={backTo} onChange={(e) => setBackTo(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm">
                {backOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
          )}
          {needsOverride && (canManage ? (
            <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-3">
              <Label htmlFor={`stage-override-${ticketId}`} className="inline-flex items-center gap-1.5"><ShieldAlertIcon className="size-4 text-amber-600" /> Go ahead anyway</Label>
              <Textarea id={`stage-override-${ticketId}`} value={override} onChange={(e) => setOverride(e.target.value)} rows={2} maxLength={1000} placeholder="Why move on with checks not met? (required, kept in the stage history)" />
            </div>
          ) : (
            <p className="rounded-md border border-rose-500/30 bg-rose-500/[0.05] p-3 text-xs">Fix the red items first — or ask someone on the client&apos;s support team, who can go ahead with a reason.</p>
          ))}
          <div className="flex flex-col gap-1">
            <Label htmlFor={`stage-note-${ticketId}`}>{mode === "back" ? "What has to be redone?" : mode === "close" ? close?.noteLabel ?? "" : mode === "reopen" ? "Why is it reopened?" : "Note for the history (optional)"}</Label>
            <Textarea id={`stage-note-${ticketId}`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button size="sm" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={blocked} className={cn(mode === "close" && "bg-destructive text-white hover:bg-destructive/90")}>
            {pending ? "Saving…" : needsOverride ? `${title} anyway` : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
