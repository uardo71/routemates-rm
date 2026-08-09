"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setMilestoneStatusAction } from "../../../milestone-actions";

const STATUSES = ["PLANNED", "ACTIVE", "COMPLETE"] as const;
type Status = (typeof STATUSES)[number];

export function MilestoneStatusSelect({
  milestoneId,
  status,
}: {
  milestoneId: string;
  status: Status | "INVOICED";
}) {
  const [pending, startTransition] = useTransition();

  if (status === "INVOICED") {
    return <span className="text-sm text-muted-foreground">INVOICED</span>;
  }

  return (
    <Select
      value={status}
      disabled={pending}
      items={STATUSES.map((s) => ({ value: s, label: s }))}
      onValueChange={(value) => {
        if (!value || value === status) return;
        startTransition(async () => {
          try {
            await setMilestoneStatusAction(milestoneId, value as Status);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to update status.");
          }
        });
      }}
    >
      <SelectTrigger size="sm" className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
