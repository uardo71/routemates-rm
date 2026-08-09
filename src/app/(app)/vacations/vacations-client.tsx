"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format, addDays } from "date-fns";
import { PlusIcon } from "lucide-react";
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
import { countWorkingDays } from "@/lib/vacation-calc";
import { getPublicHoliday } from "@/lib/holidays";
import {
  requestVacationAction,
  decideVacationAction,
  cancelVacationAction,
  recordLeaveReturnAction,
  type RequestVacationInput,
} from "./actions";

export type VacationStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type LeaveType = "VACATION" | "SICK" | "PATERNITY" | "MATERNITY";
export type VacationRequestRow = {
  id: string;
  userId: string;
  userName: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  workingDays: number;
  status: VacationStatus;
  reason: string | null;
  requestedByName: string;
  decidedByName: string | null;
  decidedAt: string | null;
  comment: string | null;
  canCancel: boolean;
  returns: { startDate: string; endDate: string; workingDays: number }[];
};
export type PersonOption = { id: string; name: string };
export type ProjectOption = { id: string; name: string };
export type BalanceRow = { userId: string; userName: string; balance: number; sickDaysThisYear: number };
export type OwnBalance = { year: number; entitlement: number; carriedIn: number; taken: number; balance: number };

const STATUS_TONE: Record<VacationStatus, "secondary" | "default" | "destructive" | "outline"> = {
  PENDING: "secondary",
  APPROVED: "default",
  REJECTED: "destructive",
  CANCELLED: "outline",
};

/** Formats a date range, always showing the end year and the start year too whenever it
 *  differs (e.g. maternity/paternity leave routinely spans a year boundary) — omitting the
 *  start year unconditionally made a range like "Jan 1, 2026 – Jan 3, 2027" misleadingly read
 *  as "Jan 1 – Jan 3, 2027" (both in 2027). */
function formatLeavePeriod(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const startFmt = start.getFullYear() === end.getFullYear() ? "MMM d" : "MMM d, yyyy";
  return `${format(start, startFmt)} – ${format(end, "MMM d, yyyy")}`;
}

const LEAVE_TYPES: LeaveType[] = ["VACATION", "SICK", "PATERNITY", "MATERNITY"];
const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  VACATION: "Vacation",
  SICK: "Sick leave",
  PATERNITY: "Paternity leave",
  MATERNITY: "Maternity / pregnancy leave",
};
// Only VACATION has a balance to run against — SICK is uncapped/self-certified, PATERNITY and
// MATERNITY are a one-time period per childbirth event with no annual quota at all.
const LEAVE_TYPE_HINT: Record<LeaveType, string> = {
  VACATION: "Counted against your vacation balance below.",
  SICK: "No quota — every approved sick day is simply logged.",
  PATERNITY: "One-time leave for a childbirth event — no annual quota.",
  MATERNITY: "One-time leave for a childbirth event — no annual quota.",
};

function BalanceCard({ title, balance, sickDaysThisYear }: { title: string; balance: OwnBalance; sickDaysThisYear: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-6 text-sm">
        <div>
          <div className="text-xs text-muted-foreground uppercase">Carried in</div>
          <div className="text-lg font-semibold tabular-nums">{balance.carriedIn}d</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase">{balance.year} entitlement</div>
          <div className="text-lg font-semibold tabular-nums">{balance.entitlement}d</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase">Taken this year</div>
          <div className="text-lg font-semibold tabular-nums">{balance.taken}d</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase">Available now</div>
          <div className="text-lg font-semibold tabular-nums text-primary">{balance.balance}d</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase">Sick days this year</div>
          <div className="text-lg font-semibold tabular-nums">{sickDaysThisYear}d</div>
        </div>
      </CardContent>
    </Card>
  );
}

