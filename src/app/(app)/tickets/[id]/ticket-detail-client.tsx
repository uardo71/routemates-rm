"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PencilIcon, Trash2Icon, ClockIcon, SaveIcon, RotateCcwIcon, MessageSquareIcon, HistoryIcon, TimerIcon,
  TagIcon, Building2Icon, FolderIcon, ServerIcon, BoxIcon, HashIcon, CalendarIcon, UserIcon, CheckCircle2Icon, AlertTriangleIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  TICKET_PRIORITIES, TICKET_PRIORITY_LABEL, TICKET_PRIORITY_TONE, TICKET_ACTIVITY_LABEL,
} from "@/lib/ticket";
import { labelFromTimestamps } from "@/lib/sla";
import type { TicketPriority, TicketStatusCategory } from "@prisma/client";
import { slaState } from "../sla";
import { TypeChip, StatusChip } from "../ticket-visuals";
import { FieldControl, type PubField } from "../field-control";
import { Conversation } from "../conversation";
import type { CommentNode } from "../conversation";
import { applyWorkflowAction, updateTicketDetailsAction, updateTicketDescriptionAction, addCommentAction, deleteTicketAttachmentAction, editCommentAction, deleteCommentAction, addWorklogAction, deleteWorklogAction } from "../actions";

type Opt = { id: string; name: string };
type Worklog = { id: string; userName: string; minutes: number; workedOn: string; note: string; mine: boolean };
type FieldVal = PubField & { value: unknown; display: string };
type HistoryEvent = { id: string; kind: string; body: string; authorName: string; createdAt: string };
export type DetailConfig = {
  statuses: { id: string; name: string; color: string | null; category: TicketStatusCategory }[];
  types: { id: string; name: string; icon: string | null }[];
  fields: PubField[];
};
type Detail = {
  id: string; number: string; title: string; description: string;
  typeId: string; typeName: string; typeColor: string | null; typeIcon: string | null;
  priority: TicketPriority;
  statusId: string; statusName: string; statusColor: string | null; statusCategory: TicketStatusCategory;
  requesterName: string; assigneeId: string | null; assigneeName: string | null;
  clientId: string | null; clientName: string | null; projectId: string | null; projectName: string | null;
  category: string; systemRef: string; moduleRef: string; dueDate: string; resolution: string;
  respondBy: string; resolveBy: string; firstResponseAt: string; resolvedAt: string; closedAt: string; createdAt: string;
  worklogs: Worklog[]; fields: FieldVal[];
};

const selectCls = "h-8 w-full rounded-md border bg-transparent px-2 text-sm outline-none focus:border-primary/50";
const fmtDT = (s: string) => (s ? s.slice(0, 16).replace("T", " ") : "—");
const fmtMin = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;

