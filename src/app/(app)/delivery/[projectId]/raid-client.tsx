"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, PencilIcon, Trash2Icon, SearchIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { OwnerCombobox, type OwnerPerson } from "@/components/owner-combobox";
import { RAID_TYPE_LABEL, RAID_STATUS_LABEL, RAID_SEVERITY_LABEL } from "@/lib/delivery";
import type { RaidType, RaidStatus, RaidSeverity } from "@prisma/client";
import { createRaidItemAction, updateRaidItemAction, deleteRaidItemAction } from "../actions";

export type RaidRow = {
  id: string;
  type: RaidType;
  title: string;
  description: string | null;
  severity: RaidSeverity | null;
  status: RaidStatus;
  owner: string | null;
  ownerUserId: string | null;
  dueDate: string | null;
  response: string | null;
};

const TYPES: RaidType[] = ["RISK", "ASSUMPTION", "ISSUE", "DEPENDENCY", "DECISION"];
const STATUSES: RaidStatus[] = ["OPEN", "IN_PROGRESS", "CLOSED"];
const SEVERITIES: RaidSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const STATUS_TONE: Record<RaidStatus, "secondary" | "default" | "outline"> = { OPEN: "default", IN_PROGRESS: "secondary", CLOSED: "outline" };
const SEV_CLASS: Record<RaidSeverity, string> = {
  LOW: "text-muted-foreground", MEDIUM: "text-amber-600", HIGH: "text-orange-600", CRITICAL: "text-rose-600 font-medium",
};

type Draft = {
  id?: string;
  type: RaidType; title: string; description: string; severity: "" | RaidSeverity; status: RaidStatus; owner: string; ownerUserId: string | null; dueDate: string; response: string;
};
// New entries default to ISSUE — that is what a PM logs in the moment; the other RAID types stay a click away.
const emptyDraft = (): Draft => ({ type: "ISSUE", title: "", description: "", severity: "", status: "OPEN", owner: "", ownerUserId: null, dueDate: "", response: "" });

type StatusFilter = "OPEN_ONLY" | "ALL" | RaidStatus;

