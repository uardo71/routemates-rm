"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  PlusIcon, PencilIcon, Trash2Icon, ArrowUpIcon, ArrowDownIcon, StarIcon, XIcon, EyeIcon, EyeOffIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { TicketStatusCategory, TicketFieldKind } from "@prisma/client";
import {
  STATUS_CATEGORIES, STATUS_CATEGORY_LABEL, STATUS_COLOR_NAMES, statusColor,
  FIELD_KINDS, FIELD_KIND_LABEL, fieldNeedsOptions, TYPE_ICON_KEYS,
} from "@/lib/ticket-config";
import type { SlaTargets } from "@/lib/sla";
import { TypeIcon } from "../ticket-visuals";
import { SlaEditor } from "../sla-editor";
import { saveCompanySlaAction } from "../sla-actions";
import {
  createTicketTypeAction, updateTicketTypeAction, setDefaultTypeAction, deleteTicketTypeAction, moveTicketTypeAction,
  createStatusAction, updateStatusAction, setInitialStatusAction, deleteStatusAction, moveStatusAction,
  createFieldAction, updateFieldAction, deleteFieldAction,
} from "../config-actions";

type ClientStatus = { id: string; name: string; color: string | null; category: TicketStatusCategory; isInitial: boolean; customerVisible: boolean; customerCanSet: boolean };
type ClientField = { id: string; name: string; kind: string; options: string[]; required: boolean; customerVisible: boolean; customerEditable: boolean };
type ClientType = { id: string; key: string; name: string; description: string | null; icon: string | null; color: string | null; active: boolean; isDefault: boolean; customerCanCreate: boolean; slaExempt: boolean; statuses: ClientStatus[]; fields: ClientField[] };
export type SettingsConfig = { types: ClientType[]; globalFields: ClientField[] };

const selectCls = "h-9 w-full rounded-md border bg-transparent px-2 text-sm outline-none focus:border-primary/50";

type Dlg =
  | { k: "type"; type?: ClientType }
  | { k: "status"; typeId: string; status?: ClientStatus }
  | { k: "field"; typeId: string | null; field?: ClientField }
  | null;