export function TicketDetailClient({ t, config, canManage, users, clients, projects, conversation, history }: {
  t: Detail; config: DetailConfig; canManage: boolean; users: Opt[]; clients: Opt[]; projects: Opt[];
  conversation: CommentNode[]; history: HistoryEvent[];
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState<"conversation" | "history" | "worklog">("conversation");
  const [editing, setEditing] = React.useState(false);
  const shownFields = t.fields.filter((f) => f.display);

  const post = React.useCallback((fd: FormData) => addCommentAction(t.id, fd), [t.id]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <Link href="/tickets" className="text-sm text-muted-foreground hover:underline">← Tickets</Link>

      {/* Header */}
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="h-1.5 bg-gradient-to-r from-primary/40 via-primary/10 to-transparent" />
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="font-mono">{t.number}</span>
              <TypeChip name={t.typeName} color={t.typeColor} icon={t.typeIcon} />
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", TICKET_PRIORITY_TONE[t.priority])}>{TICKET_PRIORITY_LABEL[t.priority]}</span>
              <LiveSla t={t} />
            </div>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">{t.title}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t.clientName ? `${t.clientName} · ` : ""}{t.projectName ? `${t.projectName} · ` : ""}raised by {t.requesterName} · {fmtDT(t.createdAt)}
            </p>
          </div>
          <StatusChip name={t.statusName} color={t.statusColor} className="px-3 py-1 text-sm" />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        {/* Main */}
        <div className="flex flex-col gap-5">
          <DescriptionCard t={t} canManage={canManage} onSaved={() => router.refresh()} />

          {shownFields.length > 0 && (
            <Card title="Fields">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                {shownFields.map((f) => (
                  <div key={f.id} className="flex flex-col">
                    <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">{f.name}</dt>
                    <dd className="mt-0.5">{f.display}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          <div className="rounded-xl border bg-card">
            <div className="flex items-center gap-1 border-b p-1.5">
              <Tab active={tab === "conversation"} onClick={() => setTab("conversation")} icon={<MessageSquareIcon className="size-4" />} label="Conversation" count={countComments(conversation)} />
              <Tab active={tab === "history"} onClick={() => setTab("history")} icon={<HistoryIcon className="size-4" />} label="History" count={history.length} />
              <Tab active={tab === "worklog"} onClick={() => setTab("worklog")} icon={<TimerIcon className="size-4" />} label="Worklog" />
            </div>
            <div className="p-4">
              {tab === "conversation" && (
                <Conversation comments={conversation} canInternal={canManage} postAction={post} deleteAttachmentAction={deleteTicketAttachmentAction} editAction={editCommentAction} deleteCommentAction={deleteCommentAction} />
              )}
              {tab === "history" && <History events={history} />}
              {tab === "worklog" && <WorklogPanel t={t} onChanged={() => router.refresh()} />}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-4">
          <Properties key={`${t.statusId}:${t.assigneeId ?? ""}:${t.priority}`} t={t} config={config} canManage={canManage} users={users} onSaved={() => router.refresh()} />

          <Card title="Details" action={canManage ? <button onClick={() => setEditing(true)} className="text-muted-foreground hover:text-primary"><PencilIcon className="size-3.5" /></button> : undefined}>
            <dl className="flex flex-col">
              <DetailRow icon={<TagIcon className="size-3.5" />} k="Type" v={t.typeName} />
              <DetailRow icon={<Building2Icon className="size-3.5" />} k="Client" v={t.clientName} />
              <DetailRow icon={<FolderIcon className="size-3.5" />} k="Project" v={t.projectName} />
              <DetailRow icon={<ServerIcon className="size-3.5" />} k="System / CI" v={t.systemRef} />
              <DetailRow icon={<BoxIcon className="size-3.5" />} k="Module" v={t.moduleRef} />
              <DetailRow icon={<HashIcon className="size-3.5" />} k="Category" v={t.category} />
              <DetailRow icon={<CalendarIcon className="size-3.5" />} k="Due date" v={t.dueDate} />
              <DetailRow icon={<UserIcon className="size-3.5" />} k="Requester" v={t.requesterName} />
            </dl>
          </Card>

          <SlaPanel t={t} />
        </div>
      </div>

      {editing && <EditDialog t={t} config={config} users={users} clients={clients} projects={projects} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); router.refresh(); }} />}
    </div>
  );
}

function countComments(nodes: CommentNode[]): number {
  return nodes.reduce((n, c) => n + 1 + countComments(c.replies), 0);
}

function DescriptionCard({ t, canManage, onSaved }: { t: Detail; canManage: boolean; onSaved: () => void }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(t.description);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  async function save() {
    setSaving(true); setErr(null);
    const r = await updateTicketDescriptionAction(t.id, draft);
    setSaving(false);
    if (r.error) setErr(r.error); else { setEditing(false); onSaved(); }
  }
  return (
    <Card title="Description" action={canManage && !editing ? <button onClick={() => { setDraft(t.description); setEditing(true); }} className="text-muted-foreground hover:text-primary"><PencilIcon className="size-3.5" /></button> : undefined}>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} autoFocus placeholder="Describe the issue or request…" />
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            <Button size="sm" variant="outline" onClick={() => { setEditing(false); setErr(null); }}>Cancel</Button>
          </div>
        </div>
      ) : t.description ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{t.description}</p>
      ) : (
        <p className="text-sm text-muted-foreground">{canManage ? "No description — click the pencil to add one." : "No description."}</p>
      )}
      {t.resolution && (
        <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] p-3">
          <div className="text-[0.625rem] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Resolution</div>
          <p className="mt-0.5 whitespace-pre-wrap text-sm">{t.resolution}</p>
        </div>
      )}
    </Card>
  );
}

