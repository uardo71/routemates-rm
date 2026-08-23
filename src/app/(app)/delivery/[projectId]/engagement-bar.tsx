"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  PlusIcon, PencilIcon, Trash2Icon, LayersIcon, ChevronDownIcon, CheckIcon,
  ArrowUpIcon, ArrowDownIcon, Settings2Icon, XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  createEngagementAction, updateEngagementAction, deleteEngagementAction, reorderEngagementAction,
} from "../actions";

export type Engagement = { id: string; name: string };

export function EngagementBar({ projectId, engagements, selectedId }: { projectId: string; engagements: Engagement[]; selectedId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");

  const selected = engagements.find((e) => e.id === selectedId) ?? null;

  function go(id: string | null) {
    router.push(id ? `/delivery/${projectId}?eng=${id}` : `/delivery/${projectId}`);
  }

  function add() {
    if (!name.trim()) return toast.error("Enter a name.");
    start(async () => {
      const r = await createEngagementAction({ projectId, name: name.trim() });
      if (r.error) { toast.error(r.error); return; }
      toast.success("End customer added.");
      setName(""); setAddOpen(false);
      if (r.id && !manageOpen) go(r.id);
      else router.refresh();
    });
  }
  function saveRename(id: string) {
    if (!editVal.trim()) return toast.error("Enter a name.");
    start(async () => {
      const r = await updateEngagementAction({ id, name: editVal.trim() });
      if (r.error) toast.error(r.error);
      else { toast.success("Renamed."); setEditingId(null); router.refresh(); }
    });
  }
  function remove(e: Engagement) {
    if (!confirm(`Delete "${e.name}"? Its status reports, plan, RAID, minutes and documents stay but move to project-level.`)) return;
    start(async () => {
      const r = await deleteEngagementAction(e.id);
      if (r.error) toast.error(r.error);
      else {
        toast.success("Deleted.");
        if (selectedId === e.id) go(null);
        else router.refresh();
      }
    });
  }
  function reorder(id: string, direction: "up" | "down") {
    start(async () => {
      const r = await reorderEngagementAction(id, direction);
      if (r.error) toast.error(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <LayersIcon className="size-3.5" /> Viewing
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger className="flex h-9 min-w-56 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted">
          <span className="truncate">{selected ? selected.name : "Overall"}</span>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64 max-h-80 overflow-y-auto">
          <DropdownMenuItem onClick={() => go(null)} className="justify-between">
            <span>Overall</span>
            {selectedId === null && <CheckIcon className="size-4 text-primary" />}
          </DropdownMenuItem>
          {engagements.length > 0 && <DropdownMenuSeparator />}
          {engagements.map((e) => (
            <DropdownMenuItem key={e.id} onClick={() => go(e.id)} className="justify-between gap-3">
              <span className="truncate">{e.name}</span>
              {selectedId === e.id && <CheckIcon className="size-4 shrink-0 text-primary" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => { setName(""); setAddOpen(true); }} className="text-primary">
            <PlusIcon className="size-4" /> Add end customer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button size="sm" variant="ghost" className="text-muted-foreground gap-1.5" onClick={() => setManageOpen(true)}>
        <Settings2Icon className="size-3.5" /> Manage
      </Button>

      {/* Add dialog (shared by the dropdown's "Add" and the manage panel) */}
      {addOpen && (
        <Dialog open onOpenChange={(v) => !v && setAddOpen(false)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>Add end-customer engagement</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Zambon — AP eDocument" maxLength={200} autoFocus onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
              <span className="text-[11px] text-muted-foreground">A cockpit-only stream — its own status, plan, RAID, minutes &amp; documents. Never a separate project.</span>
            </div>
            <DialogFooter><Button size="sm" onClick={add} disabled={pending}>{pending ? "Adding…" : "Add"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Manage panel — rename / reorder / delete every end customer in one place */}
      {manageOpen && (
        <Dialog open onOpenChange={(v) => !v && (setManageOpen(false), setEditingId(null))}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Manage end customers</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-1 max-h-[55vh] overflow-y-auto">
              {engagements.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">No end customers yet. Add one below.</p>
              )}
              {engagements.map((e, i) => (
                <div key={e.id} className={cn("flex items-center gap-2 rounded-md border px-2 py-1.5", selectedId === e.id && "border-primary/50 bg-primary/5")}>
                  <div className="flex flex-col">
                    <button type="button" disabled={i === 0 || pending} onClick={() => reorder(e.id, "up")} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUpIcon className="size-3.5" /></button>
                    <button type="button" disabled={i === engagements.length - 1 || pending} onClick={() => reorder(e.id, "down")} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDownIcon className="size-3.5" /></button>
                  </div>
                  {editingId === e.id ? (
                    <>
                      <Input value={editVal} onChange={(ev) => setEditVal(ev.target.value)} maxLength={200} autoFocus className="h-8 flex-1" onKeyDown={(ev) => { if (ev.key === "Enter") saveRename(e.id); if (ev.key === "Escape") setEditingId(null); }} />
                      <Button size="sm" onClick={() => saveRename(e.id)} disabled={pending}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}><XIcon className="size-3.5" /></Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 truncate text-sm">{e.name}</span>
                      <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => { setEditingId(e.id); setEditVal(e.name); }}><PencilIcon className="size-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => remove(e)} disabled={pending}><Trash2Icon className="size-3.5" /></Button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <DialogFooter className="border-t pt-3">
              <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => { setName(""); setAddOpen(true); }}><PlusIcon className="size-3.5" /> Add end customer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