export function RaidClient({ projectId, engagementId, items, people }: { projectId: string; engagementId: string | null; items: RaidRow[]; people: OwnerPerson[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [typeFilter, setTypeFilter] = useState<"ALL" | RaidType>("ALL");
  // "Open only" by default: the log is for what still needs handling; closed items are one click away.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("OPEN_ONLY");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) =>
      (typeFilter === "ALL" || i.type === typeFilter) &&
      (statusFilter === "ALL" || (statusFilter === "OPEN_ONLY" ? i.status !== "CLOSED" : i.status === statusFilter)) &&
      (!needle || `${i.title} ${i.description ?? ""} ${i.owner ?? ""} ${i.response ?? ""} ${RAID_TYPE_LABEL[i.type]}`.toLowerCase().includes(needle)),
    );
  }, [items, typeFilter, statusFilter, q]);

  function save() {
    if (!draft) return;
    if (!draft.title.trim()) return toast.error("Enter a title.");
    const payload = {
      projectId, engagementId, type: draft.type, title: draft.title.trim(), description: draft.description || null,
      severity: draft.severity || null, status: draft.status, owner: draft.owner || null, ownerUserId: draft.ownerUserId, dueDate: draft.dueDate || null, response: draft.response || null,
    };
    start(async () => {
      const r = draft.id ? await updateRaidItemAction({ id: draft.id, ...payload }) : await createRaidItemAction(payload);
      if (r.error) toast.error(r.error);
      else { toast.success("Saved."); setDraft(null); router.refresh(); }
    });
  }
  function remove(id: string) {
    if (!confirm("Delete this RAID item?")) return;
    start(async () => {
      const r = await deleteRaidItemAction(id);
      if (r.error) toast.error(r.error);
      else { toast.success("Deleted."); router.refresh(); }
    });
  }
  function edit(i: RaidRow) {
    setDraft({ id: i.id, type: i.type, title: i.title, description: i.description ?? "", severity: i.severity ?? "", status: i.status, owner: i.owner ?? "", ownerUserId: i.ownerUserId, dueDate: i.dueDate ?? "", response: i.response ?? "" });
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">Issues <span className="font-normal text-muted-foreground">— the RAID log: risks, assumptions, issues, dependencies, decisions</span></CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search issues…" className="h-8 w-48 pl-8" />
          </div>
          <Select value={typeFilter} items={[{ value: "ALL", label: "All types" }, ...TYPES.map((t) => ({ value: t, label: RAID_TYPE_LABEL[t] }))]} onValueChange={(v) => setTypeFilter((v as typeof typeFilter) ?? "ALL")}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="ALL">All types</SelectItem>{TYPES.map((t) => <SelectItem key={t} value={t}>{RAID_TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={statusFilter} items={[{ value: "OPEN_ONLY", label: "Open only" }, { value: "ALL", label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: RAID_STATUS_LABEL[s] }))]} onValueChange={(v) => setStatusFilter((v as StatusFilter) ?? "OPEN_ONLY")}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="OPEN_ONLY">Open only</SelectItem><SelectItem value="ALL">All statuses</SelectItem>{STATUSES.map((s) => <SelectItem key={s} value={s}>{RAID_STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" onClick={() => setDraft(emptyDraft())}><PlusIcon className="size-3.5" /> Add</Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Due</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((i) => (
                <TableRow key={i.id} className="group cursor-pointer hover:bg-muted/40" onClick={() => edit(i)}>
                  <TableCell><Badge variant="outline">{RAID_TYPE_LABEL[i.type]}</Badge></TableCell>
                  <TableCell>
                    <div className="font-medium">{i.title}</div>
                    {i.description && <div className="text-xs text-muted-foreground max-w-md truncate">{i.description}</div>}
                  </TableCell>
                  <TableCell className={cn("text-sm", i.severity && SEV_CLASS[i.severity])}>{i.severity ? RAID_SEVERITY_LABEL[i.severity] : "—"}</TableCell>
                  <TableCell><Badge variant={STATUS_TONE[i.status]}>{RAID_STATUS_LABEL[i.status]}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{i.owner ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums whitespace-nowrap">{i.dueDate ?? "—"}</TableCell>
                  <TableCell className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" onClick={() => edit(i)}><PencilIcon className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => remove(i.id)} disabled={pending}><Trash2Icon className="size-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{items.length === 0 ? "No issues yet — add the first one." : statusFilter === "OPEN_ONLY" && !q ? "Nothing open. Switch the filter to see closed items." : "Nothing matches these filters."}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {draft && (
        <Dialog open onOpenChange={(v) => !v && setDraft(null)}>
          <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
            <DialogHeader><DialogTitle>{draft.id ? "Edit RAID item" : "Add RAID item"}</DialogTitle></DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5"><Label>Type</Label>
                  <Select value={draft.type} items={TYPES.map((t) => ({ value: t, label: RAID_TYPE_LABEL[t] }))} onValueChange={(v) => setDraft({ ...draft, type: (v as RaidType) ?? "RISK" })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{RAID_TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5"><Label>Status</Label>
                  <Select value={draft.status} items={STATUSES.map((s) => ({ value: s, label: RAID_STATUS_LABEL[s] }))} onValueChange={(v) => setDraft({ ...draft, status: (v as RaidStatus) ?? "OPEN" })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{RAID_STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-1.5"><Label>Title</Label><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={300} /></div>
              <div className="flex flex-col gap-1.5"><Label>Description</Label><Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={2} maxLength={4000} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1.5"><Label>Severity</Label>
                  <Select value={draft.severity || "NONE"} items={[{ value: "NONE", label: "—" }, ...SEVERITIES.map((s) => ({ value: s, label: RAID_SEVERITY_LABEL[s] }))]} onValueChange={(v) => setDraft({ ...draft, severity: v === "NONE" || !v ? "" : (v as RaidSeverity) })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="NONE">—</SelectItem>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{RAID_SEVERITY_LABEL[s]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5"><Label>Owner</Label><OwnerCombobox value={{ owner: draft.owner, ownerUserId: draft.ownerUserId }} people={people} onChange={(v) => setDraft({ ...draft, ...v })} /></div>
                <div className="flex flex-col gap-1.5"><Label>Due</Label><Input type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} /></div>
              </div>
              <div className="flex flex-col gap-1.5"><Label>Response / mitigation</Label><Textarea value={draft.response} onChange={(e) => setDraft({ ...draft, response: e.target.value })} rows={2} maxLength={4000} /></div>
            </div>
            <DialogFooter><Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
