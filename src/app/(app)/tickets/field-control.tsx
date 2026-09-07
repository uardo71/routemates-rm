"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export type PubField = { id: string; key: string; name: string; kind: string; options: string[]; required: boolean };
type Opt = { id: string; name: string };
const selectCls = "h-9 w-full rounded-md border bg-transparent px-2 text-sm outline-none focus:border-primary/50";

export function FieldControl({ field, value, onChange, users }: {
  field: PubField; value: unknown; onChange: (v: unknown) => void; users: Opt[];
}) {
  const id = `f-${field.id}`;
  const label = <Label htmlFor={id}>{field.name}{field.required && <span className="text-destructive"> *</span>}</Label>;
  switch (field.kind) {
    case "TEXTAREA":
      return <div className="flex flex-col gap-1 sm:col-span-2">{label}<Textarea id={id} rows={3} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} /></div>;
    case "NUMBER":
      return <div className="flex flex-col gap-1">{label}<Input id={id} type="number" step="any" value={value === null || value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value)} /></div>;
    case "DATE":
      return <div className="flex flex-col gap-1">{label}<Input id={id} type="date" value={String(value ?? "").slice(0, 10)} onChange={(e) => onChange(e.target.value)} /></div>;
    case "CHECKBOX":
      return <label className="flex items-center gap-2 text-sm sm:col-span-2"><input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="accent-primary" /> {field.name}</label>;
    case "SELECT":
      return <div className="flex flex-col gap-1">{label}<select id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={selectCls}><option value="">—</option>{field.options.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>;
    case "USER":
      return <div className="flex flex-col gap-1">{label}<select id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={selectCls}><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>;
    case "MULTISELECT": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (o: string) => onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o]);
      return (
        <div className="flex flex-col gap-1 sm:col-span-2">{label}
          <div className="flex flex-wrap gap-2">{field.options.map((o) => <label key={o} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm"><input type="checkbox" checked={arr.includes(o)} onChange={() => toggle(o)} className="accent-primary" /> {o}</label>)}</div>
        </div>
      );
    }
    default:
      return <div className="flex flex-col gap-1">{label}<Input id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} /></div>;
  }
}
