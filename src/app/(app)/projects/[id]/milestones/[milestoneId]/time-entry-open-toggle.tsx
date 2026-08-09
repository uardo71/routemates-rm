"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toggleMilestoneTimeEntryOpenAction } from "../../../milestone-actions";

export function TimeEntryOpenToggle({ milestoneId, open }: { milestoneId: string; open: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant={open ? "outline" : "destructive"}
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            await toggleMilestoneTimeEntryOpenAction(milestoneId, !open);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to update.");
          }
        })
      }
    >
      {open ? "Open for time entry" : "Closed for time entry"}
    </Button>
  );
}
