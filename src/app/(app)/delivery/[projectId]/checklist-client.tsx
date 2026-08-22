"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PHASES } from "@/lib/delivery";
import { toggleChecklistItemAction, addChecklistItemAction, deleteChecklistItemAction } from "../actions";

export type ChecklistRow = {
  id: string;
  phase: string;
  title: string;
  done: boolean;
  dueDate: string | null;
  completedByName: string | null;
  completedAt: string | null;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export function ChecklistClient({ projectId, items }: { projectId: string; items: ChecklistRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [newPhase, setNewPhase] = useState<string>(PHASES[0]);
  const [newTitle, setNewTitle] = useState("");
  const [newDue, setNewDue] = useState("");

  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const phases = [...PHASES, ...items.map((i) => i.phase).filter((p) => !PHASES.includes(p as (typeof PHASES)[number]))];
  const uniquePhases = [...new Set(phases)];

  function toggle(id: string, done: boolean) {
    start(async () => {
      const r = await toggleChecklistItemAction(id, done);
      if (r.error) toast.error(r.error);
      else router.refresh();
    });
  }
  function add() {
    if (!newTitle.trim()) return toast.error("Enter a task title.");
    start(async () => {
      const r = await addChecklistItemAction({ projectId, phase: newPhase, title: newTitle.trim(), dueDate: newDue || null });
      if (r.error) toast.error(r.error);
      else { toast.success("Task added."); setNewTitle(""); setNewDue(""); setAdding(false); router.refresh(); }
    });
  }
  function remove(id: string) {
    if (!confirm("Delete this checklist item?")) return;
    start(async () => {
      const r = await deleteChecklistItemAction(id);
      if (r.error) toast.error(r.error);
      else { toast.success("Deleted."); router.refresh(); }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex-1">
            <CardTitle className="text-base">Playbook checklist</CardTitle>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-2 flex-1 max-w-xs rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-sm tabular-nums text-muted-foreground">{done}/{total} · {pct}%</span>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}><PlusIcon className="size-3.5" /> Add task</Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {adding && (
            <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3">
              <div className="flex flex-col gap-1.5">
                <Label>Phase</Label>
                <Select value={newPhase} items={PHASES.map((p) => ({ value: p, label: p }))} onValueChange={(v) => setNewPhase(v ?? PHASES[0])}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>{PHASES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5 flex-1 min-w-52"><Label>Task</Label><Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="What needs doing" maxLength={300} /></div>
              <div className="flex flex-col gap-1.5"><Label>Due (optional)</Label><Input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} /></div>
              <Button size="sm" onClick={add} disabled={pending}>Add</Button>
            </div>
          )}

          {uniquePhases.map((phase) => {
            const group = items.filter((i) => i.phase === phase);
            if (group.length === 0) return null;
            return (
              <div key={phase} className="flex flex-col gap-1.5">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{phase}</div>
                {group.map((i) => {
                  const overdue = !i.done && i.dueDate != null && i.dueDate < todayIso();
                  return (
                    <div key={i.id} className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40">
                      <input type="checkbox" className="size-4 shrink-0" checked={i.done} disabled={pending} onChange={(e) => toggle(i.id, e.target.checked)} />
                      <span className={cn("flex-1 text-sm", i.done && "text-muted-foreground line-through")}>{i.title}</span>
                      {i.dueDate && <span className={cn("text-xs tabular-nums", overdue ? "text-destructive font-medium" : "text-muted-foreground")}>{overdue ? "overdue · " : "due "}{i.dueDate}</span>}
                      <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive" onClick={() => remove(i.id)} disabled={pending} aria-label="Delete"><Trash2Icon className="size-3.5" /></Button>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {items.length === 0 && <p className="text-sm text-muted-foreground">No checklist yet — add tasks, or they appear automatically from the company playbook on new projects.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
