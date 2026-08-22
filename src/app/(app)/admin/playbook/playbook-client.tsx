"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PHASES } from "@/lib/delivery";
import { createPlaybookTaskAction, updatePlaybookTaskAction, deletePlaybookTaskAction } from "./actions";

export type PlaybookRow = { id: string; phase: string; title: string; description: string | null; offsetDays: number | null; active: boolean };

type Draft = { id?: string; phase: string; title: string; description: string; offsetDays: string; active: boolean };
const emptyDraft = (): Draft => ({ phase: PHASES[0], title: "", description: "", offsetDays: "", active: true });

export function PlaybookClient({ rows }: { rows: PlaybookRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);

  function save() {
    if (!draft) return;
    if (!draft.title.trim()) return toast.error("Enter a task title.");
    const payload = {
      phase: draft.phase, title: draft.title.trim(), description: draft.description || null,
      offsetDays: draft.offsetDays === "" ? null : Number(draft.offsetDays), active: draft.active,
    };
    start(async () => {
      const r = draft.id ? await updatePlaybookTaskAction({ id: draft.id, ...payload }) : await createPlaybookTaskAction(payload);
      if (r.error) toast.error(r.error);
      else { toast.success("Saved."); setDraft(null); router.refresh(); }
    });
  }
  function remove(id: string) {
    if (!confirm("Delete this playbook task?")) return;
    start(async () => {
      const r = await deletePlaybookTaskAction(id);
      if (r.error) toast.error(r.error);
      else { toast.success("Deleted."); router.refresh(); }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Playbook tasks <span className="font-normal text-muted-foreground">({rows.length})</span></CardTitle>
        <Button size="sm" onClick={() => setDraft(emptyDraft())}><PlusIcon className="size-3.5" /> Add task</Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phase</TableHead>
                <TableHead>Task</TableHead>
                <TableHead className="text-right">Due offset</TableHead>
                <TableHead>Active</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setDraft({ id: r.id, phase: r.phase, title: r.title, description: r.description ?? "", offsetDays: r.offsetDays != null ? String(r.offsetDays) : "", active: r.active })}>
                  <TableCell><Badge variant="outline">{r.phase}</Badge></TableCell>
                  <TableCell>
                    <div className="font-medium">{r.title}</div>
                    {r.description && <div className="text-xs text-muted-foreground max-w-md truncate">{r.description}</div>}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">{r.offsetDays != null ? `+${r.offsetDays}d` : "—"}</TableCell>
                  <TableCell>{r.active ? <Badge variant="default">Active</Badge> : <Badge variant="secondary">Off</Badge>}</TableCell>
                  <TableCell className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" onClick={() => setDraft({ id: r.id, phase: r.phase, title: r.title, description: r.description ?? "", offsetDays: r.offsetDays != null ? String(r.offsetDays) : "", active: r.active })}><PencilIcon className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => remove(r.id)} disabled={pending}><Trash2Icon className="size-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No playbook tasks yet — add your first.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {draft && (
        <Dialog open onOpenChange={(v) => !v && setDraft(null)}>
          <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col overflow-hidden">
            <DialogHeader><DialogTitle>{draft.id ? "Edit playbook task" : "Add playbook task"}</DialogTitle></DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5"><Label>Phase</Label>
                  <Select value={draft.phase} items={PHASES.map((p) => ({ value: p, label: p }))} onValueChange={(v) => setDraft({ ...draft, phase: v ?? PHASES[0] })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{PHASES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5"><Label>Due offset (days from start)</Label><Input type="number" min="0" value={draft.offsetDays} onChange={(e) => setDraft({ ...draft, offsetDays: e.target.value })} placeholder="—" /></div>
              </div>
              <div className="flex flex-col gap-1.5"><Label>Task title</Label><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={300} /></div>
              <div className="flex flex-col gap-1.5"><Label>Description (optional)</Label><Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={2} maxLength={1000} /></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active (applied to new projects)</label>
            </div>
            <DialogFooter><Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
