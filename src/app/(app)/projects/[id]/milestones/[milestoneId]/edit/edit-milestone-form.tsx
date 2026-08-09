"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DeleteButton } from "@/components/delete-button";
import { currencySymbol } from "@/lib/format";
import { updateMilestoneAction, deleteMilestoneAction } from "../../../../milestone-actions";

export function EditMilestoneForm({
  milestone,
  billingType,
  currency,
  canDelete,
}: {
  milestone: {
    id: string;
    name: string;
    description: string | null;
    billable: boolean;
    salesPrice: string;
    cost: string;
    budgetHours: string | null;
    startDate: string | null;
    endDate: string | null;
  };
  billingType: "TIME_AND_MATERIALS" | "FIXED_PRICE" | "RETAINER";
  currency: string;
  canDelete: boolean;
}) {
  const [error, formAction, pending] = useActionState(updateMilestoneAction, undefined);
  const sym = currencySymbol(currency);
  const priceLabel = billingType === "FIXED_PRICE" ? `Sales price (${sym}, lump sum)` : `Sales price (${sym}/hr)`;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="milestoneId" value={milestone.id} />
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Milestone name</Label>
          <Input id="name" name="name" defaultValue={milestone.name} required />
        </div>
        <div className="flex items-center gap-2 pt-6">
          <input id="billable" name="billable" type="checkbox" defaultChecked={milestone.billable} className="size-4" />
          <Label htmlFor="billable">Billable</Label>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={2} defaultValue={milestone.description ?? undefined} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="salesPrice">{priceLabel}</Label>
          <Input id="salesPrice" name="salesPrice" type="number" step="0.0001" min="0" defaultValue={milestone.salesPrice} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cost">Budgeted cost ({sym}, optional)</Label>
          <Input id="cost" name="cost" type="number" step="0.0001" min="0" defaultValue={milestone.cost} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="budgetHours">Budget hours</Label>
          <Input id="budgetHours" name="budgetHours" type="number" step="0.5" min="0" defaultValue={milestone.budgetHours ?? undefined} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startDate">Start date</Label>
          <Input id="startDate" name="startDate" type="date" defaultValue={milestone.startDate ?? undefined} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="endDate">End date</Label>
          <Input id="endDate" name="endDate" type="date" defaultValue={milestone.endDate ?? undefined} />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? "Saving..." : "Save changes"}
        </Button>
        {canDelete && (
          <DeleteButton
            action={() => deleteMilestoneAction(milestone.id)}
            confirmMessage={`Delete milestone ${milestone.name}? This cannot be undone.`}
          />
        )}
      </div>
      {!canDelete && (
        <p className="text-xs text-muted-foreground">
          This milestone has assignments, tasks, or time entries — remove them first to delete it.
        </p>
      )}
    </form>
  );
}
