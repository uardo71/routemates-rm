"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createAssignmentAction } from "../../../../../milestone-actions";

type Option = { id: string; name: string };

export function CreateAssignmentForm({
  milestoneId,
  users,
  canViewCostRate,
  showBillRate = false,
  defaultBillRate = null,
}: {
  milestoneId: string;
  users: Option[];
  canViewCostRate: boolean;
  showBillRate?: boolean;
  defaultBillRate?: string | null;
}) {
  const [error, formAction, pending] = useActionState(createAssignmentAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="milestoneId" value={milestoneId} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="asgUserId">User</Label>
          <Select name="userId" required items={users.map((u) => ({ value: u.id, label: u.name }))}>
            <SelectTrigger id="asgUserId" className="w-full">
              <SelectValue placeholder="Select a user" />
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canViewCostRate && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="asgCostRate">Cost rate (€/hr, optional)</Label>
            <Input id="asgCostRate" name="costRate" type="number" step="0.0001" min="0" placeholder="from employment" />
          </div>
        )}
        {showBillRate && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="asgBillRate">Bill rate (/hr, optional)</Label>
            <Input id="asgBillRate" name="billRate" type="number" step="0.0001" min="0" defaultValue={defaultBillRate ?? ""} placeholder="from milestone rate" />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="asgAllocatedHours">Allocated hours (optional)</Label>
          <Input id="asgAllocatedHours" name="allocatedHours" type="number" step="any" min="0" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="asgStartDate">Start date</Label>
          <Input id="asgStartDate" name="startDate" type="date" required />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="asgEndDate">End date</Label>
          <Input id="asgEndDate" name="endDate" type="date" required />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Assigning..." : "Add assignment"}
      </Button>
    </form>
  );
}
