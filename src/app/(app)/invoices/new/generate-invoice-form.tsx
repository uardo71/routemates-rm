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
import { generateInvoiceAction } from "../actions";

type Option = { id: string; name: string };

export function GenerateInvoiceForm({ clients }: { clients: Option[] }) {
  const [error, formAction, pending] = useActionState(generateInvoiceAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="clientId">Client</Label>
          <Select name="clientId" required items={clients.map((c) => ({ value: c.id, label: c.name }))}>
            <SelectTrigger id="clientId" className="w-full">
              <SelectValue placeholder="Select a client" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="periodStart">Period start</Label>
          <Input id="periodStart" name="periodStart" type="date" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="periodEnd">Period end</Label>
          <Input id="periodEnd" name="periodEnd" type="date" required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="poNumber">Client PO number (optional)</Label>
          <Input id="poNumber" name="poNumber" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="referenceNumber">Delivery note / SES # (optional)</Label>
          <Input id="referenceNumber" name="referenceNumber" />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Generating..." : "Generate draft invoice"}
      </Button>
    </form>
  );
}
