"use client";

import * as React from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABEL } from "@/lib/ticket";
import { TypeIcon } from "../../(app)/tickets/ticket-visuals";
import { createPortalTicketAction } from "../portal-actions";

export type PubField = { id: string; key: string; name: string; kind: string; options: string[]; required: boolean };
export type PortalFormConfig = {
  types: { id: string; name: string; color: string | null; icon: string | null; fields: PubField[] }[];
  globalFields: PubField[];
};
const selectCls = "h-9 w-full rounded-md border bg-transparent px-2 text-sm outline-none focus:border-primary/50";

export function PortalNewForm({ config }: { config: PortalFormConfig }) {
  const [state, formAction, pending] = useActionState(createPortalTicketAction, undefined as { error?: string } | undefined);
  const [typeId, setTypeId] = React.useState(config.types[0]?.id ?? "");
  const type = config.types.find((t) => t.id === typeId);
  const fields = [...(type?.fields ?? []), ...config.globalFields];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>What do you need?</Label>
        <input type="hidden" name="typeId" value={typeId} />
        <div className="flex flex-wrap gap-1.5">
          {config.types.map((t) => (
            <button type="button" key={t.id} onClick={() => setTypeId(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm ${t.id === typeId ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"}`}>
              <TypeIcon icon={t.icon} className="size-3.5" /> {t.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Summary</Label>
        <Input id="title" name="title" required maxLength={240} placeholder="Briefly, what's the issue or request?" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Details</Label>
        <Textarea id="description" name="description" rows={5} placeholder="Give us as much detail as you can — what happened, when, and any impact." />
      </div>
      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <Label htmlFor="priority">Priority</Label>
        <select id="priority" name="priority" defaultValue="MEDIUM" className={selectCls}>
          {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{TICKET_PRIORITY_LABEL[p]}</option>)}
        </select>
      </div>

      {fields.length > 0 && (
        <div className="grid gap-4 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
          {fields.map((f) => <FieldInput key={f.id} field={f} />)}
        </div>
      )}

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>{pending ? "Submitting…" : "Submit ticket"}</Button>
      </div>
    </form>
  );
}

function FieldInput({ field }: { field: PubField }) {
  const name = `cf:${field.id}`;
  const req = field.required;
  const label = <Label htmlFor={name}>{field.name}{req && <span className="text-destructive"> *</span>}</Label>;
  switch (field.kind) {
    case "TEXTAREA":
      return <div className="flex flex-col gap-1.5 sm:col-span-2">{label}<Textarea id={name} name={name} rows={3} required={req} /></div>;
    case "NUMBER":
      return <div className="flex flex-col gap-1.5">{label}<Input id={name} name={name} type="number" step="any" required={req} /></div>;
    case "DATE":
      return <div className="flex flex-col gap-1.5">{label}<Input id={name} name={name} type="date" required={req} /></div>;
    case "CHECKBOX":
      return <label className="flex items-center gap-2 text-sm sm:col-span-2"><input id={name} name={name} type="checkbox" className="accent-primary" /> {field.name}</label>;
    case "SELECT":
      return <div className="flex flex-col gap-1.5">{label}<select id={name} name={name} defaultValue="" required={req} className={selectCls}><option value="">—</option>{field.options.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>;
    case "MULTISELECT":
      return (
        <div className="flex flex-col gap-1.5 sm:col-span-2">{label}
          <div className="flex flex-wrap gap-2">{field.options.map((o) => <label key={o} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm"><input type="checkbox" name={name} value={o} className="accent-primary" /> {o}</label>)}</div>
        </div>
      );
    default:
      return <div className="flex flex-col gap-1.5">{label}<Input id={name} name={name} required={req} /></div>;
  }
}
