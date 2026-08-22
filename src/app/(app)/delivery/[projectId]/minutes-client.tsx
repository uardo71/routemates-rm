"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, PencilIcon, Trash2Icon, XIcon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { createMeetingAction, updateMeetingAction, deleteMeetingAction } from "../actions";

export type MinutesAction = { description: string; owner: string | null; dueDate: string | null; done: boolean };
export type MinutesRow = {
  id: string;
  date: string;
  title: string;
  attendees: string | null;
  notes: string | null;
  createdByName: string;
  actions: MinutesAction[];
};

const todayIso = () => new Date().toISOString().slice(0, 10);

type DraftAction = { description: string; owner: string; dueDate: string; done: boolean };
type Draft = { id?: string; date: string; title: string; attendees: string; notes: string; actions: DraftAction[] };
const emptyDraft = (): Draft => ({ date: todayIso(), title: "", attendees: "", notes: "", actions: [] });

export function MinutesClient({ projectId, engagementId, items }: { projectId: string; engagementId: string | null; items: MinutesRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);

  function save() {
    if (!draft) return;
    if (!draft.title.trim()) return toast.error("Enter a meeting title.");
    const actions = draft.actions.filter((a) => a.description.trim()).map((a) => ({ description: a.description.trim(), owner: a.owner || null, dueDate: a.dueDate || null, done: a.done }));
    const payload = { projectId, engagementId, date: draft.date, title: draft.title.trim(), attendees: draft.attendees || null, notes: draft.notes || null, actions };
    start(async () => {
      const r = draft.id ? await updateMeetingAction({ id: draft.id, ...payload }) : await createMeetingAction(payload);
      if (r.error) toast.error(r.error);
      else { toast.success("Saved."); setDraft(null); router.refresh(); }
    });
  }
  function edit(m: MinutesRow) {
    setDraft({ id: m.id, date: m.date, title: m.title, attendees: m.attendees ?? "", notes: m.notes ?? "", actions: m.actions.map((a) => ({ description: a.description, owner: a.owner ?? "", dueDate: a.dueDate ?? "", done: a.done })) });
  }
  function remove(id: string) {
    if (!confirm("Delete these minutes?")) return;
    start(async () => { const r = await deleteMeetingAction(id); if (r.error) toast.error(r.error); else { toast.success("Deleted."); router.refresh(); } });
  }
  const setAction = (i: number, patch: Partial<DraftAction>) => setDraft((d) => (d ? { ...d, actions: d.actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)) } : d));
  const addAction = () => setDraft((d) => (d ? { ...d, actions: [...d.actions, { description: "", owner: "", dueDate: "", done: false }] } : d));
  const removeAction = (i: number) => setDraft((d) => (d ? { ...d, actions: d.actions.filter((_, idx) => idx !== i) } : d));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Capture meeting minutes — attendees, notes, and action items — searchable over time.</p>
        <Button size="sm" onClick={() => setDraft(emptyDraft())}><PlusIcon className="size-3.5" /> New minutes</Button>
      </div>

      {items.length === 0 && <Card><CardContent className="py-10 text-center text-muted-foreground">No minutes yet.</CardContent></Card>}

      {items.map((m) => (
        <Card key={m.id}>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">{m.title} <span className="font-normal text-muted-foreground text-sm">· {m.date}</span></CardTitle>
              {m.attendees && <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><UsersIcon className="size-3.5" /> {m.attendees}</div>}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button size="sm" variant="outline" onClick={() => edit(m)}><PencilIcon className="size-3.5" /></Button>
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => remove(m.id)} disabled={pending}><Trash2Icon className="size-3.5" /></Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {m.notes && <p className="whitespace-pre-wrap">{m.notes}</p>}
            {m.actions.length > 0 && (
              <div>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Action items</span>
                <ul className="mt-1 flex flex-col gap-1">
                  {m.actions.map((a, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={cn("mt-0.5 text-xs", a.done ? "text-emerald-600" : "text-muted-foreground")}>{a.done ? "✓" : "○"}</span>
                      <span className={cn(a.done && "text-muted-foreground line-through")}>{a.description}{a.owner ? ` — ${a.owner}` : ""}{a.dueDate ? ` (by ${a.dueDate})` : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="text-xs text-muted-foreground">by {m.createdByName}</div>
          </CardContent>
        </Card>
      ))}

      {draft && (
        <Dialog open onOpenChange={(v) => !v && setDraft(null)}>
          <DialogContent className="sm:max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
            <DialogHeader><DialogTitle>{draft.id ? "Edit minutes" : "New minutes"}</DialogTitle></DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1">
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1.5"><Label>Date</Label><Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></div>
                <div className="flex flex-col gap-1.5 col-span-2"><Label>Title</Label><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={300} placeholder="e.g. Weekly status call" /></div>
              </div>
              <div className="flex flex-col gap-1.5"><Label>Attendees</Label><Input value={draft.attendees} onChange={(e) => setDraft({ ...draft, attendees: e.target.value })} maxLength={2000} placeholder="Names, comma-separated" /></div>
              <div className="flex flex-col gap-1.5"><Label>Notes</Label><Textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={6} maxLength={8000} /></div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between"><Label>Action items</Label><Button type="button" size="sm" variant="outline" onClick={addAction}><PlusIcon className="size-3.5" /> Add</Button></div>
                {draft.actions.map((a, i) => (
                  <div key={i} className="grid grid-cols-[1fr_120px_130px_auto_auto] gap-2 items-center">
                    <Input placeholder="Action" value={a.description} onChange={(e) => setAction(i, { description: e.target.value })} />
                    <Input placeholder="Owner" value={a.owner} onChange={(e) => setAction(i, { owner: e.target.value })} />
                    <Input type="date" value={a.dueDate} onChange={(e) => setAction(i, { dueDate: e.target.value })} />
                    <label className="flex items-center gap-1 text-xs whitespace-nowrap"><input type="checkbox" className="size-3.5" checked={a.done} onChange={(e) => setAction(i, { done: e.target.checked })} /> Done</label>
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeAction(i)}><XIcon className="size-3.5" /></Button>
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
