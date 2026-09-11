"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, PencilIcon, Trash2Icon, XIcon, FileDownIcon, ClockIcon, MapPinIcon, ChevronDownIcon, SearchIcon, UsersIcon, PaperclipIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { OwnerCombobox, type OwnerPerson } from "@/components/owner-combobox";
import { createMeetingAction, updateMeetingAction, deleteMeetingAction } from "../actions";

export type MinutesAction = { id?: string; description: string; owner: string | null; ownerUserId: string | null; dueDate: string | null; done: boolean };
export type MinutesParticipant = { name: string; company: string | null; role: string | null; group: string | null };
export type MinutesRow = {
  id: string;
  date: string;
  title: string;
  attendees: string | null;
  notes: string | null;
  timeFrom: string | null; timeTo: string | null; location: string | null; minuteTaker: string | null;
  agendaTopic: string | null; agendaWho: string | null; agendaDuration: string | null;
  participants: MinutesParticipant[];
  createdByName: string;
  actions: MinutesAction[];
  /** Files uploaded as "Meeting minutes" that created / are attached to this entry. */
  documents: { id: string; fileName: string; originalName: string }[];
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const fmtD = (s: string) => { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };

type DraftP = { name: string; company: string; role: string; group: string };
type DraftA = { id?: string; description: string; owner: string; ownerUserId: string | null; dueDate: string; done: boolean };
type Draft = {
  id?: string; date: string; title: string;
  timeFrom: string; timeTo: string; location: string; minuteTaker: string;
  agendaTopic: string; agendaWho: string; agendaDuration: string;
  notes: string; participants: DraftP[]; actions: DraftA[];
};
const emptyDraft = (): Draft => ({
  date: todayIso(), title: "", timeFrom: "", timeTo: "", location: "MS Teams", minuteTaker: "",
  agendaTopic: "", agendaWho: "All", agendaDuration: "", notes: "",
  participants: [{ name: "", company: "", role: "", group: "" }], actions: [],
});

export function MinutesClient({ projectId, engagementId, items, people }: { projectId: string; engagementId: string | null; items: MinutesRow[]; people: OwnerPerson[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set(items[0] ? [items[0].id] : []));
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const shown = items.filter((m) => !q.trim() || `${m.title} ${m.date} ${m.attendees ?? ""} ${m.minuteTaker ?? ""} ${m.agendaTopic ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));

  function save() {
    if (!draft) return;
    if (!draft.title.trim()) return toast.error("Enter a meeting title.");
    const participants = draft.participants.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), company: p.company || null, role: p.role || null, group: p.group || null }));
    const actions = draft.actions.filter((a) => a.description.trim()).map((a) => ({ description: a.description.trim(), owner: a.owner || null, ownerUserId: a.ownerUserId, dueDate: a.dueDate || null, done: a.done, id: a.id ?? null }));
    const payload = {
      projectId, engagementId, date: draft.date, title: draft.title.trim(),
      attendees: participants.map((p) => p.name).join(", ") || null, notes: draft.notes || null,
      timeFrom: draft.timeFrom || null, timeTo: draft.timeTo || null, location: draft.location || null, minuteTaker: draft.minuteTaker || null,
      agendaTopic: draft.agendaTopic || null, agendaWho: draft.agendaWho || null, agendaDuration: draft.agendaDuration || null,
      participants, actions,
    };
    start(async () => {
      const r = draft.id ? await updateMeetingAction({ id: draft.id, ...payload }) : await createMeetingAction(payload);
      if (r.error) toast.error(r.error);
      else { toast.success("Saved."); setDraft(null); router.refresh(); }
    });
  }
  function edit(m: MinutesRow) {
    setDraft({
      id: m.id, date: m.date, title: m.title, timeFrom: m.timeFrom ?? "", timeTo: m.timeTo ?? "", location: m.location ?? "", minuteTaker: m.minuteTaker ?? "",
      agendaTopic: m.agendaTopic ?? "", agendaWho: m.agendaWho ?? "", agendaDuration: m.agendaDuration ?? "", notes: m.notes ?? "",
      participants: m.participants.length ? m.participants.map((p) => ({ name: p.name, company: p.company ?? "", role: p.role ?? "", group: p.group ?? "" })) : [{ name: "", company: "", role: "", group: "" }],
      actions: m.actions.map((a) => ({ id: a.id, description: a.description, owner: a.owner ?? "", ownerUserId: a.ownerUserId, dueDate: a.dueDate ?? "", done: a.done })),
    });
  }
  function remove(id: string) {
    if (!confirm("Delete these minutes?")) return;
    start(async () => { const r = await deleteMeetingAction(id); if (r.error) toast.error(r.error); else { toast.success("Deleted."); router.refresh(); } });
  }

  const setP = (i: number, patch: Partial<DraftP>) => setDraft((d) => (d ? { ...d, participants: d.participants.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) } : d));
  const addP = () => setDraft((d) => (d ? { ...d, participants: [...d.participants, { name: "", company: "", role: "", group: "" }] } : d));
  const rmP = (i: number) => setDraft((d) => (d ? { ...d, participants: d.participants.filter((_, idx) => idx !== i) } : d));
  const setA = (i: number, patch: Partial<DraftA>) => setDraft((d) => (d ? { ...d, actions: d.actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)) } : d));
  const addA = () => setDraft((d) => (d ? { ...d, actions: [...d.actions, { description: "", owner: "", ownerUserId: null, dueDate: "", done: false }] } : d));
  const rmA = (i: number) => setDraft((d) => (d ? { ...d, actions: d.actions.filter((_, idx) => idx !== i) } : d));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search minutes…" className="w-64 pl-8" />
        </div>
        <Button size="sm" onClick={() => setDraft(emptyDraft())}><PlusIcon className="size-3.5" /> New minutes</Button>
      </div>

      {items.length === 0 && <Card><CardContent className="py-10 text-center text-muted-foreground">No minutes yet.</CardContent></Card>}
      {items.length > 0 && shown.length === 0 && <Card><CardContent className="py-8 text-center text-muted-foreground">No minutes match “{q}”.</CardContent></Card>}

      {shown.map((m) => {
        const isOpen = open.has(m.id);
        return (
        <Card key={m.id} className="overflow-hidden p-0 gap-0">
          <div className={cn("flex flex-wrap items-start justify-between gap-3 px-5 py-3 cursor-pointer hover:bg-muted/40", isOpen && "border-b bg-muted/25")} onClick={() => toggle(m.id)}>
            <div className="flex min-w-0 items-start gap-2">
              <ChevronDownIcon className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
              <div className="min-w-0">
                <div className="font-semibold">{m.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{fmtD(m.date)}</span>
                  {(m.timeFrom || m.timeTo) && <span className="inline-flex items-center gap-1"><ClockIcon className="size-3" />{m.timeFrom}{m.timeTo ? `–${m.timeTo}` : ""}</span>}
                  {m.location && <span className="inline-flex items-center gap-1"><MapPinIcon className="size-3" />{m.location}</span>}
                  {m.participants.length > 0 && <span className="inline-flex items-center gap-1"><UsersIcon className="size-3" />{m.participants.length}</span>}
                  {m.actions.length > 0 && <span>{m.actions.filter((a) => !a.done).length} open · {m.actions.length} next step{m.actions.length === 1 ? "" : "s"}</span>}
                  {m.documents.map((d) => (
                    <a key={d.id} href={`/api/documents/${d.fileName}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-primary hover:underline">
                      <PaperclipIcon className="size-3" /> {d.originalName}
                    </a>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
              <a href={`/print/minutes/${m.id}`} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline"><FileDownIcon className="size-3.5" /> Export PDF</Button></a>
              <Button size="sm" variant="outline" onClick={() => edit(m)} title="Edit"><PencilIcon className="size-3.5" /></Button>
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => remove(m.id)} disabled={pending} title="Delete"><Trash2Icon className="size-3.5" /></Button>
            </div>
          </div>

          {isOpen && (
          <CardContent className="flex flex-col gap-5 py-4 text-sm">
            {m.participants.length > 0 && (
              <section>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Participants</div>
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-muted/40 text-left text-[11px] font-medium text-muted-foreground">
                      <th className="px-3 py-1.5">Name</th><th className="px-3 py-1.5">Company</th><th className="px-3 py-1.5">Role</th><th className="px-3 py-1.5">Group</th>
                    </tr></thead>
                    <tbody>
                      {m.participants.map((p, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-1.5 font-medium">{p.name}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{p.company || "—"}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{p.role || "—"}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{p.group || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {m.agendaTopic && (
              <section>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Agenda</div>
                <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2">
                  <span className="flex-1">{m.agendaTopic}</span>
                  {m.agendaWho && <span className="shrink-0 rounded-full bg-background border px-2 py-0.5 text-xs text-muted-foreground">{m.agendaWho}</span>}
                  {m.agendaDuration && <span className="shrink-0 font-mono text-xs text-muted-foreground">{m.agendaDuration}</span>}
                </div>
              </section>
            )}

            {m.notes && (
              <section>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Discussion</div>
                <ul className="flex list-disc flex-col gap-1.5 pl-5 leading-relaxed marker:text-primary/60">
                  {m.notes.split(/\r?\n/).map((l) => l.replace(/^[•\-*]\s*/, "").trim()).filter(Boolean).map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              </section>
            )}

            {m.actions.length > 0 && (
              <section>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Next steps</div>
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-muted/40 text-left text-[11px] font-medium text-muted-foreground">
                      <th className="px-3 py-1.5">To discuss / do</th><th className="w-32 px-3 py-1.5">Who</th><th className="w-28 px-3 py-1.5">Due</th>
                    </tr></thead>
                    <tbody>
                      {m.actions.map((a, i) => (
                        <tr key={i} className="border-t">
                          <td className={cn("px-3 py-1.5", a.done && "text-muted-foreground line-through")}>
                            <span className="mr-2 inline-flex size-3.5 items-center justify-center rounded-[3px] border align-middle text-[8px] text-white" style={a.done ? { background: "var(--color-emerald-500, #10b981)", borderColor: "transparent" } : undefined}>{a.done ? "✓" : ""}</span>
                            {a.description}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">{a.owner || "—"}</td>
                          <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{a.dueDate ? fmtD(a.dueDate) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <div className="text-xs text-muted-foreground">Recorded by {m.createdByName}</div>
          </CardContent>
          )}
        </Card>
        );
      })}

      {draft && (
        <Dialog open disablePointerDismissal onOpenChange={(v) => !v && setDraft(null)}>
          <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <DialogHeader><DialogTitle>{draft.id ? "Edit minutes" : "New minutes"}</DialogTitle></DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 pr-1">
              {/* header fields */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="flex flex-col gap-1.5"><Label>Date</Label><Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></div>
                <div className="flex flex-col gap-1.5"><Label>Time from</Label><Input type="time" value={draft.timeFrom} onChange={(e) => setDraft({ ...draft, timeFrom: e.target.value })} /></div>
                <div className="flex flex-col gap-1.5"><Label>Time to</Label><Input type="time" value={draft.timeTo} onChange={(e) => setDraft({ ...draft, timeTo: e.target.value })} /></div>
                <div className="flex flex-col gap-1.5"><Label>Location</Label><Input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="MS Teams" /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="flex flex-col gap-1.5 sm:col-span-2"><Label>Meeting title</Label><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={300} placeholder="e.g. FI-Approval Workflow Enhancement" /></div>
                <div className="flex flex-col gap-1.5"><Label>Minute taker</Label><Input value={draft.minuteTaker} onChange={(e) => setDraft({ ...draft, minuteTaker: e.target.value })} placeholder="Your name" /></div>
              </div>

              {/* participants */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between"><Label>Participants</Label><Button type="button" size="sm" variant="outline" onClick={addP}><PlusIcon className="size-3.5" /> Add</Button></div>
                <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 text-[11px] font-medium text-muted-foreground px-0.5"><span>Name</span><span>Company</span><span>Role</span><span>Group</span><span /></div>
                {draft.participants.map((p, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-center">
                    <Input className="h-8" placeholder="Name" value={p.name} onChange={(e) => setP(i, { name: e.target.value })} />
                    <Input className="h-8" placeholder="Company" value={p.company} onChange={(e) => setP(i, { company: e.target.value })} />
                    <Input className="h-8" placeholder="Role" value={p.role} onChange={(e) => setP(i, { role: e.target.value })} />
                    <Input className="h-8" placeholder="Group" value={p.group} onChange={(e) => setP(i, { group: e.target.value })} />
                    <Button type="button" size="sm" variant="ghost" onClick={() => rmP(i)}><XIcon className="size-3.5" /></Button>
                  </div>
                ))}
              </div>

              {/* agenda */}
              <div className="grid grid-cols-[1fr_140px_110px] gap-3">
                <div className="flex flex-col gap-1.5"><Label>Agenda topic</Label><Input value={draft.agendaTopic} onChange={(e) => setDraft({ ...draft, agendaTopic: e.target.value })} placeholder="e.g. FI-Approval Workflow Enhancement" /></div>
                <div className="flex flex-col gap-1.5"><Label>Who</Label><Input value={draft.agendaWho} onChange={(e) => setDraft({ ...draft, agendaWho: e.target.value })} placeholder="All" /></div>
                <div className="flex flex-col gap-1.5"><Label>Duration</Label><Input value={draft.agendaDuration} onChange={(e) => setDraft({ ...draft, agendaDuration: e.target.value })} placeholder="1:00" /></div>
              </div>

              {/* discussion */}
              <div className="flex flex-col gap-1.5"><Label>Discussion / minutes</Label><Textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={6} maxLength={8000} placeholder="Key points discussed (one per line for bullets in the PDF)…" /></div>

              {/* next steps */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between"><Label>Next steps</Label><Button type="button" size="sm" variant="outline" onClick={addA}><PlusIcon className="size-3.5" /> Add</Button></div>
                {draft.actions.map((a, i) => (
                  <div key={i} className="grid grid-cols-[1fr_130px_130px_auto_auto] gap-2 items-center">
                    <Input className="h-8" placeholder="To discuss / do" value={a.description} onChange={(e) => setA(i, { description: e.target.value })} />
                    <OwnerCombobox value={{ owner: a.owner, ownerUserId: a.ownerUserId }} people={people} onChange={(v) => setA(i, v)} placeholder="Who" inputClassName="h-8" />
                    <Input className="h-8" type="date" value={a.dueDate} onChange={(e) => setA(i, { dueDate: e.target.value })} />
                    <label className="flex items-center gap-1 text-xs whitespace-nowrap"><input type="checkbox" className="size-3.5" checked={a.done} onChange={(e) => setA(i, { done: e.target.checked })} /> Done</label>
                    <Button type="button" size="sm" variant="ghost" onClick={() => rmA(i)}><XIcon className="size-3.5" /></Button>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter><Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
