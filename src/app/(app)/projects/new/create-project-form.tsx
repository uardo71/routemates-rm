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
import { createProjectAction } from "../actions";

const BILLING_TYPES = ["TIME_AND_MATERIALS", "FIXED_PRICE", "RETAINER"] as const;

type Option = { id: string; name: string };

export function CreateProjectForm({
  clients,
  managers,
}: {
  clients: Option[];
  managers: Option[] | null;
}) {
  const [error, formAction, pending] = useActionState(createProjectAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Project name</Label>
          <Input id="name" name="name" required />
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
          <Label htmlFor="budgetAmount">Budget pool ($, optional)</Label>
          <Input id="budgetAmount" name="budgetAmount" type="number" step="0.01" min="0" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="budgetHours">Budget pool (hours, optional)</Label>
          <Input id="budgetHours" name="budgetHours" type="number" step="0.5" min="0" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startDate">Start date</Label>
          <Input id="startDate" name="startDate" type="date" />
        </div>
      </div>
      {managers && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="managerId">Project manager</Label>
          <Select name="managerId" required items={managers.map((m) => ({ value: m.id, label: m.name }))}>
            <SelectTrigger id="managerId" className="w-full max-w-xs">
              <SelectValue placeholder="Select a PM" />
            </SelectTrigger>
            <SelectContent>
              {managers.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input id="isInternal" name="isInternal" type="checkbox" className="size-4" />
        <Label htmlFor="isInternal">Internal (not billed to the client — e.g. for tracking vacations)</Label>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Creating..." : "Create project"}
      </Button>
    </form>
  );
}
