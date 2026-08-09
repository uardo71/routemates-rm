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
import { setAssignmentStatusAction } from "../../../milestone-actions";

const STATUSES = ["ACTIVE", "PAUSED", "CLOSED"] as const;
type Status = (typeof STATUSES)[number];

export function AssignmentStatusSelect({ assignmentId, status }: { assignmentId: string; status: Status }) {
  const [pending, startTransition] = useTransition();

  return (
    <Select
      value={status}
      disabled={pending}
      items={STATUSES.map((s) => ({ value: s, label: s }))}
      onValueChange={(value) => {
        if (!value || value === status) return;
        startTransition(async () => {
          try {
            await setAssignmentStatusAction(assignmentId, value as Status);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to update status.");
          }
        });
      }}
    >
      <SelectTrigger size="sm" className="w-28">
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
