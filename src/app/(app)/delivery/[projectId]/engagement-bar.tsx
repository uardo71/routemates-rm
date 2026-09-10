"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  PlusIcon, PencilIcon, Trash2Icon, LayersIcon, ChevronDownIcon, CheckIcon,
  ArrowUpIcon, ArrowDownIcon, Settings2Icon, XIcon, UsersIcon, CheckCircle2Icon, RotateCcwIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { InitialsAvatar } from "@/components/initials-avatar";
import { cn } from "@/lib/utils";
import {
  createEngagementAction, updateEngagementAction, deleteEngagementAction, reorderEngagementAction, setEngagementMembersAction, setEngagementStatusAction, setProjectOverallTrackingAction,
} from "../actions";

export type Person = { id: string; name: string };
export type Engagement = { id: string; name: string; members: Person[]; status: "ACTIVE" | "COMPLETED" };

export function EngagementBar({ projectId, engagements, staff, selectedId, keepParams, trackOverall }: { projectId: string; engagements: Engagement[]; staff: Person[]; selectedId: string | null; keepParams?: Record<string, string>; trackOverall: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [addMembers, setAddMembers] = useState<string[]>([]);
  const [manageOpen, setManageOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [peopleFor, setPeopleFor] = useState<Engagement | null>(null);
  const [peopleSel, setPeopleSel] = useState<string[]>([]);

  const selected = engagements.find((e) => e.id === selectedId) ?? null;

  function go(id: string | null) {
    // Query params such as ?from=portfolio survive switching end customer, so the back link holds.
    const p = new URLSearchParams(keepParams ?? {});
    if (id) p.set("eng", id);
    router.push(`/delivery/${projectId}${p.size ? `?${p.toString()}` : ""}`);
  }

  function add() {
    if (!name.trim()) return toast.error("Enter a name.");
    start(async () => {
      const r = await createEngagementAction({ projectId, name: name.trim(), memberIds: addMembers });
      if (r.error) { toast.error(r.error); return; }
      toast.success("End customer added.");
      setName(""); setAddMembers([]); setAddOpen(false);
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
    if (!confirm(`Delete "${e.name}"? Its status reports, plan, RAID, minutes, documents, cutover plans and UAT scripts stay but move to project-level.`)) return;
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
  function openPeople(e: Engagement) {
    setPeopleFor(e);
    setPeopleSel(e.members.map((m) => m.id));
  }
  function savePeople() {
    if (!peopleFor) return;
    start(async () => {
      const r = await setEngagementMembersAction({ engagementId: peopleFor.id, userIds: peopleSel });
      if (r.error) toast.error(r.error);
      else { toast.success("People updated."); setPeopleFor(null); router.refresh(); }
    });
  }
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  function setStatus(e: Engagement, status: "ACTIVE" | "COMPLETED") {
    if (status === "COMPLETED" && !confirm(`Mark "${e.name}" as completed? It stops asking for status updates and drops out of the day path; the project itself stays as it is.`)) return;
    start(async () => {
      const r = await setEngagementStatusAction({ id: e.id, status });
      if (r.error) toast.error(r.error);
      else { toast.success(status === "COMPLETED" ? "Marked completed." : "Reopened."); router.refresh(); }
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
              <span className={cn("truncate", e.status === "COMPLETED" && "text-muted-foreground")}>{e.name}{e.status === "COMPLETED" && <span className="ml-1.5 text-[10px] uppercase tracking-wide">done</span>}</span>
              <span className="flex items-center gap-1.5">
                {e.members.length > 0 && <span className="text-[11px] text-muted-foreground">{e.members.length}<UsersIcon className="ml-0.5 inline size-3" /></span>}
                {selectedId === e.id && <CheckIcon className="size-4 shrink-0 text-primary" />}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => { setName(""); setAddMembers([]); setAddOpen(true); }} className="text-primary">
            <PlusIcon className="size-4" /> Add end customer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Who works this end customer — shown inline so the PM sees the team at a glance. */}
      {selected && (
        <button
          type="button"
          onClick={() => openPeople(selected)}
          className="flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
          title="Assign people to this end customer"
        >
          {selected.members.length === 0 ? (
            <><UsersIcon className="size-3.5" /> Assign people</>
          ) : (
            <>
              <span className="flex -space-x-1.5">
                {selected.members.slice(0, 5).map((m) => <InitialsAvatar key={m.id} name={m.name} className="size-5 text-[9px] ring-2 ring-background" />)}
              </span>
              <span>{selected.members.length === 1 ? selected.members[0].name : `${selected.members.length} people`}</span>
            </>
          )}
        </button>
      )}

      {selected && (
        selected.status === "COMPLETED" ? (
          <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={() => setStatus(selected, "ACTIVE")} disabled={pending} title="Reopen this end customer">
            <RotateCcwIcon className="size-3.5" /> Reopen
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={() => setStatus(selected, "COMPLETED")} disabled={pending} title="Mark this end customer completed — the project stays open">
            <CheckCircle2Icon className="size-3.5" /> Mark completed
          </Button>
        )
      )}

      <Button size="sm" variant="ghost" className="text-muted-foreground gap-1.5" onClick={() => setManageOpen(true)}>
        <Settings2Icon className="size-3.5" /> Manage
      </Button>

      {/* Add dialog (shared by the dropdown's "Add" and the manage panel) */}
      {addOpen && (
        <Dialog open onOpenChange={(v) => !v && setAddOpen(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Add end-customer engagement</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Zambon — AP eDocument" maxLength={200} autoFocus onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
                <span className="text-[11px] text-muted-foreground">A cockpit-only stream — its own status, plan, RAID, minutes, documents, cutover plans &amp; UAT scripts. Never a separate project.</span>
              </div>
              <PeoplePicker staff={staff} selected={addMembers} onToggle={(id) => setAddMembers((l) => toggle(l, id))} />
            </div>
            <DialogFooter><Button size="sm" onClick={add} disabled={pending}>{pending ? "Adding…" : "Add"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* People dialog — assign staff to one end customer */}
      {peopleFor && (
        <Dialog open onOpenChange={(v) => !v && setPeopleFor(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>People on {peopleFor.name}</DialogTitle></DialogHeader>
            <PeoplePicker staff={staff} selected={peopleSel} onToggle={(id) => setPeopleSel((l) => toggle(l, id))} />
            <DialogFooter>
              <Button size="sm" onClick={savePeople} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Manage panel — rename / reorder / people / delete every end customer in one place */}
      {manageOpen && (
        <Dialog open onOpenChange={(v) => !v && (setManageOpen(false), setEditingId(null))}>
          <DialogContent className="sm:max-w-lg">
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
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm">{e.name}{e.status === "COMPLETED" && <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Completed</span>}</span>
                        <span className="truncate text-[11px] text-muted-foreground">{e.members.length === 0 ? "Nobody assigned" : e.members.map((m) => m.name).join(", ")}</span>
                      </div>
                      <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setStatus(e, e.status === "COMPLETED" ? "ACTIVE" : "COMPLETED")} disabled={pending} title={e.status === "COMPLETED" ? "Reopen" : "Mark completed"}>{e.status === "COMPLETED" ? <RotateCcwIcon className="size-3.5" /> : <CheckCircle2Icon className="size-3.5" />}</Button>
                      <Button size="sm" variant="ghost" className="gap-1 text-muted-foreground" onClick={() => openPeople(e)} title="Assign people"><UsersIcon className="size-3.5" />{e.members.length > 0 && <span className="text-xs">{e.members.length}</span>}</Button>
                      <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => { setEditingId(e.id); setEditVal(e.name); }}><PencilIcon className="size-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => remove(e)} disabled={pending}><Trash2Icon className="size-3.5" /></Button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <DialogFooter className="flex-col items-stretch gap-3 border-t pt-3 sm:flex-col">
              {engagements.length > 0 && (
                <label className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-xs">
                  <input
                    type="checkbox" className="mt-0.5 accent-primary" checked={trackOverall} disabled={pending}
                    onChange={(e) => start(async () => { const r = await setProjectOverallTrackingAction(projectId, e.target.checked); if (r.error) toast.error(r.error); else { toast.success(e.target.checked ? "Programme-level status is now tracked." : "Programme-level status is no longer tracked."); router.refresh(); } })}
                  />
                  <span>
                    <span className="font-medium">Track status at programme level</span>
                    <span className="block text-muted-foreground">Chase status updates for the &quot;Overall&quot; scope too, not just per end customer. Off by default.</span>
                  </span>
                </label>
              )}
              <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => { setName(""); setAddMembers([]); setAddOpen(true); }}><PlusIcon className="size-3.5" /> Add end customer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function PeoplePicker({ staff, selected, onToggle }: { staff: Person[]; selected: string[]; onToggle: (id: string) => void }) {
  const [q, setQ] = useState("");
  const shown = staff.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="flex flex-col gap-1.5">
      <Label>People</Label>
      <span className="text-[11px] text-muted-foreground">
        Assigned people get access to this end customer&apos;s cutover plans and UAT scripts in the cockpit tools — and, if they are not on the whole project, see only this end customer.
      </span>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search staff…" className="h-8" />
      <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-md border p-1">
        {shown.length === 0 && <span className="px-2 py-3 text-center text-xs text-muted-foreground">No one matches.</span>}
        {shown.map((s) => {
          const on = selected.includes(s.id);
          return (
            <label key={s.id} className={cn("flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted", on && "bg-primary/5")}>
              <input type="checkbox" checked={on} onChange={() => onToggle(s.id)} className="size-3.5 accent-primary" />
              <InitialsAvatar name={s.name} className="size-5 text-[9px]" />
              <span className="truncate">{s.name}</span>
              {on && <CheckIcon className="ml-auto size-3.5 text-primary" />}
            </label>
          );
        })}
      </div>
      {selected.length > 0 && <span className="text-[11px] text-muted-foreground">{selected.length} selected</span>}
    </div>
  );
}