function Tab({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button onClick={onClick} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors", active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/50")}>
      {icon} {label}{count !== undefined && count > 0 && <span className="rounded-full bg-foreground/10 px-1.5 text-xs tabular-nums">{count}</span>}
    </button>
  );
}

function Properties({ t, config, canManage, users, onSaved }: { t: Detail; config: DetailConfig; canManage: boolean; users: Opt[]; onSaved: () => void }) {
  const [statusId, setStatusId] = React.useState(t.statusId);
  const [assigneeId, setAssigneeId] = React.useState<string>(t.assigneeId ?? "");
  const [priority, setPriority] = React.useState<TicketPriority>(t.priority);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const dirty = statusId !== t.statusId || (assigneeId || "") !== (t.assigneeId ?? "") || priority !== t.priority;

  function reset() { setStatusId(t.statusId); setAssigneeId(t.assigneeId ?? ""); setPriority(t.priority); setErr(null); }
  async function save() {
    setSaving(true); setErr(null);
    const r = await applyWorkflowAction(t.id, { statusId, assigneeId: canManage ? (assigneeId || null) : undefined, priority: canManage ? priority : undefined });
    setSaving(false);
    if (r.error) setErr(r.error); else onSaved();
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <h2 className="mb-2.5 text-sm font-semibold">Properties</h2>
      <div className="flex flex-col gap-2.5">
        <Field label="Status"><select value={statusId} onChange={(e) => setStatusId(e.target.value)} className={selectCls}>{config.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Assignee">{canManage ? <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={selectCls}><option value="">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select> : <span className="text-sm">{t.assigneeName ?? "Unassigned"}</span>}</Field>
        <Field label="Priority">{canManage ? <select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)} className={selectCls}>{TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABEL[p]}</option>)}</select> : <span className="text-sm">{TICKET_PRIORITY_LABEL[t.priority]}</span>}</Field>
      </div>
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
      {dirty && (
        <div className="mt-3 flex items-center gap-2 border-t pt-3">
          <Button size="sm" onClick={save} disabled={saving} className="gap-1.5"><SaveIcon className="size-4" /> {saving ? "Saving…" : "Save changes"}</Button>
          <Button size="sm" variant="outline" onClick={reset} disabled={saving} className="gap-1.5"><RotateCcwIcon className="size-3.5" /> Discard</Button>
        </div>
      )}
    </div>
  );
}

