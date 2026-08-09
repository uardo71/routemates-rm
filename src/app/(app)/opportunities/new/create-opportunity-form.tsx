"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createOpportunityAction } from "../actions";

const BILLING_TYPES = ["TIME_AND_MATERIALS", "FIXED_PRICE", "RETAINER"] as const;

type Option = { id: string; name: string };

export function CreateOpportunityForm({
  clients,
  owners,
  callerId,
  defaultCurrency,
}: {
  clients: Option[];
  owners: Option[];
  callerId: string;
  defaultCurrency: string;
}) {
  const [error, formAction, pending] = useActionState(createOpportunityAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Opportunity name</Label>
          <Input id="name" name="name" required placeholder="e.g. ACME S/4HANA ABAP migration" />
        </div>
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
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="billingType">Billing type</Label>
          <Select
            name="billingType"
            defaultValue="TIME_AND_MATERIALS"
            items={BILLING_TYPES.map((t) => ({ value: t, label: t.replaceAll("_", " ") }))}
          >
            <SelectTrigger id="billingType" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BILLING_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.replaceAll("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="currency">Currency</Label>
          <Input id="currency" name="currency" defaultValue={defaultCurrency} maxLength={10} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reference">Reference (optional)</Label>
          <Input id="reference" name="reference" placeholder="RFQ / tender no." maxLength={100} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ownerId">Owner</Label>
          <Select
            name="ownerId"
            defaultValue={callerId}
            required
            items={owners.map((o) => ({ value: o.id, label: o.id === callerId ? `${o.name} (me)` : o.name }))}
          >
            <SelectTrigger id="ownerId" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {owners.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.id === callerId ? `${o.name} (me)` : o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="expectedCloseDate">Expected close (optional)</Label>
          <Input id="expectedCloseDate" name="expectedCloseDate" type="date" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="probability">Win probability % (optional)</Label>
          <Input id="probability" name="probability" type="number" min="0" max="100" step="5" />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        You&apos;ll add the priced quote lines (roles / workstreams with hours × rate) on the next screen, then issue
        proposals and submit for approval.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Creating..." : "Create opportunity"}
      </Button>
    </form>
  );
}