export function TicketSettingsClient({ config, slaDefault }: { config: SettingsConfig; slaDefault: SlaTargets }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [err, setErr] = React.useState<string | null>(null);
  const [dlg, setDlg] = React.useState<Dlg>(null);

  const act = (fn: () => Promise<{ error?: string }>) => start(async () => { const r = await fn(); if (r?.error) setErr(r.error); else { setErr(null); router.refresh(); } });

  return (
    <div className="flex flex-col gap-4">
      {err && <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</p>}

      <div className="rounded-xl border bg-card p-4">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Default SLA targets</h2>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">Response &amp; resolution time per priority, in hours. Applies to every ticket unless a client has its own override (set on the client&apos;s page).</p>
        <SlaEditor initial={slaDefault} onSave={saveCompanySlaAction} saveLabel="Save default SLA" />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Ticket types</h2>
        <Button onClick={() => setDlg({ k: "type" })}><PlusIcon className="mr-1.5 size-4" /> Add type</Button>
      </div>

      {config.types.map((t, i) => (
        <div key={t.id} className={cn("rounded-xl border bg-card", !t.active && "opacity-60")}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
            <div className="flex items-center gap-2">
              <span className={cn("inline-flex size-7 items-center justify-center rounded-md", statusColor(t.color).chip)}><TypeIcon icon={t.icon} className="size-4" /></span>
              <span className="font-semibold">{t.name}</span>
              {t.isDefault && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.65rem] font-medium text-primary">Default</span>}
              {t.customerCanCreate ? <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[0.65rem] text-emerald-700 dark:text-emerald-400"><EyeIcon className="size-3" /> customer</span> : <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground"><EyeOffIcon className="size-3" /> internal</span>}
              {t.slaExempt && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground" title="No response or resolution targets">no SLA</span>}
              {!t.active && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">inactive</span>}
            </div>
            <div className="flex items-center gap-1">
              <IconBtn title="Move up" disabled={i === 0} onClick={() => act(() => moveTicketTypeAction(t.id, "up"))}><ArrowUpIcon className="size-4" /></IconBtn>
              <IconBtn title="Move down" disabled={i === config.types.length - 1} onClick={() => act(() => moveTicketTypeAction(t.id, "down"))}><ArrowDownIcon className="size-4" /></IconBtn>
              {!t.isDefault && <IconBtn title="Make default" onClick={() => act(() => setDefaultTypeAction(t.id))}><StarIcon className="size-4" /></IconBtn>}
              <IconBtn title="Edit" onClick={() => setDlg({ k: "type", type: t })}><PencilIcon className="size-4" /></IconBtn>
              <IconBtn title="Delete" onClick={() => act(() => deleteTicketTypeAction(t.id))}><Trash2Icon className="size-4 text-destructive" /></IconBtn>
            </div>
          </div>

          <div className="grid gap-4 p-3 md:grid-cols-2">
            {/* Statuses */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workflow</span>
                <button onClick={() => setDlg({ k: "status", typeId: t.id })} className="text-xs text-primary hover:underline">+ Status</button>
              </div>
              <div className="flex flex-col gap-1">
                {t.statuses.map((s, si) => (
                  <div key={s.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm">
                    <span className={cn("size-2.5 shrink-0 rounded-full", statusColor(s.color).dot)} />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="text-[0.6rem] uppercase text-muted-foreground/70">{STATUS_CATEGORY_LABEL[s.category]}</span>
                    {s.isInitial && <StarIcon className="size-3 text-amber-500" aria-label="Starting status" />}
                    {s.customerCanSet && <span title="Customer can set" className="text-[0.6rem] text-emerald-600">CS</span>}
                    {!s.customerVisible && <EyeOffIcon className="size-3 text-muted-foreground/60" aria-label="Hidden from customer" />}
                    <div className="flex items-center">
                      <IconBtn sm title="Up" disabled={si === 0} onClick={() => act(() => moveStatusAction(s.id, "up"))}><ArrowUpIcon className="size-3" /></IconBtn>
                      <IconBtn sm title="Down" disabled={si === t.statuses.length - 1} onClick={() => act(() => moveStatusAction(s.id, "down"))}><ArrowDownIcon className="size-3" /></IconBtn>
                      {!s.isInitial && <IconBtn sm title="Set start" onClick={() => act(() => setInitialStatusAction(s.id))}><StarIcon className="size-3" /></IconBtn>}
                      <IconBtn sm title="Edit" onClick={() => setDlg({ k: "status", typeId: t.id, status: s })}><PencilIcon className="size-3" /></IconBtn>
                      <IconBtn sm title="Delete" onClick={() => act(() => deleteStatusAction(s.id))}><Trash2Icon className="size-3 text-destructive" /></IconBtn>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Fields */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custom fields</span>
                <button onClick={() => setDlg({ k: "field", typeId: t.id })} className="text-xs text-primary hover:underline">+ Field</button>
              </div>
              {t.fields.length === 0 ? <p className="text-xs text-muted-foreground">No fields.</p> : (
                <div className="flex flex-col gap-1">
                  {t.fields.map((f) => <FieldRow key={f.id} f={f} onEdit={() => setDlg({ k: "field", typeId: t.id, field: f })} onDelete={() => act(() => deleteFieldAction(f.id))} />)}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Global fields */}
      <div className="rounded-xl border bg-card p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold">Fields on every type</span>
            <p className="text-xs text-muted-foreground">Custom fields shown on tickets of all types.</p>
          </div>
          <button onClick={() => setDlg({ k: "field", typeId: null })} className="text-xs text-primary hover:underline">+ Field</button>
        </div>
        {config.globalFields.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : (
          <div className="flex flex-col gap-1">
            {config.globalFields.map((f) => <FieldRow key={f.id} f={f} onEdit={() => setDlg({ k: "field", typeId: null, field: f })} onDelete={() => act(() => deleteFieldAction(f.id))} />)}
          </div>
        )}
      </div>

      {dlg?.k === "type" && <TypeDialog type={dlg.type} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); router.refresh(); }} />}
      {dlg?.k === "status" && <StatusDialog typeId={dlg.typeId} status={dlg.status} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); router.refresh(); }} />}
      {dlg?.k === "field" && <FieldDialog typeId={dlg.typeId} field={dlg.field} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); router.refresh(); }} />}
      {pending && <span className="sr-only">Saving…</span>}
    </div>
  );
}

function IconBtn({ children, onClick, disabled, title, sm }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; title: string; sm?: boolean }) {
  return <button title={title} onClick={onClick} disabled={disabled} className={cn("rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30", sm ? "p-0.5" : "p-1")}>{children}</button>;
}

function FieldRow({ f, onEdit, onDelete }: { f: ClientField; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm">
      <span className="min-w-0 flex-1 truncate">{f.name}</span>
      <span className="rounded bg-muted px-1.5 py-0.5 text-[0.6rem] text-muted-foreground">{FIELD_KIND_LABEL[f.kind as keyof typeof FIELD_KIND_LABEL] ?? f.kind}</span>
      {f.required && <span className="text-[0.6rem] text-rose-600">req</span>}
      {!f.customerVisible && <EyeOffIcon className="size-3 text-muted-foreground/60" aria-label="Hidden from customer" />}
      {f.customerEditable && <span title="Customer can edit" className="text-[0.6rem] text-emerald-600">CE</span>}
      <IconBtn sm title="Edit" onClick={onEdit}><PencilIcon className="size-3" /></IconBtn>
      <IconBtn sm title="Delete" onClick={onDelete}><Trash2Icon className="size-3 text-destructive" /></IconBtn>
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {STATUS_COLOR_NAMES.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} className={cn("size-6 rounded-full border-2", statusColor(c).dot, value === c ? "border-foreground" : "border-transparent")} title={c} />
      ))}
    </div>
  );
}

