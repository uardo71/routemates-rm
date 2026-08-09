"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeleteButton } from "@/components/delete-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateProjectAction, deleteProjectAction } from "../../actions";

const STATUSES = ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
const BILLING_TYPES = ["TIME_AND_MATERIALS", "FIXED_PRICE", "RETAINER"] as const;

type Option = { id: string; name: string };

export function EditProjectForm({
  project,
  clients,
  managers,
  canDelete,
}: {
  project: {
    id: string;
    name: string;
    clientId: string;
    status: (typeof STATUSES)[number];
    billingType: (typeof BILLING_TYPES)[number];
    budgetAmount: string | null;
    budgetHours: string | null;
    startDate: string | null;
    endDate: string | null;
    managerId: string | null;
  };
  clients: Option[];
  managers: Option[] | null;
  canDelete: boolean;
}) {
  const [error, formAction, pending] = useActionState(updateProjectAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={project.id} />
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Project name</Label>
          <Input id="name" name="name" defaultValue={project.name} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="clientId">Client</Label>
          <Select name="clientId" required defaultValue={project.clientId} items={clients.map((c) => ({ value: c.id, label: c.name }))}>
            <SelectTrigger id="clientId" className="w-full">
              <SelectValue />
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
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Status</Label>
          <Select name="status" defaultValue={project.status} items={STATUSES.map((s) => ({ value: s, label: s.replaceAll("_", " ") }))}>
            <SelectTrigger id="status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="billingType">Billing type</Label>
          <Select name="billingType" defaultValue={project.billingType} items={BILLING_TYPES.map((t) => ({ value: t, label: t.replaceAll("_", " ") }))}>
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
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="budgetAmount">Budget pool ($)</Label>
          <Input id="budgetAmount" name="budgetAmount" type="number" step="0.01" min="0" defaultValue={project.budgetAmount ?? undefined} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="budgetHours">Budget pool (hours)</Label>
          <Input id="budgetHours" name="budgetHours" type="number" step="0.5" min="0" defaultValue={project.budgetHours ?? undefined} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startDate">Start date</Label>
          <Input id="startDate" name="startDate" type="date" defaultValue={project.startDate ?? undefined} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="endDate">End date</Label>
          <Input id="endDate" name="endDate" type="date" defaultValue={project.endDate ?? undefined} />
        </div>
      </div>
      {managers && (
        <div className="flex flex-col gap-1.5 max-w-xs">
          <Label htmlFor="managerId">Project manager</Label>
          <Select name="managerId" defaultValue={project.managerId ?? undefined} items={managers.map((m) => ({ value: m.id, label: m.name }))}>
            <SelectTrigger id="managerId" className="w-full">
              <SelectValue />
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
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? "Saving..." : "Save changes"}
        </Button>
        {canDelete && (
          <DeleteButton
            action={() => deleteProjectAction(project.id)}
            confirmMessage={`Delete ${project.name}? This cannot be undone.`}
          />
        )}
      </div>
      {!canDelete && (
        <p className="text-xs text-muted-foreground">This project has milestones — remove them first to delete it.</p>
      )}
    </form>
  );
}
