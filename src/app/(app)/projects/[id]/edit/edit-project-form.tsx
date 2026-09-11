"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeleteButton } from "@/components/delete-button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PROJECT_STATUS_LABEL, type ProjectStatusKey } from "@/lib/project-stage";
import { updateProjectAction, deleteProjectAction } from "../../actions";

const BILLING_TYPES = ["TIME_AND_MATERIALS", "FIXED_PRICE", "RETAINER"] as const;
const NONE = "NONE";
// Every field a lifecycle check or a hygiene item deep-links to carries id="field-…"; the `target:`
// ring shows where the link landed.
const FIELD = "flex flex-col gap-1.5 scroll-mt-24 rounded-md target:ring-2 target:ring-primary target:ring-offset-4 target:ring-offset-background";

type Option = { id: string; name: string };
type ClientOption = Option & { contacts: Option[] };

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
    status: string;
    billingType: (typeof BILLING_TYPES)[number];
    budgetAmount: string | null;
    budgetHours: string | null;
    startDate: string | null;
    endDate: string | null;
    managerId: string | null;
    isInternal: boolean;
    sowNumber: string | null;
    poNumber: string | null;
    poWaived: boolean;
    poWaivedReason: string | null;
    sponsorContactId: string | null;
  };
  clients: ClientOption[];
  managers: Option[] | null;
  canDelete: boolean;
}) {
  const [error, formAction, pending] = useActionState(updateProjectAction, undefined);
  const [clientId, setClientId] = useState(project.clientId);
  const [sponsorId, setSponsorId] = useState(project.sponsorContactId ?? NONE);
  const [poWaived, setPoWaived] = useState(project.poWaived);
  const contacts = clients.find((c) => c.id === clientId)?.contacts ?? [];
  const sponsorItems = [{ value: NONE, label: "No sponsor yet" }, ...contacts.map((c) => ({ value: c.id, label: c.name }))];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={project.id} />
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
        Status: <span className="font-medium">{PROJECT_STATUS_LABEL[project.status as ProjectStatusKey] ?? project.status}</span>
        <span className="text-muted-foreground"> — change it with the buttons on the project page (Start delivery, Put on hold, Close project…), which run the lifecycle checks.</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Project name</Label>
          <Input id="name" name="name" defaultValue={project.name} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="clientId">Client</Label>
          <Select name="clientId" required value={clientId} onValueChange={(v) => { setClientId(String(v ?? project.clientId)); setSponsorId(NONE); }} items={clients.map((c) => ({ value: c.id, label: c.name }))}>
            <SelectTrigger id="clientId" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="billingType">Billing type</Label>
          <Select name="billingType" defaultValue={project.billingType} items={BILLING_TYPES.map((t) => ({ value: t, label: t.replaceAll("_", " ") }))}>
            <SelectTrigger id="billingType" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {BILLING_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replaceAll("_", " ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div id="field-sponsorContactId" className={FIELD}>
          <Label>Client sponsor</Label>
          <Select name="sponsorContactId" value={sponsorId} onValueChange={(v) => setSponsorId(String(v ?? NONE))} items={sponsorItems}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {sponsorItems.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {contacts.length === 0 && <p className="text-xs text-muted-foreground">This client has no contacts yet — add one on the client&apos;s page first.</p>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div id="field-sowNumber" className={FIELD}>
          <Label htmlFor="sowNumber">SoW number</Label>
          <Input id="sowNumber" name="sowNumber" defaultValue={project.sowNumber ?? ""} maxLength={100} placeholder="Signed statement of work" />
        </div>
        <div id="field-poNumber" className={FIELD}>
          <Label htmlFor="poNumber">Customer PO number</Label>
          <Input id="poNumber" name="poNumber" defaultValue={project.poNumber ?? ""} maxLength={100} />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" name="poWaived" className="size-3.5" checked={poWaived} onChange={(e) => setPoWaived(e.target.checked)} /> PO waived for this project
          </label>
          {poWaived && <Input name="poWaivedReason" defaultValue={project.poWaivedReason ?? ""} maxLength={500} required placeholder="Why is there no PO? (required)" />}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div id="field-budgetAmount" className={FIELD}>
          <Label htmlFor="budgetAmount">Budget pool ($)</Label>
          <Input id="budgetAmount" name="budgetAmount" type="number" step="0.01" min="0" defaultValue={project.budgetAmount ?? undefined} />
        </div>
        <div id="field-budgetHours" className={FIELD}>
          <Label htmlFor="budgetHours">Budget pool (hours)</Label>
          <Input id="budgetHours" name="budgetHours" type="number" step="0.01" min="0" defaultValue={project.budgetHours ?? undefined} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div id="field-startDate" className={FIELD}>
          <Label htmlFor="startDate">Start date</Label>
          <Input id="startDate" name="startDate" type="date" defaultValue={project.startDate ?? undefined} />
        </div>
        <div id="field-endDate" className={FIELD}>
          <Label htmlFor="endDate">End date</Label>
          <Input id="endDate" name="endDate" type="date" defaultValue={project.endDate ?? undefined} />
        </div>
      </div>
      {managers && (
        <div id="field-managerId" className={`${FIELD} max-w-xs`}>
          <Label htmlFor="managerId">Project manager</Label>
          <Select name="managerId" defaultValue={project.managerId ?? undefined} items={managers.map((m) => ({ value: m.id, label: m.name }))}>
            <SelectTrigger id="managerId" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input id="isInternal" name="isInternal" type="checkbox" className="size-4" defaultChecked={project.isInternal} />
        <Label htmlFor="isInternal">Internal (not billed to the client — e.g. for tracking vacations)</Label>
      </div>
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