function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TYPE_ICON_KEYS.map((k) => (
        <button key={k} type="button" onClick={() => onChange(k)} className={cn("inline-flex size-8 items-center justify-center rounded-md border", value === k ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")} title={k}><TypeIcon icon={k} className="size-4" /></button>
      ))}
    </div>
  );
}

function useSave(onSaved: () => void) {
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const run = async (fn: () => Promise<{ error?: string }>) => {
    setSaving(true); setErr(null);
    const r = await fn(); setSaving(false);
    if (r.error) setErr(r.error); else onSaved();
  };
  return { saving, err, run };
}

function TypeDialog({ type, onClose, onSaved }: { type?: ClientType; onClose: () => void; onSaved: () => void }) {
  const { saving, err, run } = useSave(onSaved);
  const [name, setName] = React.useState(type?.name ?? "");
  const [icon, setIcon] = React.useState(type?.icon ?? "ticket");
  const [color, setColor] = React.useState(type?.color ?? "sky");
  const [description, setDescription] = React.useState(type?.description ?? "");
  const [customerCanCreate, setCcc] = React.useState(type?.customerCanCreate ?? true);
  const [slaExempt, setSlaExempt] = React.useState(type?.slaExempt ?? false);
  const [active, setActive] = React.useState(type?.active ?? true);

  return (
    <Dialog open disablePointerDismissal onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{type ? "Edit type" : "New type"}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bug" /></div>
          <div className="flex flex-col gap-1"><Label>Icon</Label><IconPicker value={icon} onChange={setIcon} /></div>
          <div className="flex flex-col gap-1"><Label>Colour</Label><ColorPicker value={color} onChange={setColor} /></div>
          <div className="flex flex-col gap-1"><Label>Description</Label><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={customerCanCreate} onChange={(e) => setCcc(e.target.checked)} className="accent-primary" /> Customers can raise this type from the portal</label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={slaExempt} onChange={(e) => setSlaExempt(e.target.checked)} className="mt-0.5 accent-primary" /> <span>No SLA — no response or resolution targets<span className="block text-xs text-muted-foreground">Existing tickets of this type are updated when you save.</span></span></label>
          {type && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-primary" /> Active</label>}
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !name.trim()} onClick={() => run(() => type ? updateTicketTypeAction(type.id, { name, icon, color, description, customerCanCreate, slaExempt, active }) : createTicketTypeAction({ name, icon, color, description, customerCanCreate, slaExempt }))}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({ typeId, status, onClose, onSaved }: { typeId: string; status?: ClientStatus; onClose: () => void; onSaved: () => void }) {
  const { saving, err, run } = useSave(onSaved);
  const [name, setName] = React.useState(status?.name ?? "");
  const [color, setColor] = React.useState(status?.color ?? "gray");
  const [category, setCategory] = React.useState<TicketStatusCategory>(status?.category ?? "OPEN");
  const [customerVisible, setCv] = React.useState(status?.customerVisible ?? true);
  const [customerCanSet, setCcs] = React.useState(status?.customerCanSet ?? false);

  return (
    <Dialog open disablePointerDismissal onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{status ? "Edit status" : "New status"}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. In review" /></div>
          <div className="flex flex-col gap-1"><Label>Stage (drives SLA &amp; board)</Label>
            <select value={category} onChange={(e) => setCategory(e.target.value as TicketStatusCategory)} className={selectCls}>{STATUS_CATEGORIES.map((c) => <option key={c} value={c}>{STATUS_CATEGORY_LABEL[c]}</option>)}</select>
            <p className="text-xs text-muted-foreground">Open &amp; In progress keep SLA clocks running; Done &amp; Cancelled stop them.</p>
          </div>
          <div className="flex flex-col gap-1"><Label>Colour</Label><ColorPicker value={color} onChange={setColor} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={customerVisible} onChange={(e) => setCv(e.target.checked)} className="accent-primary" /> Visible to customers</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={customerCanSet} onChange={(e) => setCcs(e.target.checked)} className="accent-primary" /> Customers can move a ticket into this status</label>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !name.trim()} onClick={() => run(() => status ? updateStatusAction(status.id, { name, color, category, customerVisible, customerCanSet }) : createStatusAction(typeId, { name, color, category, customerVisible, customerCanSet }))}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FieldDialog({ typeId, field, onClose, onSaved }: { typeId: string | null; field?: ClientField; onClose: () => void; onSaved: () => void }) {
  const { saving, err, run } = useSave(onSaved);
  const [name, setName] = React.useState(field?.name ?? "");
  const [kind, setKind] = React.useState<TicketFieldKind>((field?.kind as TicketFieldKind) ?? "TEXT");
  const [options, setOptions] = React.useState<string[]>(field?.options ?? []);
  const [optInput, setOptInput] = React.useState("");
  const [required, setReq] = React.useState(field?.required ?? false);
  const [customerVisible, setCv] = React.useState(field?.customerVisible ?? true);
  const [customerEditable, setCe] = React.useState(field?.customerEditable ?? false);
  const needsOpts = fieldNeedsOptions(kind as (typeof FIELD_KINDS)[number]);
  const addOpt = () => { const v = optInput.trim(); if (v && !options.includes(v)) { setOptions((o) => [...o, v]); setOptInput(""); } };

  return (
    <Dialog open disablePointerDismissal onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{field ? "Edit field" : "New field"}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Severity" /></div>
          <div className="flex flex-col gap-1"><Label>Type</Label>
            <select value={kind} onChange={(e) => setKind(e.target.value as TicketFieldKind)} className={selectCls}>{FIELD_KINDS.map((k) => <option key={k} value={k}>{FIELD_KIND_LABEL[k]}</option>)}</select>
          </div>
          {needsOpts && (
            <div className="flex flex-col gap-1">
              <Label>Options</Label>
              <div className="flex flex-wrap gap-1">
                {options.map((o) => <span key={o} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">{o}<button onClick={() => setOptions((x) => x.filter((v) => v !== o))}><XIcon className="size-3" /></button></span>)}
              </div>
              <div className="flex gap-2"><Input value={optInput} onChange={(e) => setOptInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOpt(); } }} placeholder="Add option, press Enter" className="h-8" /><Button size="sm" variant="outline" onClick={addOpt}>Add</Button></div>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={required} onChange={(e) => setReq(e.target.checked)} className="accent-primary" /> Required</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={customerVisible} onChange={(e) => setCv(e.target.checked)} className="accent-primary" /> Visible to customers</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={customerEditable} onChange={(e) => setCe(e.target.checked)} className="accent-primary" /> Customers can edit</label>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !name.trim()} onClick={() => run(() => field ? updateFieldAction(field.id, { typeId, name, kind, options, required, customerVisible, customerEditable }) : createFieldAction({ typeId, name, kind, options, required, customerVisible, customerEditable }))}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