function RequestDialog({
  open,
  onOpenChange,
  canManage,
  people,
  projects,
  callerId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canManage: boolean;
  people: PersonOption[];
  projects: ProjectOption[];
  callerId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<LeaveType>("VACATION");
  const [userId, setUserId] = useState(callerId);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [projectId, setProjectId] = useState("");

  // -1 is the "invalid or too-large range" sentinel from countWorkingDays — a mid-typo date
  // (e.g. a garbled year while still editing the native date input) can momentarily produce a
  // multi-century range, and this preview must never try to loop through that.
  const workingDays = useMemo(() => {
    if (!startDate || !endDate) return 0;
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 0;
    return countWorkingDays(s, e);
  }, [startDate, endDate]);

  // Holidays inside the picked range don't count against the balance (see the working-day
  // count above) — surfaced here so it's obvious which specific days those are. Bails out on
  // the same invalid/too-large range as workingDays, for the same reason.
  const holidaysInRange = useMemo(() => {
    if (!startDate || !endDate || workingDays < 0) return [];
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return [];
    const found: { date: string; name: string }[] = [];
    for (let d = s; d <= e; d = addDays(d, 1)) {
      const holiday = getPublicHoliday(d);
      if (holiday) found.push({ date: format(d, "MMM d"), name: holiday });
    }
    return found;
  }, [startDate, endDate, workingDays]);

  function reset() {
    setType("VACATION");
    setUserId(callerId);
    setStartDate("");
    setEndDate("");
    setReason("");
    setProjectId("");
  }

  function submit() {
    if (!startDate || !endDate) {
      toast.error("Pick a start and end date.");
      return;
    }
    if (workingDays < 0) {
      toast.error("That date range looks invalid or too large — double-check the dates.");
      return;
    }
    if (canManage && !projectId) {
      toast.error("Pick an internal project to track these days under.");
      return;
    }
    const input: RequestVacationInput = {
      type,
      startDate,
      endDate,
      reason: reason || undefined,
      userId: canManage ? userId : undefined,
      projectId: canManage ? projectId : undefined,
    };
    startTransition(async () => {
      const result = await requestVacationAction(input);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(canManage ? `${LEAVE_TYPE_LABEL[type]} recorded and approved.` : `${LEAVE_TYPE_LABEL[type]} requested — awaiting admin approval.`);
        reset();
        onOpenChange(false);
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{canManage ? "Record leave" : "Request leave"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vac-type">Type</Label>
            <Select value={type} items={LEAVE_TYPES.map((t) => ({ value: t, label: LEAVE_TYPE_LABEL[t] }))} onValueChange={(v) => setType((v as LeaveType) ?? "VACATION")}>
              <SelectTrigger id="vac-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAVE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {LEAVE_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{LEAVE_TYPE_HINT[type]}</p>
          </div>
          {canManage && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vac-person">Person</Label>
              <Select
                value={userId}
                items={people.map((p) => ({ value: p.id, label: p.id === callerId ? `${p.name} (me)` : p.name }))}
                onValueChange={(v) => setUserId(v ?? "")}
              >
                <SelectTrigger id="vac-person" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.id === callerId ? `${p.name} (me)` : p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vac-start">Start date</Label>
              <Input id="vac-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vac-end">End date</Label>
              <Input id="vac-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <p className={cn("text-xs", workingDays < 0 ? "text-destructive" : "text-muted-foreground")}>
            {!startDate || !endDate
              ? "Pick both dates to see the working-day count."
              : workingDays < 0
                ? "That date range looks invalid or too large — double-check the dates."
                : `${workingDays} working day${workingDays === 1 ? "" : "s"} (weekends and Albanian public holidays excluded).`}
          </p>
          {holidaysInRange.length > 0 && (
            <p className="text-xs text-muted-foreground">
              🇦🇱 Includes {holidaysInRange.length} public holiday{holidaysInRange.length === 1 ? "" : "s"}:{" "}
              {holidaysInRange.map((h) => `${h.date} (${h.name})`).join(", ")}
            </p>
          )}
          {canManage && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vac-project">Internal project</Label>
              <Select value={projectId} items={projects.map((p) => ({ value: p.id, label: p.name }))} onValueChange={(v) => setProjectId(v ?? "")}>
                <SelectTrigger id="vac-project" className="w-full">
                  <SelectValue placeholder={projects.length === 0 ? "No internal projects yet" : "Select a project"} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {projects.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Create a project and check &quot;Internal&quot; on it first — that&apos;s where these days get tracked.
                </p>
              )}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vac-reason">Reason (optional)</Label>
            <Textarea id="vac-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" onClick={submit} disabled={pending}>
            {pending ? "Saving..." : canManage ? "Record & approve" : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecisionDialog({
  request,
  onOpenChange,
  projects,
  onDecided,
}: {
  request: VacationRequestRow | null;
  onOpenChange: (v: boolean) => void;
  projects: ProjectOption[];
  onDecided: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState("");
  const [comment, setComment] = useState("");

  function decide(decision: "APPROVE" | "REJECT") {
    if (!request) return;
    if (decision === "APPROVE" && !projectId) {
      toast.error("Pick an internal project to track these days under.");
      return;
    }
    startTransition(async () => {
      const result = await decideVacationAction({
        requestId: request.id,
        decision,
        projectId: decision === "APPROVE" ? projectId : undefined,
        comment: comment || undefined,
      });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(decision === "APPROVE" ? "Approved and provisioned." : "Rejected.");
        setProjectId("");
        setComment("");
        onDecided();
      }
    });
  }

  return (
    <Dialog open={request !== null} onOpenChange={(v) => { onOpenChange(v); if (!v) { setProjectId(""); setComment(""); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {request?.userName}
            {request && <Badge variant="secondary">{LEAVE_TYPE_LABEL[request.type]}</Badge>}
            {request && ` — ${formatLeavePeriod(request.startDate, request.endDate)}`}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {request?.workingDays} working day{request?.workingDays === 1 ? "" : "s"}
            {request?.reason ? ` — "${request.reason}"` : ""}
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="decide-project">Internal project (required to approve)</Label>
            <Select value={projectId} items={projects.map((p) => ({ value: p.id, label: p.name }))} onValueChange={(v) => setProjectId(v ?? "")}>
              <SelectTrigger id="decide-project" className="w-full">
                <SelectValue placeholder={projects.length === 0 ? "No internal projects yet" : "Select a project"} />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="decide-comment">Comment (optional)</Label>
            <Textarea id="decide-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={500} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button size="sm" variant="destructive" onClick={() => decide("REJECT")} disabled={pending}>
            Reject
          </Button>
          <Button size="sm" onClick={() => decide("APPROVE")} disabled={pending}>
            {pending ? "Saving..." : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReturnDialog({
  request,
  onOpenChange,
  onRecorded,
}: {
  request: VacationRequestRow | null;
  onOpenChange: (v: boolean) => void;
  onRecorded: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Bounded to the leave's own range — same invalid/too-large-range sentinel handling as the
  // request dialog's preview.
  const workingDays = useMemo(() => {
    if (!startDate || !endDate) return 0;
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 0;
    return countWorkingDays(s, e);
  }, [startDate, endDate]);

  function reset() {
    setStartDate("");
    setEndDate("");
  }

  function submit() {
    if (!request) return;
    if (!startDate || !endDate) {
      toast.error("Pick a start and end date.");
      return;
    }
    if (workingDays < 0) {
      toast.error("That date range looks invalid or too large — double-check the dates.");
      return;
    }
    startTransition(async () => {
      const result = await recordLeaveReturnAction({ leaveRequestId: request.id, startDate, endDate });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Recorded ${workingDays} returned day${workingDays === 1 ? "" : "s"}.`);
        reset();
        onRecorded();
      }
    });
  }

  return (
    <Dialog open={request !== null} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record return to work</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {request?.userName} — {request && LEAVE_TYPE_LABEL[request.type]}, originally{" "}
            {request && formatLeavePeriod(request.startDate, request.endDate)}.
            Covers coming back early for good, or just for a few days before going back out — either way, pick the range
            they&apos;re actually working.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ret-start">Back to work from</Label>
              <Input
                id="ret-start"
                type="date"
                min={request?.startDate}
                max={request?.endDate}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ret-end">Through</Label>
              <Input
                id="ret-end"
                type="date"
                min={request?.startDate}
                max={request?.endDate}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <p className={cn("text-xs", workingDays < 0 ? "text-destructive" : "text-muted-foreground")}>
            {!startDate || !endDate
              ? "Pick both dates — this range gets removed from Planning/Time Entry and, for vacation, given back to the balance."
              : workingDays < 0
                ? "That date range looks invalid or too large — double-check the dates."
                : `${workingDays} working day${workingDays === 1 ? "" : "s"} will be un-provisioned.`}
          </p>
          {request && request.returns.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Already recorded: {request.returns.map((r) => `${formatLeavePeriod(r.startDate, r.endDate)} (${r.workingDays}d)`).join(", ")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" onClick={submit} disabled={pending}>
            {pending ? "Saving..." : "Record return"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function VacationsClient({
  callerId,
  canManage,
  canViewAll,
  rows,
  people,
  projects,
  balances,
  ownBalance,
  ownSickDaysThisYear,
}: {
  callerId: string;
  canManage: boolean;
  canViewAll: boolean;
  rows: VacationRequestRow[];
  people: PersonOption[];
  projects: ProjectOption[];
  balances: BalanceRow[];
  ownBalance: OwnBalance;
  ownSickDaysThisYear: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [requestOpen, setRequestOpen] = useState(false);
  const [deciding, setDeciding] = useState<VacationRequestRow | null>(null);
  const [returning, setReturning] = useState<VacationRequestRow | null>(null);

  const pendingRows = rows.filter((r) => r.status === "PENDING");

  function cancel(id: string) {
    if (!confirm("Cancel this leave request?")) return;
    startTransition(async () => {
      const result = await cancelVacationAction(id);
      if (result.error) toast.error(result.error);
      else {
        toast.success("Cancelled.");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-4">
        <BalanceCard title="Your balance" balance={ownBalance} sickDaysThisYear={ownSickDaysThisYear} />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{canViewAll ? "Requests" : "Your requests"}</h2>
        <Button size="sm" onClick={() => setRequestOpen(true)}>
          <PlusIcon /> {canManage ? "Record leave" : "Request leave"}
        </Button>
      </div>

      {canManage && pendingRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending approval ({pendingRows.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Requested by</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingRows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setDeciding(r)}>
                    <TableCell className="font-medium">{r.userName}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{LEAVE_TYPE_LABEL[r.type]}</Badge>
                    </TableCell>
                    <TableCell>{formatLeavePeriod(r.startDate, r.endDate)}</TableCell>
                    <TableCell>{r.workingDays}d</TableCell>
                    <TableCell>{r.requestedByName}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setDeciding(r); }}>
                        Decide
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {canManage && balances.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Balances</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Vacation balance</TableHead>
                  <TableHead>Sick days (this year)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balances.map((b) => (
                  <TableRow key={b.userId}>
                    <TableCell className="font-medium">{b.userName}</TableCell>
                    <TableCell className="tabular-nums">{b.balance}d</TableCell>
                    <TableCell className="tabular-nums">{b.sickDaysThisYear}d</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                {canViewAll && <TableHead>Person</TableHead>}
                <TableHead>Type</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Days</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested by</TableHead>
                <TableHead>Decided by</TableHead>
                <TableHead>Comment</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  {canViewAll && <TableCell className="font-medium">{r.userName}</TableCell>}
                  <TableCell>
                    <Badge variant="secondary">{LEAVE_TYPE_LABEL[r.type]}</Badge>
                  </TableCell>
                  <TableCell>
                    <div>{formatLeavePeriod(r.startDate, r.endDate)}</div>
                    {r.returns.length > 0 && (
                      <div
                        className="text-[11px] text-muted-foreground"
                        title={r.returns.map((ret) => `${formatLeavePeriod(ret.startDate, ret.endDate)} (${ret.workingDays}d)`).join(", ")}
                      >
                        ↩ {r.returns.reduce((sum, ret) => sum + ret.workingDays, 0)}d returned
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{r.workingDays}d</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_TONE[r.status]}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.requestedByName}</TableCell>
                  <TableCell className="text-muted-foreground">{r.decidedByName ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground max-w-48 truncate" title={r.comment ?? undefined}>
                    {r.comment ?? "—"}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {canManage && r.status === "APPROVED" && (
                      <Button size="sm" variant="ghost" onClick={() => setReturning(r)}>
                        Record return
                      </Button>
                    )}
                    {r.canCancel && (
                      <Button size="sm" variant="ghost" onClick={() => cancel(r.id)} disabled={pending}>
                        Cancel
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canViewAll ? 9 : 8} className="text-center text-muted-foreground">
                    No leave requests yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <RequestDialog open={requestOpen} onOpenChange={setRequestOpen} canManage={canManage} people={people} projects={projects} callerId={callerId} />
      <DecisionDialog
        request={deciding}
        onOpenChange={(v) => !v && setDeciding(null)}
        projects={projects}
        onDecided={() => {
          setDeciding(null);
          router.refresh();
        }}
      />
      <ReturnDialog
        request={returning}
        onOpenChange={(v) => !v && setReturning(null)}
        onRecorded={() => {
          setReturning(null);
          router.refresh();
        }}
      />
    </div>
  );
}
