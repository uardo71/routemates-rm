"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { billFixedPriceMilestoneAction } from "@/app/(app)/invoices/actions";
import { formatMoney } from "@/lib/format";

export function BillMilestoneForm({
  milestoneId,
  amount,
  currency,
}: {
  milestoneId: string;
  amount: string;
  currency: string;
}) {
  const [error, formAction, pending] = useActionState(billFixedPriceMilestoneAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3 border-t pt-4">
      <input type="hidden" name="milestoneId" value={milestoneId} />
      <p className="text-sm">
        This milestone is complete and fixed-price. Billing it will create a draft invoice for{" "}
        <span className="font-medium">{formatMoney(amount, currency)}</span>.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="billPoNumber">Client PO number (optional)</Label>
          <Input id="billPoNumber" name="poNumber" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="billReferenceNumber">Delivery note / SES # (optional)</Label>
          <Input id="billReferenceNumber" name="referenceNumber" />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Billing..." : "Bill this milestone"}
      </Button>
    </form>
  );
}
