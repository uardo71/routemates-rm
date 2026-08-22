"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setMilestoneStatusAction } from "../../../milestone-actions";

const STATUSES = ["PLANNED", "ACTIVE", "COMPLETE"] as const;
type Status = (typeof STATUSES)[number];

export function MilestoneStatusSelect({ milestoneId, status }: { milestoneId: string; status: Status | "INVOICED" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [completeOpen, setCompleteOpen] = useState(false);
  const [note, setNote] = useState("");

  if (status === "INVOICED") {
    return <span className="text-sm text-muted-foreground">INVOICED</span>;
  }

  function apply(next: Status, completionNote?: string) {
    start(async () => {
      const r = await setMilestoneStatusAction(milestoneId, next, completionNote ?? null);
      if (r.error) toast.error(r.error);
      else { toast.success(next === "COMPLETE" ? "Milestone completed." : "Status updated."); setCompleteOpen(false); setNote(""); router.refresh(); }
    });
  }

  return (
    <>
      <Select
        value={status}
        disabled={pending}
        items={STATUSES.map((s) => ({ value: s, label: s }))}
        onValueChange={(value) => {
          if (!value || value === status) return;
          if (value === "COMPLETE") setCompleteOpen(true);
          else apply(value as Status);
        }}
      >
        <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
      </Select>

      {completeOpen && (
        <Dialog open onOpenChange={(v) => !v && setCompleteOpen(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Complete milestone</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2 rounded-md border border-amber-300/70 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                <LockIcon className="size-4 mt-0.5 shrink-0" />
                <span>Completing <span className="font-medium">locks time entry</span> and recognizes the milestone&apos;s <span className="font-medium">full value</span> as earned — even with no logged hours.</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ms-complete-note">Completion note</Label>
                <Textarea id="ms-complete-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="e.g. Poland go-live delivered; invoiced in full per Pirelli PO." />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button size="sm" variant="outline" onClick={() => setCompleteOpen(false)} disabled={pending}>Cancel</Button>
              <Button size="sm" onClick={() => apply("COMPLETE", note)} disabled={pending}>{pending ? "Completing…" : "Complete & lock"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
