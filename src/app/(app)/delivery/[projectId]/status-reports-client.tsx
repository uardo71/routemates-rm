"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, PencilIcon, Trash2Icon, DownloadIcon, SendIcon, XIcon, PresentationIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SEVERITY_LABEL, RAG_PILL, RAG_DOT, CADENCE_LABEL } from "@/lib/delivery";
import type { RagStatus } from "@prisma/client";
import { createStatusReportAction, updateStatusReportAction, deleteStatusReportAction, markStatusReportSentAction } from "../actions";

export type ReportAction = { description: string; owner: string | null; dueDate: string | null; critical: boolean };
export type ReportRow = {
  id: string;
  reportDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  cadence: string | null;
  overallRag: RagStatus; // Severity/Timing
  progressPercent: number | null;
  summary: string | null; // current status
  correctiveActions: string | null;
  milestoneNotes: string | null;
  actions: ReportAction[];
  sentAt: string | null;
  authorName: string;
};

const RAGS: RagStatus[] = ["GREEN", "AMBER", "RED"];
const todayIso = () => new Date().toISOString().slice(0, 10);

type DraftAction = { description: string; owner: string; dueDate: string; critical: boolean };
type Draft = {
  id?: string;
  reportDate: string; cadence: string; periodStart: string; periodEnd: string;
  overallRag: RagStatus; progressPercent: string;
  summary: string; correctiveActions: string; milestoneNotes: string;
  actions: DraftAction[];
};
const emptyDraft = (): Draft => ({
  reportDate: todayIso(), cadence: "WEEKLY", periodStart: "", periodEnd: "",
  overallRag: "GREEN", progressPercent: "", summary: "", correctiveActions: "", milestoneNotes: "",
  actions: [{ description: "", owner: "", dueDate: "", critical: false }],
});

