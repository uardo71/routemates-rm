"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { currencySymbol } from "@/lib/format";
import { createMilestoneAction } from "../../../milestone-actions";

export function CreateMilestoneForm({
  projectId,
  billingType,
  currency,
}: {
  projectId: string;
  billingType: "TIME_AND_MATERIALS" | "FIXED_PRICE" | "RETAINER";
  currency: string;
}) {
  const [error, formAction, pending] = useActionState(createMilestoneAction, undefined);
  const sym = currencySymbol(currency);
  const priceLabel = billingType === "FIXED_PRICE" ? `Sales price (${sym}, lump sum)` : `Sales price (${sym}/hr)`;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="msName">Milestone name</Label>
          <Input id="msName" name="name" required />
        </div>
        <div className="flex items-center gap-2 pt-6">
          <input id="msBillable" name="billable" type="checkbox" defaultChecked className="size-4" />
          <Label htmlFor="msBillable">Billable</Label>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="msDescription">Description</Label>
        <Textarea id="msDescription" name="description" rows={2} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="msSalesPrice">{priceLabel}</Label>
          <Input id="msSalesPrice" name="salesPrice" type="number" step="0.0001" min="0" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="msCost">Budgeted cost ({sym}, optional)</Label>
          <Input id="msCost" name="cost" type="number" step="0.0001" min="0" placeholder="0" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="msBudgetHours">Budget hours (optional)</Label>
          <Input id="msBudgetHours" name="budgetHours" type="number" step="0.01" min="0" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">
        Budgeted cost is a top-down estimate — nobody&apos;s staffed yet. Once you add assignments,
        the milestone page also shows the actual implied cost (each person&apos;s cost rate ×
        their allocated hours) so you can compare.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="msStartDate">Start date</Label>
          <Input id="msStartDate" name="startDate" type="date" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="msEndDate">End date</Label>
          <Input id="msEndDate" name="endDate" type="date" />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Creating..." : "Create milestone"}
      </Button>
    </form>
  );
}
