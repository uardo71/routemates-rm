"use client";

import { useState } from "react";
import { addDays, format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TimeCardGrid, type TimeCardGridEntry } from "@/components/time-card-grid";

export type ProjectTimeCard = {
  id: string;
  userName: string;
  milestoneName: string;
  weekStartDate: string;
  status: string;
  totalHours: number;
  submittedAt: string | null;
  submittedByName: string | null;
  decidedAt: string | null;
  comment: string | null;
  entries: TimeCardGridEntry[];
};

export function TimeEntriesTable({ cards }: { cards: ProjectTimeCard[] }) {
  const [detailCard, setDetailCard] = useState<ProjectTimeCard | null>(null);

  if (cards.length === 0) {
    return <p className="text-muted-foreground">No time logged yet.</p>;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Resource</TableHead>
            <TableHead>Milestone</TableHead>
            <TableHead>Period</TableHead>
            <TableHead>Hours</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Submitted by</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cards.map((tc) => (
            <TableRow key={tc.id} className="cursor-pointer" onClick={() => setDetailCard(tc)}>
              <TableCell className="font-medium">{tc.userName}</TableCell>
              <TableCell>{tc.milestoneName}</TableCell>
              <TableCell>
                {format(new Date(tc.weekStartDate), "MMM d")} – {format(addDays(new Date(tc.weekStartDate), 6), "MMM d, yyyy")}
              </TableCell>
              <TableCell>{tc.totalHours}h</TableCell>
              <TableCell>
                <Badge variant="secondary">{tc.status}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {tc.submittedByName ? (
                  tc.submittedByName === tc.userName ? tc.submittedByName : `${tc.submittedByName} (on behalf of ${tc.userName})`
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={detailCard !== null} onOpenChange={(open) => !open && setDetailCard(null)}>
        {detailCard && (
          <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
            <DialogHeader>
              <DialogTitle>
                {detailCard.userName} — week of {format(new Date(detailCard.weekStartDate), "MMM d, yyyy")}
              </DialogTitle>
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 pr-1">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-muted-foreground">Milestone</div>
                  <div>{detailCard.milestoneName}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Status</div>
                  <div>
                    <Badge variant="secondary">{detailCard.status}</Badge>
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Submitted</div>
                  <div>
                    {detailCard.submittedAt ? format(new Date(detailCard.submittedAt), "MMM d, yyyy 'at' h:mm a") : "—"}
                    {detailCard.submittedByName && ` by ${detailCard.submittedByName}`}
                    {detailCard.submittedByName &&
                      detailCard.submittedByName !== detailCard.userName &&
                      ` (on behalf of ${detailCard.userName})`}
                  </div>
                </div>
                {detailCard.decidedAt && (
                  <div>
                    <div className="text-muted-foreground">Decided</div>
                    <div>
                      {format(new Date(detailCard.decidedAt), "MMM d, yyyy 'at' h:mm a")}
                      {detailCard.comment && ` — "${detailCard.comment}"`}
                    </div>
                  </div>
                )}
              </div>

              <TimeCardGrid weekStartDate={detailCard.weekStartDate} entries={detailCard.entries} totalHours={detailCard.totalHours} />
            </div>

            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