export function StatusReportsClient({ projectId, engagementId, reports }: { projectId: string; engagementId: string | null; reports: ReportRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);

  function save() {
    if (!draft) return;
    const actions = draft.actions.filter((a) => a.description.trim()).map((a) => ({ description: a.description.trim(), owner: a.owner || null, dueDate: a.dueDate || null, critical: a.critical }));
    const payload = {
      projectId, engagementId, reportDate: draft.reportDate, cadence: draft.cadence as "WEEKLY" | "MONTHLY" | "ADHOC",
      periodStart: draft.periodStart || null, periodEnd: draft.periodEnd || null,
      overallRag: draft.overallRag, scheduleRag: draft.overallRag, budgetRag: draft.overallRag, scopeRag: draft.overallRag,
      progressPercent: draft.progressPercent === "" ? null : Number(draft.progressPercent),
      summary: draft.summary || null, correctiveActions: draft.correctiveActions || null, milestoneNotes: draft.milestoneNotes || null,
      actions,
    };
    start(async () => {
      const r = draft.id ? await updateStatusReportAction({ id: draft.id, ...payload }) : await createStatusReportAction(payload);
      if (r.error) toast.error(r.error);
      else { toast.success("Saved."); setDraft(null); router.refresh(); }
    });
  }
  function edit(r: ReportRow) {
    setDraft({
      id: r.id, reportDate: r.reportDate, cadence: r.cadence ?? "WEEKLY", periodStart: r.periodStart ?? "", periodEnd: r.periodEnd ?? "",
      overallRag: r.overallRag, progressPercent: r.progressPercent != null ? String(r.progressPercent) : "",
      summary: r.summary ?? "", correctiveActions: r.correctiveActions ?? "", milestoneNotes: r.milestoneNotes ?? "",
      actions: r.actions.length ? r.actions.map((a) => ({ description: a.description, owner: a.owner ?? "", dueDate: a.dueDate ?? "", critical: a.critical })) : [{ description: "", owner: "", dueDate: "", critical: false }],
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
  const addAction = () => setDraft((d) => (d ? { ...d, actions: [...d.actions, { description: "", owner: "", dueDate: "", critical: false }] } : d));
  const removeAction = (i: number) => setDraft((d) => (d ? { ...d, actions: d.actions.filter((_, idx) => idx !== i) } : d));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Build the status update, keep the history, and export a customer-ready PowerPoint (or Excel).</p>
        <Button size="sm" onClick={() => setDraft(emptyDraft())}><PlusIcon className="size-3.5" /> New status update</Button>
      </div>

      {reports.length === 0 && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No status updates yet — click <span className="font-medium">New status update</span>.</CardContent></Card>
      )}

      {reports.map((r) => (
        <Card key={r.id}>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", RAG_PILL[r.overallRag])}><span className={cn("size-2 rounded-full", RAG_DOT[r.overallRag])} /> {SEVERITY_LABEL[r.overallRag]}</span>
                {r.progressPercent != null && <span className="text-sm font-normal">Progress {r.progressPercent}%</span>}
                <span className="text-sm font-normal text-muted-foreground">· {r.reportDate}{r.cadence ? ` · ${CADENCE_LABEL[r.cadence] ?? r.cadence}` : ""}</span>
                {r.sentAt ? <Badge variant="outline" className="text-[10px]">Sent {r.sentAt}</Badge> : <Badge variant="secondary" className="text-[10px]">Draft</Badge>}
              </CardTitle>
              {r.progressPercent != null && (
                <div className="h-1.5 w-40 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary" style={{ width: `${r.progressPercent}%` }} /></div>
              )}
              <div className="text-xs text-muted-foreground">{r.periodStart && r.periodEnd ? `Period ${r.periodStart} – ${r.periodEnd} · ` : ""}by {r.authorName}</div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <a href={`/api/status-reports/${r.id}/pptx`}><Button size="sm" variant="outline"><PresentationIcon className="size-3.5" /> PPT</Button></a>
              <a href={`/api/status-reports/${r.id}/export`}><Button size="sm" variant="outline"><DownloadIcon className="size-3.5" /> Excel</Button></a>
              {!r.sentAt && <Button size="sm" variant="outline" onClick={() => markSent(r.id)} disabled={pending}><SendIcon className="size-3.5" /></Button>}
              <Button size="sm" variant="outline" onClick={() => edit(r)}><PencilIcon className="size-3.5" /></Button>
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => remove(r.id)} disabled={pending}><Trash2Icon className="size-3.5" /></Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {r.summary && <div><span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current status</span><p className="whitespace-pre-wrap">{r.summary}</p></div>}
            {r.actions.length > 0 && (
              <div>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Next actions</span>
                <ul className="mt-1 flex flex-col gap-1">
                  {r.actions.map((a, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1.5 size-1.5 rounded-full bg-muted-foreground shrink-0" />
                      <span>{a.description}{a.owner ? ` — ${a.owner}` : ""}{a.dueDate ? ` (by ${a.dueDate})` : ""} {a.critical && <Badge variant="destructive" className="ml-1 text-[10px]">Critical</Badge>}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.correctiveActions && <div><span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Corrective actions</span><p className="whitespace-pre-wrap">{r.correctiveActions}</p></div>}
            {r.milestoneNotes && <div><span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plan / milestones</span><p className="whitespace-pre-wrap">{r.milestoneNotes}</p></div>}
          </CardContent>
        </Card>
      ))}

      {draft && (
        <Dialog open onOpenChange={(v) => !v && setDraft(null)}>
          <DialogContent className="sm:max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
            <DialogHeader><DialogTitle>{draft.id ? "Edit status update" : "New status update"}</DialogTitle></DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="flex flex-col gap-1.5"><Label>Report date</Label><Input type="date" value={draft.reportDate} onChange={(e) => setDraft({ ...draft, reportDate: e.target.value })} /></div>
                <div className="flex flex-col gap-1.5"><Label>Cadence</Label>
                  <Select value={draft.cadence} items={[{ value: "WEEKLY", label: "Weekly" }, { value: "MONTHLY", label: "Monthly" }, { value: "ADHOC", label: "Ad-hoc" }]} onValueChange={(v) => setDraft({ ...draft, cadence: v ?? "WEEKLY" })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="WEEKLY">Weekly</SelectItem><SelectItem value="MONTHLY">Monthly</SelectItem><SelectItem value="ADHOC">Ad-hoc</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5"><Label>Period from</Label><Input type="date" value={draft.periodStart} onChange={(e) => setDraft({ ...draft, periodStart: e.target.value })} /></div>
                <div className="flex flex-col gap-1.5"><Label>Period to</Label><Input type="date" value={draft.periodEnd} onChange={(e) => setDraft({ ...draft, periodEnd: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3">
                <div className="flex flex-col gap-1.5"><Label>Severity / timing</Label>
                  <Select value={draft.overallRag} items={RAGS.map((r) => ({ value: r, label: SEVERITY_LABEL[r] }))} onValueChange={(v) => setDraft({ ...draft, overallRag: (v as RagStatus) ?? "GREEN" })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{RAGS.map((r) => <SelectItem key={r} value={r}><span className="inline-flex items-center gap-2"><span className={cn("size-2 rounded-full", RAG_DOT[r])} />{SEVERITY_LABEL[r]}</span></SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5"><Label>Progress %</Label><Input type="number" min="0" max="100" value={draft.progressPercent} onChange={(e) => setDraft({ ...draft, progressPercent: e.target.value })} placeholder="e.g. 90" /></div>
              </div>
              <div className="flex flex-col gap-1.5"><Label>Current status</Label><Textarea value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} rows={4} maxLength={4000} placeholder="What's done, what happened this period…" /></div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between"><Label>Next actions</Label><Button type="button" size="sm" variant="outline" onClick={addAction}><PlusIcon className="size-3.5" /> Add</Button></div>
                {draft.actions.map((a, i) => (
                  <div key={i} className="grid grid-cols-[1fr_120px_130px_auto_auto] gap-2 items-center">
                    <Input placeholder="Action" value={a.description} onChange={(e) => setAction(i, { description: e.target.value })} />
                    <Input placeholder="Owner" value={a.owner} onChange={(e) => setAction(i, { owner: e.target.value })} />
                    <Input type="date" value={a.dueDate} onChange={(e) => setAction(i, { dueDate: e.target.value })} />
                    <label className="flex items-center gap-1 text-xs whitespace-nowrap"><input type="checkbox" className="size-3.5" checked={a.critical} onChange={(e) => setAction(i, { critical: e.target.checked })} /> Critical</label>
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeAction(i)}><XIcon className="size-3.5" /></Button>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-1.5"><Label>Corrective actions</Label><Textarea value={draft.correctiveActions} onChange={(e) => setDraft({ ...draft, correctiveActions: e.target.value })} rows={2} maxLength={4000} placeholder="Nothing to report" /></div>
              <div className="flex flex-col gap-1.5"><Label>Plan / milestone notes (optional)</Label><Textarea value={draft.milestoneNotes} onChange={(e) => setDraft({ ...draft, milestoneNotes: e.target.value })} rows={2} maxLength={4000} /></div>
            </div>
            <DialogFooter><Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : draft.id ? "Save" : "Create"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
