"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeleteButton } from "@/components/delete-button";
import { updateInvoiceAction, deleteInvoiceAction } from "../actions";

export function EditInvoiceForm({
  invoice,
}: {
  invoice: {
    id: string;
    periodStart: string;
    periodEnd: string;
    poNumber: string | null;
    referenceNumber: string | null;
  };
}) {
  const [error, formAction, pending] = useActionState(updateInvoiceAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="invoiceId" value={invoice.id} />
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="periodStart">Period start</Label>
          <Input id="periodStart" name="periodStart" type="date" defaultValue={invoice.periodStart} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="periodEnd">Period end</Label>
          <Input id="periodEnd" name="periodEnd" type="date" defaultValue={invoice.periodEnd} required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="poNumber">Client PO number</Label>
          <Input id="poNumber" name="poNumber" defaultValue={invoice.poNumber ?? undefined} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="referenceNumber">Delivery note / SES #</Label>
          <Input id="referenceNumber" name="referenceNumber" defaultValue={invoice.referenceNumber ?? undefined} />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? "Saving..." : "Save changes"}
        </Button>
        <DeleteButton
          action={() => deleteInvoiceAction(invoice.id)}
          confirmMessage="Delete this draft invoice? Its time entries will become invoiceable again."
        />
      </div>
    </form>
  );
}
