"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeleteButton } from "@/components/delete-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateAssignmentAction, deleteAssignmentAction } from "../../../../../../milestone-actions";

const STATUSES = ["ACTIVE", "PAUSED", "CLOSED"] as const;

export function EditAssignmentForm({
  assignment,
  canDelete,
  canViewCostRate,
}: {
  assignment: {
    id: string;
    userName: string;
    costRate: string;
    allocatedHours: string | null;
    startDate: string | null;
    endDate: string | null;
    status: (typeof STATUSES)[number];
  };
  canDelete: boolean;
  canViewCostRate: boolean;
}) {
  const [error, formAction, pending] = useActionState(updateAssignmentAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="assignmentId" value={assignment.id} />
      <div className="flex flex-col gap-1.5">
        <Label>User</Label>
        <div className="text-sm">{assignment.userName}</div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {canViewCostRate && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="costRate">Cost rate (€/hr)</Label>
            <Input id="costRate" name="costRate" type="number" step="0.0001" min="0" defaultValue={assignment.costRate} required />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="allocatedHours">Allocated hours</Label>
          <Input id="allocatedHours" name="allocatedHours" type="number" step="any" min="0" defaultValue={assignment.allocatedHours ?? undefined} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startDate">Start date</Label>
          <Input id="startDate" name="startDate" type="date" defaultValue={assignment.startDate ?? undefined} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="endDate">End date</Label>
          <Input id="endDate" name="endDate" type="date" defaultValue={assignment.endDate ?? undefined} required />
        </div>
      </div>
      <div className="flex flex-col gap-1.5 max-w-xs">
        <Label htmlFor="status">Status</Label>
        <Select name="status" defaultValue={assignment.status} items={STATUSES.map((s) => ({ value: s, label: s }))}>
          <SelectTrigger id="status" className="w-full">
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
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? "Saving..." : "Save changes"}
        </Button>
        {canDelete && (
          <DeleteButton
            action={() => deleteAssignmentAction(assignment.id)}
            confirmMessage={`Remove ${assignment.userName} from this milestone?`}
          />
        )}
      </div>
      {!canDelete && <p className="text-xs text-muted-foreground">This assignment has time entries — can&apos;t be deleted.</p>}
    </form>
  );
}
