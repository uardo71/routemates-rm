"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Trash2Icon, ClockIcon, SaveIcon, RotateCcwIcon, MessageSquareIcon, HistoryIcon, TimerIcon,
  CheckCircle2Icon, AlertTriangleIcon, PencilLineIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InitialsAvatar } from "@/components/initials-avatar";
import { cn } from "@/lib/utils";
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABEL, TICKET_PRIORITY_DOT, TICKET_ACTIVITY_LABEL } from "@/lib/ticket";
import { labelFromTimestamps } from "@/lib/sla";
import { statusColor } from "@/lib/ticket-config";
import type { TicketPriority, TicketStatusCategory } from "@prisma/client";
import { SlaBadge, slaBadgeState } from "../sla";
import { TypeIcon, StatusDot } from "../ticket-visuals";
import { FieldControl, type PubField } from "../field-control";
import { Conversation } from "../conversation";
import type { CommentNode } from "../conversation";
import {
  applyWorkflowAction, updateTicketDetailsAction, addCommentAction, deleteTicketAttachmentAction,
  editCommentAction, deleteCommentAction, addWorklogAction, deleteWorklogAction,
} from "../actions";
import { saveChangeRequestAction } from "../cr-actions";
import { formatDuration, isCrTerminal, nextStepState, type CrDraft } from "@/lib/change-request";
import { ChangeRequestLifecycle, CrRecordSection, type CrView } from "./change-request-panel";
import { TicketStageLifecycle, TicketStageFields, type StageView, type StageFieldVal } from "./stage-panel";
import { TicketFiles, type TicketFile } from "./ticket-files";

// Laid out like an Azure DevOps work item: a sticky header (type eyebrow, title, assignee, state
// strip, tabs) over a three-column body — description + discussion on the left, classification and
// SLA in the middle, the type's own fields and resolution on the right. Everything is edited in
// place; changes collect into one draft and go out on a single Save, exactly like DevOps.

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
  slaExempt: boolean; slaSourceLabel: string | null; files: TicketFile[];
  /** Values of archived custom fields this ticket still carries — shown read-only, marked "archived field". */
  archivedFields: { id: string; name: string; display: string }[];
  /** Set when the ticket is a change request: its lifecycle, record and stage history. */
  cr: CrView | null;
  /** Set when the ticket's type runs on stages (and isn't the change request): its lifecycle. */
  stage: StageView | null;
  /** That type's stage-scoped fields, grouped under their stage. Part of the same draft and Save. */
  stageFields: StageFieldVal[];
};

const selectCls = "h-8 w-full rounded-md border bg-transparent px-2 text-sm outline-none focus:border-primary/50 disabled:border-transparent disabled:px-0 disabled:opacity-100";
const inputCls = "h-8";
const fmtDT = (s: string) => (s ? s.slice(0, 16).replace("T", " ") : "—");
const fmtMin = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;

type Draft = {
  title: string; description: string; statusId: string; assigneeId: string; priority: TicketPriority;
  clientId: string; projectId: string; category: string; systemRef: string; moduleRef: string; dueDate: string; resolution: string;
  fields: Record<string, unknown>;
};
function draftFrom(t: Detail): Draft {
  return {
    title: t.title, description: t.description, statusId: t.statusId, assigneeId: t.assigneeId ?? "", priority: t.priority,
    clientId: t.clientId ?? "", projectId: t.projectId ?? "", category: t.category, systemRef: t.systemRef, moduleRef: t.moduleRef,
    dueDate: t.dueDate, resolution: t.resolution,
    // The general panel's fields and, for a STAGE-mode type, its stage-scoped ones: one draft, one Save.
    fields: Object.fromEntries([...t.fields, ...t.stageFields].map((f) => [f.id, f.value])),
  };
}

export function TicketDetailClient(props: {
  t: Detail; config: DetailConfig; canManage: boolean; involved: boolean; users: Opt[]; clients: Opt[]; projects: Opt[];
  conversation: CommentNode[]; history: HistoryEvent[];
  /** Explanations for values the create step didn't keep (lib/ticket.ts#createDropNotices). */
  notices: string[];
}) {
  // Re-key on the server's version of the ticket so a refresh after Save resets the draft without
  // an effect that syncs state to props.
  return <WorkItem key={JSON.stringify(draftFrom(props.t)) + props.t.typeId + JSON.stringify(props.t.cr?.saved ?? null) + (props.t.stage?.stageKey ?? "")} {...props} />;
}

