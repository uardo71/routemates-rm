"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, PencilIcon, Trash2Icon, DownloadIcon, SendIcon, XIcon, PresentationIcon, ChevronDownIcon, SearchIcon, PaperclipIcon, RotateCcwIcon, ClockIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { OwnerCombobox, type OwnerPerson } from "@/components/owner-combobox";
import { SEVERITY_LABEL, RAG_PILL, RAG_DOT, CADENCE_LABEL, RAG_DIMENSIONS, RAG_DIMENSION_LABEL, RAG_LABEL, defaultPeriod, actionsToCarry, progressMismatch } from "@/lib/delivery";
import type { PeriodHours } from "@/lib/realization-data";
import { PROGRESS_BASIS_LABEL, type ProgressBasis } from "@/lib/plan-schedule";
import type { RagStatus } from "@prisma/client";
import { createStatusReportAction, updateStatusReportAction, deleteStatusReportAction, markStatusReportSentAction, periodHoursAction } from "../actions";

export type ReportAction = { id: string; description: string; owner: string | null; ownerUserId: string | null; dueDate: string | null; critical: boolean; done: boolean; doneAt: string | null };
export type ReportRow = {
  id: string;
  reportDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  cadence: string | null;
  overallRag: RagStatus; // Severity/Timing
  scheduleRag: RagStatus;
  budgetRag: RagStatus;
  scopeRag: RagStatus;
  progressPercent: number | null;
  summary: string | null; // current status
  accomplishments: string | null;
  correctiveActions: string | null;
  decisionsNeeded: string | null;
  milestoneNotes: string | null;
  actions: ReportAction[];
  sentAt: string | null;
  authorName: string;
  /** Files uploaded as "Status update" that created / are attached to this entry. */
  documents: { id: string; fileName: string; originalName: string }[];
};

const RAGS: RagStatus[] = ["GREEN", "AMBER", "RED"];
const todayIso = () => new Date().toISOString().slice(0, 10);

const RAG_STROKE: Record<RagStatus, string> = { GREEN: "stroke-emerald-500", AMBER: "stroke-amber-500", RED: "stroke-rose-500" };
function DeckRing({ pct, rag }: { pct: number; rag: RagStatus }) {
  const r = 18, c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <div className="relative size-14 shrink-0">
      <svg viewBox="0 0 48 48" className="size-14 -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" strokeWidth="5" className="stroke-muted" />
        <circle cx="24" cy="24" r={r} fill="none" strokeWidth="5" strokeLinecap="round" className={RAG_STROKE[rag]} strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-mono text-sm font-bold">{pct}%</span>
    </div>
  );
}

type DraftAction = {
  description: string; owner: string; ownerUserId: string | null; dueDate: string; critical: boolean;
  /** rolled over from the previous report */ carried?: boolean;
  /** existing action being edited (keeps its completion and age) */ id?: string;
  done?: boolean;
  /** the earlier action a carried row continues */ carriedFromId?: string;
};
type Draft = {
  id?: string;
  reportDate: string; cadence: string; periodStart: string; periodEnd: string;
  overallRag: RagStatus; progressPercent: string;
  /** "" = follow Overall until the PM picks something for that dimension. */
  scheduleRag: "" | RagStatus; budgetRag: "" | RagStatus; scopeRag: "" | RagStatus;
  summary: string; accomplishments: string; correctiveActions: string; decisionsNeeded: string; milestoneNotes: string;
  actions: DraftAction[];
};
const emptyDraft = (): Draft => ({
  reportDate: todayIso(), cadence: "WEEKLY", ...defaultPeriod("WEEKLY", todayIso()),
  overallRag: "GREEN", progressPercent: "", scheduleRag: "", budgetRag: "", scopeRag: "",
  summary: "", accomplishments: "", correctiveActions: "", decisionsNeeded: "", milestoneNotes: "",
  actions: [{ description: "", owner: "", ownerUserId: null, dueDate: "", critical: false }],
});