function History({ events }: { events: HistoryEvent[] }) {
  if (events.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No history yet.</p>;
  return (
    <div className="flex flex-col gap-3">
      {events.map((e) => (
        <div key={e.id} className="flex gap-2.5 text-sm">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{e.authorName}</span> {TICKET_ACTIVITY_LABEL[e.kind as keyof typeof TICKET_ACTIVITY_LABEL] ?? "updated the ticket"}{e.body ? `: ${e.body}` : ""} · {fmtDT(e.createdAt)}
          </div>
        </div>
      ))}
    </div>
  );
}

function WorklogPanel({ t, onChanged }: { t: Detail; onChanged: () => void }) {
  const [pending, start] = React.useTransition();
  const [hours, setHours] = React.useState("");
  const [date, setDate] = React.useState("");
  const [note, setNote] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const total = t.worklogs.reduce((s, w) => s + w.minutes, 0);
  const act = (fn: () => Promise<{ error?: string }>) => start(async () => { const r = await fn(); if (r?.error) setErr(r.error); else { setErr(null); onChanged(); } });

  return (
    <div className="flex flex-col gap-3">
      {total > 0 && <div className="text-sm text-muted-foreground">Total logged: <span className="font-medium text-foreground">{fmtMin(total)}</span></div>}
      {t.worklogs.length > 0 && (
        <div className="flex flex-col divide-y">
          {t.worklogs.map((w) => (
            <div key={w.id} className="flex items-center gap-3 py-1.5 text-sm">
              <ClockIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="w-16 shrink-0 font-mono tabular-nums">{fmtMin(w.minutes)}</span>
              <div className="min-w-0 flex-1"><span className="text-muted-foreground">{w.userName}{w.workedOn ? ` · ${w.workedOn}` : ""}</span>{w.note && <span> — {w.note}</span>}</div>
              {w.mine && <button onClick={() => act(() => deleteWorklogAction(w.id))} className="text-muted-foreground/40 hover:text-destructive"><Trash2Icon className="size-3.5" /></button>}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1"><Label className="text-xs" htmlFor="wlh">Hours</Label><Input id="wlh" value={hours} onChange={(e) => setHours(e.target.value)} type="number" min="0" step="0.25" placeholder="1.5" className="h-8 w-24" /></div>
        <div className="flex flex-col gap-1"><Label className="text-xs" htmlFor="wld">Date</Label><Input id="wld" value={date} onChange={(e) => setDate(e.target.value)} type="date" className="h-8 w-36" /></div>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you did (optional)" className="h-8 min-w-40 flex-1" />
        <Button size="sm" variant="outline" disabled={pending || !hours} onClick={() => act(async () => { const m = Math.round(parseFloat(hours) * 60); const r = await addWorklogAction(t.id, m, date || null, note); if (!r.error) { setHours(""); setNote(""); setDate(""); } return r; })}>Log time</Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}

function LiveSla({ t }: { t: Detail }) {
  const [, tick] = React.useState(0);
  React.useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(id); }, []);
  const s = slaState(t);
  if (!s.show) return null;
  return <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs", s.tone)}>{s.label}</span>;
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2.5 flex items-center justify-between"><h2 className="text-sm font-semibold">{title}</h2>{action}</div>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><span className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>{children}</div>;
}
function DetailRow({ icon, k, v }: { icon: React.ReactNode; k: string; v: string | null }) {
  return (
    <div className="flex items-center gap-2 border-b border-border/40 py-1.5 text-sm last:border-none">
      <span className="text-muted-foreground/60">{icon}</span>
      <span className="text-muted-foreground">{k}</span>
      <span className={cn("ml-auto min-w-0 truncate text-right", v ? "font-medium" : "text-muted-foreground/40")}>{v || "—"}</span>
    </div>
  );
}

// ---------- SLA panel (visual respond/resolve tracks with a live countdown) ----------

function SlaPanel({ t }: { t: Detail }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  const target = labelFromTimestamps(t.createdAt, t.respondBy, t.resolveBy);
  const closed = t.statusCategory === "DONE" || t.statusCategory === "CANCELLED";
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">SLA</h2>
        {target && <span className="font-mono text-xs text-muted-foreground">{target}</span>}
      </div>
      <div className="flex flex-col gap-3">
        <SlaTrack label="Respond" start={t.createdAt} target={t.respondBy} doneAt={t.firstResponseAt} now={now} stopped={closed && !t.firstResponseAt} />
        <SlaTrack label="Resolve" start={t.createdAt} target={t.resolveBy} doneAt={t.resolvedAt} now={now} stopped={closed && !t.resolvedAt} />
      </div>
    </div>
  );
}

function SlaTrack({ label, start, target, doneAt, now, stopped }: { label: string; start: string; target: string; doneAt: string; now: number; stopped: boolean }) {
  if (!target) return null;
  const s = new Date(start).getTime();
  const tg = new Date(target).getTime();
  const done = doneAt ? new Date(doneAt).getTime() : null;

  let barColor = "bg-emerald-500", frac = 0, state: React.ReactNode;
  if (done !== null) {
    const late = done > tg;
    frac = 1; barColor = late ? "bg-rose-500" : "bg-emerald-500";
    state = <span className={cn("inline-flex items-center gap-1", late ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}><CheckCircle2Icon className="size-3.5" /> {late ? "met late" : "met"}</span>;
  } else if (stopped) {
    frac = 0; barColor = "bg-muted-foreground/40"; state = <span className="text-muted-foreground">closed</span>;
  } else {
    const total = Math.max(1, tg - s);
    frac = Math.max(0, Math.min(1, (now - s) / total));
    const remain = tg - now;
    const breached = remain < 0;
    barColor = breached ? "bg-rose-500" : frac > 0.75 ? "bg-amber-500" : "bg-emerald-500";
    state = breached
      ? <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400"><AlertTriangleIcon className="size-3.5" /> {remainText(-remain)} overdue</span>
      : <span className={cn(frac > 0.75 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>due in {remainText(remain)}</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        {state}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${frac * 100}%` }} />
      </div>
      <div className="text-[0.7rem] text-muted-foreground">
        {done !== null ? `${label === "Respond" ? "responded" : "resolved"} ${fmtDT(new Date(done).toISOString())}` : `target ${fmtDT(target)}`}
      </div>
    </div>
  );
}

function remainText(ms: number): string {
  const h = Math.round(Math.abs(ms) / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.round(Math.abs(ms) / 60_000))}m`;
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function EditDialog({ t, config, users, clients, projects, onClose, onSaved }: {
  t: Detail; config: DetailConfig; users: Opt[]; clients: Opt[]; projects: Opt[]; onClose: () => void; onSaved: () => void;
}) {
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [f, setF] = React.useState({
    title: t.title, description: t.description, typeId: t.typeId, clientId: t.clientId ?? "", projectId: t.projectId ?? "",
    category: t.category, systemRef: t.systemRef, moduleRef: t.moduleRef, dueDate: t.dueDate, resolution: t.resolution,
  });
  const [fieldVals, setFieldVals] = React.useState<Record<string, unknown>>(() => Object.fromEntries(t.fields.map((x) => [x.id, x.value])));
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const typeChanged = f.typeId !== t.typeId;

  async function save() {
    setSaving(true); setErr(null);
    const r = await updateTicketDetailsAction(t.id, {
      title: f.title, description: f.description, typeId: f.typeId,
      clientId: f.clientId || null, projectId: f.projectId || null,
      category: f.category, systemRef: f.systemRef, moduleRef: f.moduleRef,
      dueDate: f.dueDate || null, resolution: f.resolution,
      fields: typeChanged ? undefined : fieldVals,
    });
    setSaving(false);
    if (r.error) setErr(r.error); else onSaved();
  }

  return (
    <Dialog open disablePointerDismissal onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle>Edit ticket</DialogTitle></DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1"><Label htmlFor="e-title">Title</Label><Input id="e-title" value={f.title} onChange={(e) => set({ title: e.target.value })} /></div>
          <div className="flex flex-col gap-1"><Label htmlFor="e-desc">Description</Label><Textarea id="e-desc" rows={4} value={f.description} onChange={(e) => set({ description: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1"><Label htmlFor="e-type">Type</Label><select id="e-type" value={f.typeId} onChange={(e) => set({ typeId: e.target.value })} className={selectCls}>{config.types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
            <div className="flex flex-col gap-1"><Label htmlFor="e-due">Due date</Label><Input id="e-due" type="date" value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></div>
            <div className="flex flex-col gap-1"><Label htmlFor="e-client">Client</Label><select id="e-client" value={f.clientId} onChange={(e) => set({ clientId: e.target.value })} className={selectCls}><option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="flex flex-col gap-1"><Label htmlFor="e-project">Project</Label><select id="e-project" value={f.projectId} onChange={(e) => set({ projectId: e.target.value })} className={selectCls}><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="flex flex-col gap-1"><Label htmlFor="e-sys">System / CI</Label><Input id="e-sys" value={f.systemRef} onChange={(e) => set({ systemRef: e.target.value })} /></div>
            <div className="flex flex-col gap-1"><Label htmlFor="e-mod">Module</Label><Input id="e-mod" value={f.moduleRef} onChange={(e) => set({ moduleRef: e.target.value })} /></div>
          </div>
          <div className="flex flex-col gap-1"><Label htmlFor="e-cat">Category</Label><Input id="e-cat" value={f.category} onChange={(e) => set({ category: e.target.value })} /></div>
          {typeChanged ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">Changing the type resets the status to that type&apos;s starting status and switches its custom fields. Save, then set the new fields.</p>
          ) : config.fields.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/20 p-3">
              {config.fields.map((fd) => <FieldControl key={fd.id} field={fd} users={users} value={fieldVals[fd.id]} onChange={(v) => setFieldVals((s) => ({ ...s, [fd.id]: v }))} />)}
            </div>
          ) : null}
          <div className="flex flex-col gap-1"><Label htmlFor="e-res">Resolution</Label><Textarea id="e-res" rows={3} value={f.resolution} onChange={(e) => set({ resolution: e.target.value })} placeholder="How it was resolved (shown when resolved)" /></div>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
