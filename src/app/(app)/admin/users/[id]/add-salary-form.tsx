"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addSalaryAction } from "../salary-actions";

const CURRENCIES = ["ALL", "EUR"] as const;

export function AddSalaryForm({ userId }: { userId: string }) {
  const [error, formAction, pending] = useActionState(addSalaryAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="userId" value={userId} />
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="monthlyAmount">Monthly salary</Label>
          <Input id="monthlyAmount" name="monthlyAmount" type="number" step="0.01" min="0" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="currency">Currency</Label>
          <Select name="currency" defaultValue="ALL" items={CURRENCIES.map((c) => ({ value: c, label: c }))}>
            <SelectTrigger id="currency" className="w-full">
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
          <Label htmlFor="effectiveFrom">Effective from</Label>
          <Input id="effectiveFrom" name="effectiveFrom" type="date" required />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Adding..." : "Add salary"}
      </Button>
    </form>
  );
}