/** A new update starts from the latest report in the same scope: same cadence and RAGs, the last
 *  progress figure, and every action that is still open (or was closed after that report went out),
 *  marked "carried". Narrative fields start blank — those must be written fresh. */
function seededDraft(latest: ReportRow | undefined, planPct: number | null): Draft {
  // The plan's effort/duration-weighted % is the suggestion; the last report's figure only when there is no plan.
  const base = { ...emptyDraft(), progressPercent: planPct != null ? String(planPct) : "" };
  if (!latest) return base;
  const cadence = latest.cadence ?? "WEEKLY";
  const carried = actionsToCarry(latest.actions, latest.reportDate).map((a) => ({ description: a.description, owner: a.owner ?? "", ownerUserId: a.ownerUserId, dueDate: a.dueDate ?? "", critical: a.critical, carried: true, done: a.done, carriedFromId: a.id }));
  return {
    ...base,
    cadence,
    ...defaultPeriod(cadence, base.reportDate, latest.periodEnd),
    overallRag: latest.overallRag,
    scheduleRag: latest.scheduleRag === latest.overallRag ? "" : latest.scheduleRag,
    budgetRag: latest.budgetRag === latest.overallRag ? "" : latest.budgetRag,
    scopeRag: latest.scopeRag === latest.overallRag ? "" : latest.scopeRag,
    progressPercent: planPct != null ? String(planPct) : latest.progressPercent != null ? String(latest.progressPercent) : "",
    actions: carried.length ? carried : base.actions,
  };
}

