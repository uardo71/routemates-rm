"use client";

import { useState, useTransition } from "react";
import { addDays, format } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TimeCardGrid, type TimeCardGridEntry } from "@/components/time-card-grid";
import { decideApprovalsAction } from "./actions";

export type ApprovalEntry = TimeCardGridEntry;
export type ApprovalCard = {
  id: string;
  userName: string;
  submittedByName: string | null;
  weekStartDate: string;
  projectName: string;
  milestoneName: string;
  totalHours: number;
  submittedAt: string | null;
  approverName: string | null;
  entries: ApprovalEntry[];
};

export function ApprovalsTable({ cards: initialCards }: { cards: ApprovalCard[] }) {
  const [cards, setCards] = useState(initialCards);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [detailCard, setDetailCard] = useState<ApprovalCard | null>(null);
  const [comment, setComment] = useState("");
  const [pending, startTransition] = useTransition();

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  const allSelected = cards.length > 0 && selectedIds.length === cards.length;

  function toggleAll() {
    if (allSelected) {
      setSelected({});
    } else {
      setSelected(Object.fromEntries(cards.map((c) => [c.id, true])));
    }
  }
  function toggleOne(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function removeDecided(ids: string[]) {
    setCards((prev) => prev.filter((c) => !ids.includes(c.id)));
    setSelected((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
  }

  function decide(ids: string[], decision: "APPROVED" | "REJECTED", decisionComment?: string) {
    startTransition(async () => {
      const result = await decideApprovalsAction(ids, decision, decisionComment);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        decision === "APPROVED"
          ? `Approved ${ids.length} line${ids.length === 1 ? "" : "s"}.`
          : `Rejected ${ids.length} line${ids.length === 1 ? "" : "s"}.`
      );
      removeDecided(ids);
      setDetailCard(null);
      setComment("");
    });
  }

  if (cards.length === 0) {
    return <p className="text-muted-foreground">No pending approvals.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {selectedIds.length > 0 ? `${selectedIds.length} selected` : `${cards.length} pending`}
        </span>
        <div className="flex-1" />
        <Button size="sm" disabled={selectedIds.length === 0 || pending} onClick={() => decide(selectedIds, "APPROVED")}>
          Approve selected{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={selectedIds.length === 0 || pending}
          onClick={() => decide(selectedIds, "REJECTED")}
        >
          Reject selected{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input type="checkbox" className="size-4" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
            </TableHead>
            <TableHead>Resource</TableHead>
            <TableHead>Period</TableHead>
            <TableHead>Project / Milestone</TableHead>
            <TableHead>Hours</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Approver</TableHead>
            <TableHead>Submitted by</TableHead>
            <TableHead>Submitted</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cards.map((card) => (
            <TableRow key={card.id} className="cursor-pointer" onClick={() => setDetailCard(card)}>
              <TableCell onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  className="size-4"
                  checked={!!selected[card.id]}
                  onChange={() => toggleOne(card.id)}
                  aria-label={`Select ${card.userName}'s line`}
                />
              </TableCell>
              <TableCell className="font-medium">{card.userName}</TableCell>
              <TableCell>
                {format(new Date(card.weekStartDate), "MMM d")} – {format(addDays(new Date(card.weekStartDate), 6), "MMM d, yyyy")}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {card.projectName} — {card.milestoneName}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{card.totalHours}h</Badge>
              </TableCell>
              <TableCell>
                <Badge variant="outline">Pending</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{card.approverName ?? "—"}</TableCell>
              <TableCell className="text-muted-foreground">{card.submittedByName ?? "—"}</TableCell>
              <TableCell className="text-muted-foreground">
                {card.submittedAt ? format(new Date(card.submittedAt), "MMM d, h:mm a") : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog
        open={detailCard !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailCard(null);
            setComment("");
          }
        }}
      >
        {detailCard && <DetailDialogContent card={detailCard} comment={comment} setComment={setComment} pending={pending} decide={decide} />}
      </Dialog>
    </div>
  );
}

function DetailDialogContent({
  card,
  comment,
  setComment,
  pending,
  decide,
}: {
  card: ApprovalCard;
  comment: string;
  setComment: (v: string) => void;
  pending: boolean;
  decide: (ids: string[], decision: "APPROVED" | "REJECTED", comment?: string) => void;
}) {
  return (
    <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
      <DialogHeader>
        <DialogTitle>
          {card.userName} — week of {format(new Date(card.weekStartDate), "MMM d, yyyy")}
        </DialogTitle>
      </DialogHeader>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 pr-1">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-muted-foreground">Project / Milestone</div>
            <div>{card.projectName} — {card.milestoneName}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Submitted</div>
            <div>
              {card.submittedAt ? format(new Date(card.submittedAt), "MMM d, yyyy 'at' h:mm a") : "—"}
              {card.submittedByName && ` by ${card.submittedByName}`}
              {card.submittedByName && card.submittedByName !== card.userName && ` (on behalf of ${card.userName})`}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Responsible approver</div>
            <div>{card.approverName ?? "—"}</div>
          </div>
        </div>

        <TimeCardGrid weekStartDate={card.weekStartDate} entries={card.entries} totalHours={card.totalHours} />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="approval-comment" className="text-sm text-muted-foreground">
            Comment (optional)
          </label>
          <Textarea id="approval-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
        </div>
      </div>

      <DialogFooter>
        <Button variant="destructive" disabled={pending} onClick={() => decide([card.id], "REJECTED", comment)}>
          Reject
        </Button>
        <Button disabled={pending} onClick={() => decide([card.id], "APPROVED", comment)}>
          Approve
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