function WorkItem({ t, config, canManage, involved, users, clients, projects, conversation, history, notices }: {
  t: Detail; config: DetailConfig; canManage: boolean; involved: boolean; users: Opt[]; clients: Opt[]; projects: Opt[];
  conversation: CommentNode[]; history: HistoryEvent[];
  /** Explanations for values the create step didn't keep (lib/ticket.ts#createDropNotices). */
  notices: string[];
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState<"details" | "history" | "worklog">("details");
  const [typeDialog, setTypeDialog] = React.useState(false);
  const baseline = React.useMemo(() => draftFrom(t), [t]);
  const [d, setD] = React.useState<Draft>(baseline);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const workflowDirty = d.statusId !== baseline.statusId || d.assigneeId !== baseline.assigneeId || d.priority !== baseline.priority;
  const detailsDirty = JSON.stringify({ ...d, statusId: 0, assigneeId: 0, priority: 0 }) !== JSON.stringify({ ...baseline, statusId: 0, assigneeId: 0, priority: 0 });
  // A change request's record is part of the same draft and goes out on the same Save.
  const crSaved = t.cr?.saved ?? null;
  const [crd, setCrd] = React.useState<CrDraft | null>(crSaved);
  const setCr = (p: Partial<CrDraft>) => setCrd((x) => (x ? { ...x, ...p } : x));
  const crDirty = !!crd && JSON.stringify(crd) !== JSON.stringify(crSaved);
  const dirty = workflowDirty || detailsDirty || crDirty;
  // Files and the change-request record: the client's team and the people on the ticket.
  const canContribute = canManage || involved;

  async function save() {
    setSaving(true); setErr(null);
    try {
      if (crDirty && crd) {
        const r = await saveChangeRequestAction(t.id, crd);
        if (r.error) { setErr(r.error); return; }
      }
      if (workflowDirty) {
        const r = await applyWorkflowAction(t.id, { statusId: d.statusId, assigneeId: canManage ? (d.assigneeId || null) : undefined, priority: canManage ? d.priority : undefined });
        if (r.error) { setErr(r.error); return; }
        // The rest of the save still goes through; each refused change is named, with the reason.
        // A toast (not inline state) because the page re-keys from the server after the refresh.
        r.rejected?.forEach((m) => toast.warning(m));
      }
      if (detailsDirty && canManage) {
        const r = await updateTicketDetailsAction(t.id, {
          title: d.title, description: d.description, typeId: t.typeId,
          clientId: d.clientId || null, projectId: d.projectId || null,
          category: d.category, systemRef: d.systemRef, moduleRef: d.moduleRef,
          dueDate: d.dueDate || null, resolution: d.resolution, fields: d.fields,
        });
        if (r.error) { setErr(r.error); return; }
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const post = React.useCallback((fd: FormData) => addCommentAction(t.id, fd), [t.id]);
  const commentCount = countComments(conversation);
  const loggedMin = t.worklogs.reduce((s, w) => s + w.minutes, 0);
  const assignee = users.find((u) => u.id === d.assigneeId);
  const statusOf = config.statuses.find((s) => s.id === d.statusId);
  const typeTone = statusColor(t.typeColor);
  const ro = !canManage; // read-only for everything except status (workflow) and comments
  const hasFields = t.fields.length > 0 || t.archivedFields.length > 0;

  const resolutionSection = (
    <Section title="Resolution">
      {ro ? (
        t.resolution ? <p className="whitespace-pre-wrap text-sm">{t.resolution}</p> : <p className="text-sm text-muted-foreground">—</p>
      ) : (
        <Textarea value={d.resolution} onChange={(e) => set({ resolution: e.target.value })} rows={4} placeholder="How it was resolved (closing comment)" className="border-border/60 bg-background focus:border-primary/50" />
      )}
      {t.statusCategory === "DONE" && t.resolvedAt && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">Resolved {fmtDT(t.resolvedAt)}</p>}
    </Section>
  );

  return (
    <div className="flex flex-col gap-5">
      <Link href={t.clientId ? `/tickets/c/${t.clientId}` : "/tickets"} className="text-sm text-muted-foreground hover:underline">
        ← {t.clientName ?? "Support"}
      </Link>

      {notices.length > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <ul className="flex-1 space-y-0.5">{notices.map((n) => <li key={n}>{n}</li>)}</ul>
          <button type="button" onClick={() => router.replace(`/tickets/${t.id}`)} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
        </div>
      )}

      {/* ---------- Header (sticky, like the DevOps work-item bar) ---------- */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex">
          <div className={cn("w-1.5 shrink-0", typeTone.dot)} />
          <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
            {/* eyebrow */}
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <TypeIcon icon={t.typeIcon} className="size-3.5" /> {t.typeName} <span className="font-mono normal-case tracking-normal">{t.number}</span>
            </div>

            {/* title */}
            <div className="flex items-baseline gap-3">
              {ro ? (
                <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight">{d.title}</h1>
              ) : (
                <input
                  value={d.title}
                  onChange={(e) => set({ title: e.target.value })}
                  className="min-w-0 flex-1 rounded-md border border-border/60 bg-background px-2 py-1 text-xl font-semibold tracking-tight outline-none focus:border-primary/50"
                  aria-label="Title"
                />
              )}
            </div>

            {/* meta row: assignee · comments · SLA ····· save/undo · change type */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <div className="flex items-center gap-2">
                <InitialsAvatar name={assignee?.name ?? "?"} size="sm" className={cn(!assignee && "opacity-40")} />
                {ro ? (
                  <span className="text-sm">{t.assigneeName ?? <span className="text-muted-foreground">Unassigned</span>}</span>
                ) : (
                  <select value={d.assigneeId} onChange={(e) => set({ assigneeId: e.target.value })} className="h-8 rounded-md border border-border/60 bg-background px-2 pr-6 text-sm focus:border-primary/50" aria-label="Assigned to">
                    <option value="">Unassigned</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                )}
              </div>
              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><MessageSquareIcon className="size-4" /> {commentCount} Comment{commentCount === 1 ? "" : "s"}</span>
              {t.cr ? <CrPill cr={t.cr} nextDue={crd?.nextStepDue ?? ""} /> : t.stage ? <StagePill t={t} stage={t.stage} /> : t.slaExempt ? null : <LiveSla t={t} />}

              <div className="ml-auto flex items-center gap-2">
                {err && <span className="text-sm text-destructive">{err}</span>}
                {dirty && (
                  <>
                    <Button size="sm" onClick={save} disabled={saving} className="gap-1.5"><SaveIcon className="size-4" /> {saving ? "Saving…" : "Save"}</Button>
                    <Button size="sm" variant="outline" onClick={() => { setD(baseline); setCrd(crSaved); setErr(null); }} disabled={saving} className="gap-1.5"><RotateCcwIcon className="size-3.5" /> Undo</Button>
                  </>
                )}
                {canManage && !dirty && (
                  <Button size="sm" variant="ghost" onClick={() => setTypeDialog(true)} className="gap-1.5 text-muted-foreground" title="Change the ticket type (resets status and fields)">
                    <PencilLineIcon className="size-4" /> Change type
                  </Button>
                )}
              </div>
            </div>

            {/* state strip: State / Priority  |  Client / Project */}
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-t pt-3">
            <div className="grid min-w-[320px] flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              <Strip label={t.cr || t.stage ? "Stage" : "State"}>
                <div className="flex items-center gap-2">
                  <StatusDot color={statusOf?.color ?? t.statusColor} />
                  {t.cr ? (
                    <span className="flex h-8 items-center text-sm" title="A change request moves from the Lifecycle panel below">{t.statusName}</span>
                  ) : t.stage ? (
                    <span className="flex h-8 items-center text-sm" title="This ticket moves from the Lifecycle panel below">{stageName(t.stage) ?? t.statusName}</span>
                  ) : (
                    <select value={d.statusId} onChange={(e) => set({ statusId: e.target.value })} className="h-8 flex-1 rounded-md border border-border/60 bg-background px-2 text-sm focus:border-primary/50" aria-label="State">
                      {config.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                </div>
              </Strip>
              <Strip label="Priority">
                <div className="flex items-center gap-2">
                  <span className={cn("size-2 shrink-0 rounded-full", TICKET_PRIORITY_DOT[d.priority])} />
                  {ro ? <span className="text-sm">{TICKET_PRIORITY_LABEL[d.priority]}</span> : (
                    <select value={d.priority} onChange={(e) => set({ priority: e.target.value as TicketPriority })} className="h-8 flex-1 rounded-md border border-border/60 bg-background px-2 text-sm focus:border-primary/50" aria-label="Priority">
                      {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABEL[p]}</option>)}
                    </select>
                  )}
                </div>
              </Strip>
              <Strip label="Client">
                {ro ? <Ro>{t.clientName}</Ro> : (
                  <select value={d.clientId} onChange={(e) => set({ clientId: e.target.value })} className="h-8 w-full rounded-md border border-border/60 bg-background px-2 text-sm focus:border-primary/50" aria-label="Client">
                    <option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </Strip>
              <Strip label="Project">
                {ro ? <Ro>{t.projectName}</Ro> : (
                  <select value={d.projectId} onChange={(e) => set({ projectId: e.target.value })} className="h-8 w-full rounded-md border border-border/60 bg-background px-2 text-sm focus:border-primary/50" aria-label="Project">
                    <option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
              </Strip>
            </div>
            <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-1">
              <Tab active={tab === "details"} onClick={() => setTab("details")} icon={<PencilLineIcon className="size-4" />} label="Details" />
              <Tab active={tab === "history"} onClick={() => setTab("history")} icon={<HistoryIcon className="size-4" />} label="History" count={history.length} />
              <Tab active={tab === "worklog"} onClick={() => setTab("worklog")} icon={<TimerIcon className="size-4" />} label={loggedMin > 0 ? `Worklog · ${fmtMin(loggedMin)}` : "Worklog"} />
            </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Body ---------- */}
      {tab === "details" && t.stage && (
        <TicketStageLifecycle ticketId={t.id} view={t.stage} editable={canContribute} canManage={canManage} dirty={dirty} />
      )}
      {tab === "details" && t.cr && crd && (
        <ChangeRequestLifecycle
          ticketId={t.id} cr={t.cr} draft={crd} set={setCr} editable={canContribute} canManage={canManage} dirty={dirty}
          assigneeId={d.assigneeId} resolution={d.resolution} users={users}
        />
      )}
      {tab === "details" && (
        <div className={cn("grid gap-6", hasFields ? "xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]")}>
          {/* Left: Description + Discussion */}
          <div className="flex min-w-0 flex-col gap-6">
            <Section title="Description">
              {ro ? (
                d.description ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{d.description}</p> : <p className="text-sm text-muted-foreground">No description.</p>
              ) : (
                <Textarea value={d.description} onChange={(e) => set({ description: e.target.value })} rows={8} placeholder="Describe the issue or request…" className="border-border/60 bg-background focus:border-primary/50" />
              )}
            </Section>
            <Section title={`Files${t.files.length ? ` (${t.files.length})` : ""}`}>
              <TicketFiles key={t.cr?.stage ?? "ticket"} ticketId={t.id} files={t.files} canUpload={canContribute} crStage={t.cr ? t.cr.stage : undefined} />
            </Section>
            <Section title="Discussion">
              <Conversation comments={conversation} canInternal={canManage} postAction={post} deleteAttachmentAction={deleteTicketAttachmentAction} editAction={editCommentAction} deleteCommentAction={deleteCommentAction} />
            </Section>
          </div>

          {/* Middle: Classification + SLA */}
          <div className="flex min-w-0 flex-col gap-6">
            <Section title="Classification">
              <Fld label="Category">{ro ? <Ro>{t.category}</Ro> : <Input value={d.category} onChange={(e) => set({ category: e.target.value })} className={inputCls} />}</Fld>
              <Fld label="System / CI">{ro ? <Ro>{t.systemRef}</Ro> : <Input value={d.systemRef} onChange={(e) => set({ systemRef: e.target.value })} className={inputCls} placeholder="e.g. DA1" />}</Fld>
              <Fld label="Module">{ro ? <Ro>{t.moduleRef}</Ro> : <Input value={d.moduleRef} onChange={(e) => set({ moduleRef: e.target.value })} className={inputCls} placeholder="e.g. FI, MM, AP" />}</Fld>
              <Fld label="Due date">{ro ? <Ro>{t.dueDate}</Ro> : <Input type="date" value={d.dueDate} onChange={(e) => set({ dueDate: e.target.value })} className={inputCls} />}</Fld>
              <Fld label="Requester"><Ro>{t.requesterName}</Ro></Fld>
              <Fld label="Created"><Ro>{fmtDT(t.createdAt)}</Ro></Fld>
            </Section>
            {t.cr && crd
              ? <CrRecordSection draft={crd} set={setCr} editable={canContribute} loggedMinutes={t.cr.loggedMinutes} stage={t.cr.stage} />
              : t.stage
                ? <TicketStageFields
                    typeName={t.typeName} stages={t.stage.stages} stageKey={t.stage.stageKey}
                    fields={t.stageFields} values={d.fields} editable={!ro} users={users}
                    onChange={(id, v) => set({ fields: { ...d.fields, [id]: v } })} />
                : t.slaExempt ? null : <SlaSection t={t} />}
            {!hasFields && resolutionSection}
          </div>

          {/* Right: the type's own fields + resolution (only when the type has fields) */}
          {hasFields && <div className="flex min-w-0 flex-col gap-6">
            <Section title={`${t.typeName} fields`}>
              {ro ? (
                t.fields.map((f) => <Fld key={f.id} label={f.name}><Ro>{f.display}</Ro></Fld>)
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {t.fields.map((f) => <FieldControl key={f.id} field={f} users={users} value={d.fields[f.id]} onChange={(v) => set({ fields: { ...d.fields, [f.id]: v } })} />)}
                </div>
              )}
              {t.archivedFields.map((f) => <ArchivedFieldValue key={f.id} name={f.name} display={f.display} />)}
            </Section>
            {resolutionSection}
          </div>}
        </div>
      )}

      {tab === "history" && <Section title="History"><History events={history} /></Section>}
      {tab === "worklog" && <Section title="Worklog"><WorklogPanel t={t} onChanged={() => router.refresh()} /></Section>}

      {typeDialog && <EditDialog t={t} config={config} users={users} onClose={() => setTypeDialog(false)} onSaved={() => { setTypeDialog(false); router.refresh(); }} />}
    </div>
  );
}

function countComments(nodes: CommentNode[]): number {
  return nodes.reduce((n, c) => n + 1 + countComments(c.replies), 0);
}

// ---------- layout atoms (DevOps-style section headings and label-over-value fields) ----------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="border-b pb-1.5 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}
function Strip({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-0.5"><span className="text-[11px] text-muted-foreground">{label}</span>{children}</div>;
}
function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><span className="text-[11px] text-muted-foreground">{label}</span>{children}</div>;
}
function Ro({ children }: { children: React.ReactNode }) {
  const empty = children === null || children === undefined || children === "";
  return <span className={cn("text-sm", empty && "text-muted-foreground/40")}>{empty ? "—" : children}</span>;
}

/** A value of an archived custom field: read-only, clearly marked, never part of the Save draft. */
function ArchivedFieldValue({ name, display }: { name: string; display: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {name}
        <span className="rounded bg-muted px-1 py-px text-[10px] font-medium uppercase tracking-wide">archived field</span>
      </span>
      <span className="whitespace-pre-wrap text-sm text-muted-foreground">{display}</span>
    </div>
  );
}

function Tab({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button onClick={onClick} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors", active ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/50")}>
      {icon} {label}{count !== undefined && count > 0 && <span className="rounded-full bg-foreground/10 px-1.5 text-xs tabular-nums">{count}</span>}
    </button>
  );
}

function LiveSla({ t }: { t: Detail }) {
  const [, tick] = React.useState(0);
  React.useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(id); }, []);
  // Detail carries the flag as slaExempt; the badge wants it the positive way round. The badge
  // draws nothing when there is no SLA to show, which is what this used to return null for.
  return <SlaBadge state={slaBadgeState({ ...t, slaApplicable: !t.slaExempt })} />;
}

/** The stage a STAGE-mode ticket is in, as the header strip shows it. */
function stageName(stage: StageView): string | null {
  return stage.stages.find((s) => s.key === stage.stageKey)?.name ?? null;
}

function StagePill({ t, stage }: { t: Detail; stage: StageView }) {
  const current = stage.stages.find((s) => s.key === stage.stageKey) ?? null;
  const spent = current ? stage.timeInStage[current.key] : undefined;
  const live = !!current && !current.isTerminal;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
      {current?.name ?? stage.statusName}{live && spent ? ` · ${formatDuration(spent)}` : ""}{t.slaExempt ? " · no SLA" : ""}
    </span>
  );
}

/** A change request has no SLA clock; the header shows its stage, time in it, and an overdue next step. */
function CrPill({ cr, nextDue }: { cr: CrView; nextDue: string }) {
  const spent = cr.stage ? cr.timeInStage[cr.stage] : undefined;
  const live = !!cr.stage && !isCrTerminal(cr.stage);
  const overdue = live && nextStepState(nextDue || null, cr.todayIso) === "overdue";
  return (
    <>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
        {cr.statusName}{live && spent ? ` · ${formatDuration(spent)}` : ""} · no SLA
      </span>
      {overdue && <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/8 px-2 py-0.5 text-xs text-rose-700 dark:text-rose-400"><AlertTriangleIcon className="size-3" /> Next step overdue</span>}
    </>
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

// ---------- SLA (visual respond/resolve tracks with a live countdown) ----------

function SlaSection({ t }: { t: Detail }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  const target = labelFromTimestamps(t.createdAt, t.respondBy, t.resolveBy);
  const closed = t.statusCategory === "DONE" || t.statusCategory === "CANCELLED";
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-2 border-b pb-1.5">
        <h2 className="text-sm font-semibold">SLA</h2>
        <span className="flex items-center gap-2">
          {target && <span className="font-mono text-xs text-muted-foreground">{target}</span>}
          {t.slaSourceLabel && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground" title="Client override beats the company policy, which beats the built-in default">{t.slaSourceLabel}</span>}
        </span>
      </div>
      <SlaTrack label="Respond" start={t.createdAt} target={t.respondBy} doneAt={t.firstResponseAt} now={now} stopped={closed && !t.firstResponseAt} />
      <SlaTrack label="Resolve" start={t.createdAt} target={t.resolveBy} doneAt={t.resolvedAt} now={now} stopped={closed && !t.resolvedAt} />
      {!t.respondBy && !t.resolveBy && <p className="text-sm text-muted-foreground">No SLA targets on this ticket.</p>}
    </section>
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

// ---------- Change type (kept as a dialog: switching type resets status + fields, so it deserves a confirm step) ----------

function EditDialog({ t, config, users, onClose, onSaved }: {
  t: Detail; config: DetailConfig; users: Opt[]; onClose: () => void; onSaved: () => void;
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
        <DialogHeader><DialogTitle>Change ticket type</DialogTitle></DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1"><Label htmlFor="e-type">Type</Label><select id="e-type" value={f.typeId} onChange={(e) => set({ typeId: e.target.value })} className={selectCls}>{config.types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          {typeChanged ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">Changing the type resets the status to that type&apos;s starting status and switches its custom fields. Save, then fill in the new fields on the ticket.</p>
          ) : config.fields.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/20 p-3">
              {config.fields.map((fd) => <FieldControl key={fd.id} field={fd} users={users} value={fieldVals[fd.id]} onChange={(v) => setFieldVals((s) => ({ ...s, [fd.id]: v }))} />)}
            </div>
          ) : null}
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !typeChanged}>{saving ? "Saving…" : "Change type"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