export function StatusReportsClient({ projectId, engagementId, reports, people, planProgress, planBasis }: { projectId: string; engagementId: string | null; reports: ReportRow[]; people: OwnerPerson[]; planProgress: number | null; planBasis: ProgressBasis | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set(reports[0] ? [reports[0].id] : []));
  // The period follows cadence + report date until the PM edits it by hand.
  const [periodTouched, setPeriodTouched] = useState(false);
  const [period, setPeriod] = useState<{ key: string; data: PeriodHours | null; loading: boolean }>({ key: "", data: null, loading: false });
  const periodKey = draft ? `${draft.periodStart}|${draft.periodEnd}` : "";
  useEffect(() => {
    if (!draft || !draft.periodStart || !draft.periodEnd || draft.periodEnd < draft.periodStart) return;
    const key = periodKey;
    let cancelled = false;
    const t = setTimeout(async () => {
      setPeriod((p) => ({ ...p, key, loading: true }));
      const r = await periodHoursAction({ projectId, periodStart: draft.periodStart, periodEnd: draft.periodEnd });
      if (!cancelled) setPeriod({ key, data: r.data ?? null, loading: false });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey, projectId]);
  const openDraft = (d: Draft) => { setPeriodTouched(false); setPeriod({ key: "", data: null, loading: false }); setDraft(d); };
  const setCadenceOrDate = (patch: Partial<Pick<Draft, "cadence" | "reportDate">>) =>
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, ...patch };
      return periodTouched ? next : { ...next, ...defaultPeriod(next.cadence, next.reportDate, reports.find((r) => r.id !== d.id)?.periodEnd) };
    });
  const planWarn = draft && draft.progressPercent !== "" && progressMismatch(Number(draft.progressPercent), planProgress);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const shown = reports.filter((r) => !q.trim() || `${r.reportDate} ${SEVERITY_LABEL[r.overallRag]} ${r.summary ?? ""} ${r.authorName}`.toLowerCase().includes(q.trim().toLowerCase()));

  function save() {
    if (!draft) return;
    const actions = draft.actions.filter((a) => a.description.trim()).map((a) => ({ description: a.description.trim(), owner: a.owner || null, ownerUserId: a.ownerUserId, dueDate: a.dueDate || null, critical: a.critical, id: a.id ?? null, done: a.done, carriedFromId: a.carriedFromId ?? null }));
    const payload = {
      projectId, engagementId, reportDate: draft.reportDate, cadence: draft.cadence as "WEEKLY" | "MONTHLY" | "ADHOC",
      periodStart: draft.periodStart || null, periodEnd: draft.periodEnd || null,
      overallRag: draft.overallRag,
      scheduleRag: draft.scheduleRag || draft.overallRag, budgetRag: draft.budgetRag || draft.overallRag, scopeRag: draft.scopeRag || draft.overallRag,
      progressPercent: draft.progressPercent === "" ? null : Number(draft.progressPercent),
      summary: draft.summary || null, accomplishments: draft.accomplishments || null, correctiveActions: draft.correctiveActions || null,
      decisionsNeeded: draft.decisionsNeeded || null, milestoneNotes: draft.milestoneNotes || null,
      actions,
    };
    start(async () => {
      const r = draft.id ? await updateStatusReportAction({ id: draft.id, ...payload }) : await createStatusReportAction(payload);
      if (r.error) toast.error(r.error);
      else { toast.success("Saved."); setDraft(null); router.refresh(); }
    });
  }
  function edit(r: ReportRow) {
    openDraft({
      id: r.id, reportDate: r.reportDate, cadence: r.cadence ?? "WEEKLY", periodStart: r.periodStart ?? "", periodEnd: r.periodEnd ?? "",
      overallRag: r.overallRag, progressPercent: r.progressPercent != null ? String(r.progressPercent) : "",
      // A dimension equal to the overall is shown as "follows overall" so it keeps following on edit.
      scheduleRag: r.scheduleRag === r.overallRag ? "" : r.scheduleRag, budgetRag: r.budgetRag === r.overallRag ? "" : r.budgetRag, scopeRag: r.scopeRag === r.overallRag ? "" : r.scopeRag,
      summary: r.summary ?? "", accomplishments: r.accomplishments ?? "", correctiveActions: r.correctiveActions ?? "", decisionsNeeded: r.decisionsNeeded ?? "", milestoneNotes: r.milestoneNotes ?? "",
      actions: r.actions.length ? r.actions.map((a) => ({ id: a.id, done: a.done, description: a.description, owner: a.owner ?? "", ownerUserId: a.ownerUserId, dueDate: a.dueDate ?? "", critical: a.critical })) : [{ description: "", owner: "", ownerUserId: null, dueDate: "", critical: false }],
    });
  }
  function markSent(id: string) {
    start(async () => { const r = await markStatusReportSentAction(id); if (r.error) toast.error(r.error); else { toast.success("Marked sent."); router.refresh(); } });
  }
  function remove(id: string) {
    if (!confirm("Delete this status report?")) return;
    start(async () => { const r = await deleteStatusReportAction(id); if (r.error) toast.error(r.error); else { toast.success("Deleted."); router.refresh(); } });
  }

  const setAction = (i: number, patch: Partial<DraftAction>) => setDraft((d) => (d ? { ...d, actions: d.actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)) } : d));
  const addAction = () => setDraft((d) => (d ? { ...d, actions: [...d.actions, { description: "", owner: "", ownerUserId: null, dueDate: "", critical: false }] } : d));
  const removeAction = (i: number) => setDraft((d) => (d ? { ...d, actions: d.actions.filter((_, idx) => idx !== i) } : d));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search status updates…" className="w-64 pl-8" />
        </div>
        <Button size="sm" onClick={() => openDraft(seededDraft(reports[0], planProgress))} title={reports[0] ? "Starts from the latest update: cadence, health, progress and open actions carried over" : undefined}><PlusIcon className="size-3.5" /> New status update</Button>
      </div>

      {reports.length === 0 && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No status updates yet — click <span className="font-medium text-foreground">New status update</span> to build the first customer-ready report.</CardContent></Card>
      )}
      {reports.length > 0 && shown.length === 0 && <Card><CardContent className="py-8 text-center text-muted-foreground">No updates match “{q}”.</CardContent></Card>}

      {shown.map((r) => {
        const isOpen = open.has(r.id);
        return (
        <Card key={r.id} className="overflow-hidden p-0 gap-0">
          {/* header band (click to expand) */}
          <div className={cn("flex flex-wrap items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-muted/40", isOpen && "border-b bg-muted/25")} onClick={() => toggle(r.id)}>
            <ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
            <DeckRing pct={r.progressPercent ?? 0} rag={r.overallRag} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", RAG_PILL[r.overallRag])}><span className={cn("size-2 rounded-full", RAG_DOT[r.overallRag])} /> {SEVERITY_LABEL[r.overallRag]}</span>
                <span className="inline-flex items-center gap-1" title="Schedule · Budget · Scope">
                  {RAG_DIMENSIONS.map((d) => (
                    <span key={d} className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium", RAG_PILL[r[d]])}><span className={cn("size-1.5 rounded-full", RAG_DOT[r[d]])} />{RAG_DIMENSION_LABEL[d]}</span>
                  ))}
                </span>
                {r.id === reports[0]?.id && <Badge variant="secondary" className="text-[10px]">Latest</Badge>}
                {r.sentAt ? <Badge variant="outline" className="gap-1 text-[10px]"><SendIcon className="size-2.5" /> Sent {r.sentAt}</Badge> : <Badge variant="secondary" className="text-[10px]">Draft — not sent</Badge>}
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">
                {r.reportDate}{r.cadence ? ` · ${CADENCE_LABEL[r.cadence] ?? r.cadence}` : ""}
                {r.periodStart && r.periodEnd ? ` · period ${r.periodStart} – ${r.periodEnd}` : ""} · by {r.authorName}
              </div>
              {r.documents.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
                  {r.documents.map((d) => (
                    <a key={d.id} href={`/api/documents/${d.fileName}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      <PaperclipIcon className="size-3" /> {d.originalName}
                    </a>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
              <a href={`/api/status-reports/${r.id}/pptx`}><Button size="sm" variant="outline"><PresentationIcon className="size-3.5" /> PPT</Button></a>
              <a href={`/api/status-reports/${r.id}/export`}><Button size="sm" variant="outline"><DownloadIcon className="size-3.5" /> Excel</Button></a>
              {!r.sentAt && <Button size="sm" variant="outline" onClick={() => markSent(r.id)} disabled={pending} title="Mark as sent to customer"><SendIcon className="size-3.5" /></Button>}
              <Button size="sm" variant="outline" onClick={() => edit(r)} title="Edit"><PencilIcon className="size-3.5" /></Button>
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => remove(r.id)} disabled={pending} title="Delete"><Trash2Icon className="size-3.5" /></Button>
            </div>
          </div>

          {/* body — three deck columns */}
          {isOpen && (
          <div className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
            <section className="flex flex-col gap-2 p-5">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Current status</h4>
              {r.summary ? <p className="text-sm leading-relaxed whitespace-pre-wrap">{r.summary}</p> : <p className="text-sm text-muted-foreground/60">—</p>}
              {r.accomplishments && (
                <div className="flex flex-col gap-2 border-t pt-3">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Accomplishments</h4>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{r.accomplishments}</p>
                </div>
              )}
            </section>

            <section className="flex flex-col gap-2 p-5">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Next actions</h4>
              {r.actions.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {r.actions.map((a, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-[3px] border", a.critical ? "border-rose-400 bg-rose-500/10" : "border-muted-foreground/30")} />
                      <span className="min-w-0">
                        <span className="leading-snug">{a.description}</span>
                        {a.critical && <span className="ml-1.5 rounded-full bg-rose-500/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">Critical</span>}
                        {(a.owner || a.dueDate) && <span className="mt-0.5 block text-xs text-muted-foreground">{a.owner}{a.owner && a.dueDate ? " · " : ""}{a.dueDate ? `due ${a.dueDate}` : ""}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground/60">—</p>}
            </section>

            <section className="flex flex-col gap-3 p-5">
              <div className="flex flex-col gap-2">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Corrective actions</h4>
                {r.correctiveActions ? <p className="text-sm leading-relaxed whitespace-pre-wrap">{r.correctiveActions}</p> : <p className="text-sm text-muted-foreground/60">—</p>}
              </div>
              {r.decisionsNeeded && (
                <div className="flex flex-col gap-2 border-t pt-3">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Decisions needed</h4>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{r.decisionsNeeded}</p>
                </div>
              )}
              {r.milestoneNotes && (
                <div className="flex flex-col gap-2 border-t pt-3">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Plan / milestones</h4>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{r.milestoneNotes}</p>
                </div>
              )}
            </section>
          </div>
          )}
        </Card>
        );
      })}

      {draft && (
        <Dialog open disablePointerDismissal onOpenChange={(v) => !v && setDraft(null)}>
          <DialogContent className="sm:max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
            <DialogHeader><DialogTitle>{draft.id ? "Edit status update" : "New status update"}</DialogTitle></DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="flex flex-col gap-1.5"><Label>Report date</Label><Input type="date" value={draft.reportDate} onChange={(e) => setCadenceOrDate({ reportDate: e.target.value })} /></div>
                <div className="flex flex-col gap-1.5"><Label>Cadence</Label>
                  <Select value={draft.cadence} items={[{ value: "WEEKLY", label: "Weekly" }, { value: "MONTHLY", label: "Monthly" }, { value: "ADHOC", label: "Ad-hoc" }]} onValueChange={(v) => setCadenceOrDate({ cadence: v ?? "WEEKLY" })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="WEEKLY">Weekly</SelectItem><SelectItem value="MONTHLY">Monthly</SelectItem><SelectItem value="ADHOC">Ad-hoc</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5"><Label>Period from</Label><Input type="date" value={draft.periodStart} onChange={(e) => { setPeriodTouched(true); setDraft({ ...draft, periodStart: e.target.value }); }} /></div>
                <div className="flex flex-col gap-1.5"><Label>Period to</Label><Input type="date" value={draft.periodEnd} onChange={(e) => { setPeriodTouched(true); setDraft({ ...draft, periodEnd: e.target.value }); }} /></div>
              </div>

              {/* read-only: what the timesheets say about this period */}
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide text-muted-foreground"><ClockIcon className="size-3" /> This period</span>
                  {!draft.periodStart || !draft.periodEnd ? <span className="text-muted-foreground">Set a period to see approved hours.</span>
                    : period.loading || period.key !== periodKey ? <span className="text-muted-foreground">Loading approved hours…</span>
                    : !period.data ? <span className="text-muted-foreground">Could not load hours.</span>
                    : (
                      <>
                        <span><span className="font-mono font-semibold text-foreground">{period.data.periodHours}h</span> approved</span>
                        {period.data.byPerson.length > 0 && <span className="text-muted-foreground">({period.data.byPerson.map((p) => `${p.name} ${p.hours}h`).join(", ")})</span>}
                        <span className="ml-auto text-muted-foreground">cumulative <span className="font-mono text-foreground">{period.data.cumulativeHours}h</span>{period.data.budgetHours != null ? <> of <span className="font-mono">{period.data.budgetHours}h</span> budget ({period.data.budgetHours > 0 ? Math.round((period.data.cumulativeHours / period.data.budgetHours) * 100) : 0}%)</> : " · no budget hours set"}</span>
                      </>
                    )}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">Approved time on this project (time is logged per project, not per end customer). The same figure goes into the PPT and Excel exports.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3">
                <div className="flex flex-col gap-1.5"><Label>Severity / timing</Label>
                  <Select value={draft.overallRag} items={RAGS.map((r) => ({ value: r, label: SEVERITY_LABEL[r] }))} onValueChange={(v) => setDraft({ ...draft, overallRag: (v as RagStatus) ?? "GREEN" })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{RAGS.map((r) => <SelectItem key={r} value={r}><span className="inline-flex items-center gap-2"><span className={cn("size-2 rounded-full", RAG_DOT[r])} />{SEVERITY_LABEL[r]}</span></SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5"><Label>Progress %</Label><Input type="number" min="0" max="100" value={draft.progressPercent} onChange={(e) => setDraft({ ...draft, progressPercent: e.target.value })} placeholder={planProgress != null ? `plan says ${planProgress}` : "e.g. 90"} />
                  {!planWarn && planProgress != null && draft.progressPercent === String(planProgress) && <p className="text-[11px] text-muted-foreground">Suggested from the plan — {PROGRESS_BASIS_LABEL[planBasis ?? "duration"]}.</p>}
                  {planWarn && <p className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400"><TriangleAlertIcon className="size-3" /> The plan says {planProgress}% — is the report right?</p>}
                </div>
                <div className="col-span-2 grid grid-cols-3 gap-3 border-t pt-3">
                  {RAG_DIMENSIONS.map((d) => (
                    <div key={d} className="flex flex-col gap-1.5">
                      <Label className="text-xs">{RAG_DIMENSION_LABEL[d]}</Label>
                      <Select
                        value={draft[d] || "FOLLOW"}
                        items={[{ value: "FOLLOW", label: `Same as overall (${RAG_LABEL[draft.overallRag]})` }, ...RAGS.map((r) => ({ value: r, label: RAG_LABEL[r] }))]}
                        onValueChange={(v) => setDraft({ ...draft, [d]: !v || v === "FOLLOW" ? "" : (v as RagStatus) })}
                      >
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="FOLLOW">Same as overall</SelectItem>
                          {RAGS.map((r) => <SelectItem key={r} value={r}><span className="inline-flex items-center gap-2"><span className={cn("size-2 rounded-full", RAG_DOT[r])} />{RAG_LABEL[r]}</span></SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5"><Label>Current status</Label><Textarea value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} rows={4} maxLength={4000} placeholder="Where things stand this period…" /></div>
              <div className="flex flex-col gap-1.5"><Label>Accomplishments (optional)</Label><Textarea value={draft.accomplishments} onChange={(e) => setDraft({ ...draft, accomplishments: e.target.value })} rows={2} maxLength={4000} placeholder="What got done this period" /></div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between"><Label>Next actions</Label><Button type="button" size="sm" variant="outline" onClick={addAction}><PlusIcon className="size-3.5" /> Add</Button></div>
                {draft.actions.map((a, i) => (
                  <div key={i} className={cn("grid grid-cols-[1fr_120px_130px_auto_auto] gap-2 items-center", a.carried && "rounded-md border border-dashed border-sky-300 bg-sky-500/[0.05] p-1")}>
                    <div className="flex items-center gap-1.5">
                      {a.carried && <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-400" title="Carried over from the previous update"><RotateCcwIcon className="size-3" /> carried</span>}
                      {a.done && <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400" title="Already completed — it stays completed when you save">✓ done</span>}
                      <Input placeholder="Action" value={a.description} onChange={(e) => setAction(i, { description: e.target.value })} />
                    </div>
                    <OwnerCombobox value={{ owner: a.owner, ownerUserId: a.ownerUserId }} people={people} onChange={(v) => setAction(i, v)} placeholder="Owner" />
                    <Input type="date" value={a.dueDate} onChange={(e) => setAction(i, { dueDate: e.target.value })} />
                    <label className="flex items-center gap-1 text-xs whitespace-nowrap"><input type="checkbox" className="size-3.5" checked={a.critical} onChange={(e) => setAction(i, { critical: e.target.checked })} /> Critical</label>
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeAction(i)}><XIcon className="size-3.5" /></Button>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-1.5"><Label>Corrective actions</Label><Textarea value={draft.correctiveActions} onChange={(e) => setDraft({ ...draft, correctiveActions: e.target.value })} rows={2} maxLength={4000} placeholder="Nothing to report" /></div>
              <div className="flex flex-col gap-1.5"><Label>Decisions needed from the customer (optional)</Label><Textarea value={draft.decisionsNeeded} onChange={(e) => setDraft({ ...draft, decisionsNeeded: e.target.value })} rows={2} maxLength={4000} placeholder="What you need them to decide, and by when" /></div>
              <div className="flex flex-col gap-1.5"><Label>Plan / milestone notes (optional)</Label><Textarea value={draft.milestoneNotes} onChange={(e) => setDraft({ ...draft, milestoneNotes: e.target.value })} rows={2} maxLength={4000} /></div>
            </div>
            <DialogFooter><Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : draft.id ? "Save" : "Create"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
