"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { PlusIcon, PencilIcon, Trash2Icon, LayersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { createEngagementAction, updateEngagementAction, deleteEngagementAction } from "../actions";

export type Engagement = { id: string; name: string };

export function EngagementBar({ projectId, engagements, selectedId }: { projectId: string; engagements: Engagement[]; selectedId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [manage, setManage] = useState<Engagement | null>(null);
  const [renameVal, setRenameVal] = useState("");

  const selected = engagements.find((e) => e.id === selectedId) ?? null;

  function add() {
    if (!name.trim()) return toast.error("Enter a name.");
    start(async () => {
      const r = await createEngagementAction({ projectId, name: name.trim() });
      if (r.error) { toast.error(r.error); return; }
      toast.success("Engagement added.");
      setName(""); setAddOpen(false);
      if (r.id) router.push(`/delivery/${projectId}?eng=${r.id}`);
    });
  }
  function rename() {
    if (!manage) return;
    if (!renameVal.trim()) return toast.error("Enter a name.");
    start(async () => {
      const r = await updateEngagementAction({ id: manage.id, name: renameVal.trim() });
      if (r.error) toast.error(r.error);
      else { toast.success("Renamed."); setManage(null); router.refresh(); }
    });
  }
  function remove() {
    if (!manage) return;
    if (!confirm(`Delete engagement "${manage.name}"? Its status reports, plan, RAID, minutes and documents stay but move to project-level.`)) return;
    start(async () => {
      const r = await deleteEngagementAction(manage.id);
      if (r.error) toast.error(r.error);
      else { toast.success("Deleted."); setManage(null); router.push(`/delivery/${projectId}`); }
    });
  }

  const chip = (active: boolean) => cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm whitespace-nowrap", active ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground hover:bg-muted");

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground pr-1"><LayersIcon className="size-3.5" /> Engagement:</span>
      <Link href={`/delivery/${projectId}`} className={chip(selectedId === null)}>Overall</Link>
      {engagements.map((e) => (
        <Link key={e.id} href={`/delivery/${projectId}?eng=${e.id}`} className={chip(selectedId === e.id)}>{e.name}</Link>
      ))}
      <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}><PlusIcon className="size-3.5" /> Add end customer</Button>
      {selected && (
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => { setManage(selected); setRenameVal(selected.name); }}><PencilIcon className="size-3.5" /></Button>
      )}

      {addOpen && (
        <Dialog open onOpenChange={(v) => !v && setAddOpen(false)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>Add end-customer engagement</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Zambon — AP eDocument" maxLength={200} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
              <span className="text-[11px] text-muted-foreground">A cockpit-only stream — its own status, plan, RAID, minutes & documents. Never a separate project.</span>
            </div>
            <DialogFooter><Button size="sm" onClick={add} disabled={pending}>{pending ? "Adding…" : "Add"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {manage && (
        <Dialog open onOpenChange={(v) => !v && setManage(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>Engagement</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input value={renameVal} onChange={(e) => setRenameVal(e.target.value)} maxLength={200} />
            </div>
            <DialogFooter className="justify-between gap-2">
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={remove} disabled={pending}><Trash2Icon className="size-3.5" /> Delete</Button>
              <Button size="sm" onClick={rename} disabled={pending}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
