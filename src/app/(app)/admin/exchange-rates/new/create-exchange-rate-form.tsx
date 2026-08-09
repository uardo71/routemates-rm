"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createExchangeRateAction } from "../actions";

const CURRENCIES = ["ALL", "EUR", "USD"] as const;

export function CreateExchangeRateForm() {
  const [error, formAction, pending] = useActionState(createExchangeRateAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3 max-w-md">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fromCurrency">From currency</Label>
          <Select name="fromCurrency" defaultValue="ALL" items={CURRENCIES.map((c) => ({ value: c, label: c }))}>
            <SelectTrigger id="fromCurrency" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="toCurrency">To currency</Label>
          <Select name="toCurrency" defaultValue="EUR" items={CURRENCIES.map((c) => ({ value: c, label: c }))}>
            <SelectTrigger id="toCurrency" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rate">Rate (how many &quot;from&quot; units equal 1 &quot;to&quot; unit)</Label>
        <Input id="rate" name="rate" type="number" step="0.000001" min="0" placeholder="e.g. 105.5" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="effectiveFrom">Effective from</Label>
        <Input id="effectiveFrom" name="effectiveFrom" type="date" required />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Adding..." : "Add exchange rate"}
      </Button>
    </form>
  );
}
