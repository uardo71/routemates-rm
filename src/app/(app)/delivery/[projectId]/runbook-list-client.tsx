"use client";

import * as React from "react";
import { BackLink } from "@/components/back-link";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, PencilIcon, Trash2Icon, ArrowRightIcon, RocketIcon, ClipboardCheckIcon, LayersIcon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { createCutoverPlanAction, updateCutoverPlanAction, deleteCutoverPlanAction } from "./cutover/actions";
import { createUatScriptAction, updateUatScriptAction, deleteUatScriptAction } from "./uat/actions";

// One list for both runbook kinds (cutover plans, UAT test scripts): grouped by end customer, with
// create / rename / move / delete. The editor itself lives behind each card's link.

export type RunbookKind = "cutover" | "uat";
export type RunbookItem = {
  id: string;
  name: string;
  engagementId: string | null;
  /** e.g. "6 steps · 2 done" or "12 cases" */
  meta: string;
  /** Optional status pill (UAT script status). */
  pill?: { label: string; tone: string } | null;
  updatedAt: string;
};
export type RunbookEngagement = { id: string; name: string; members: string[] };

const KIND = {
  cutover: { title: "Cutover plans", one: "cutover plan", icon: RocketIcon, blurb: "One go-live runbook per end customer, phase or wave. Each is planned, tracked and exported on its own." },
  uat: { title: "UAT test scripts", one: "UAT test script", icon: ClipboardCheckIcon, blurb: "One customer test script per end customer or test phase, each with its own draft → ready → sent governance." },
} as const;

export function RunbookListClient({
  kind, projectId, projectName, projectNumber, clientName, items, engagements, initialEngagementId, focus, canCreate, backHref,
}: {
  kind: RunbookKind;
  projectId: string;
  projectName: string;
  projectNumber: string | null;
  clientName: string;
  items: RunbookItem[];
  engagements: RunbookEngagement[];
  /** Preselects the end customer in "New" when arriving from a scoped cockpit (?eng=). */
  initialEngagementId: string | null;
  /** When set, the page shows only that end customer's runbooks (the cockpit was viewing it). */
  focus: { id: string; name: string } | null;
  canCreate: boolean;
  backHref: string;
}) {
  const router = useRouter();
  const k = KIND[kind];
  const Icon = k.icon;
  const [pending, start] = React.useTransition();
  const [dialog, setDialog] = React.useState<{ mode: "new" } | { mode: "edit"; item: RunbookItem } | null>(null);
  const [name, setName] = React.useState("");
  const [engId, setEngId] = React.useState<string>(initialEngagementId ?? "");

  const hrefOf = (id: string) => `/delivery/${projectId}/${kind}/${id}`;
  const create = kind === "cutover" ? createCutoverPlanAction : createUatScriptAction;
  const update = kind === "cutover" ? updateCutoverPlanAction : updateUatScriptAction;
  const remove = kind === "cutover" ? deleteCutoverPlanAction : deleteUatScriptAction;

  function openNew(preset?: string | null) {
    setName("");
    setEngId(preset ?? initialEngagementId ?? "");
    setDialog({ mode: "new" });
  }
  function openEdit(item: RunbookItem) {
    setName(item.name);
    setEngId(item.engagementId ?? "");
    setDialog({ mode: "edit", item });
  }
  function submit() {
    if (!name.trim()) return toast.error("Enter a name.");
    const engagementId = engId || null;
    start(async () => {
      if (!dialog) return;
      if (dialog.mode === "new") {
        const r = await create({ projectId, name: name.trim(), engagementId });
        if (r.error) { toast.error(r.error); return; }
        toast.success(`${k.one[0].toUpperCase()}${k.one.slice(1)} created.`);
        setDialog(null);
        if (r.id) router.push(hrefOf(r.id));
      } else {
        const r = await update({ id: dialog.item.id, name: name.trim(), engagementId });
        if (r.error) { toast.error(r.error); return; }
        toast.success("Saved.");
        setDialog(null);
        router.refresh();
      }
    });
  }
  function del(item: RunbookItem) {
    if (!confirm(`Delete "${item.name}"? Everything inside it is removed.`)) return;
    start(async () => {
      const r = await remove(item.id);
      if (r.error) toast.error(r.error);
      else { toast.success("Deleted."); router.refresh(); }
    });
  }

  // Group: project-level first, then each end customer in its order (empty groups still render so
  // it's obvious where a new runbook can go).
  const groups: { id: string | null; name: string; members: string[]; items: RunbookItem[] }[] = focus
    ? engagements.filter((e) => e.id === focus.id).map((e) => ({ id: e.id, name: e.name, members: e.members, items: items.filter((i) => i.engagementId === e.id) }))
    : [
        { id: null, name: engagements.length ? "Project overall" : projectName, members: [], items: items.filter((i) => i.engagementId === null) },
        ...engagements.map((e) => ({ id: e.id, name: e.name, members: e.members, items: items.filter((i) => i.engagementId === e.id) })),
      ];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <BackLink href={backHref} label="Back" />
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Icon className="size-5 text-muted-foreground" /> {k.title}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{projectName}{projectNumber ? ` · ${projectNumber}` : ""} · {clientName}</p>
            <p className="mt-1 text-xs text-muted-foreground">{k.blurb}</p>
            {focus && (
              <p className="mt-1 text-xs">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">Showing {focus.name} only</span>
                <Link href={`/delivery/${projectId}/${kind}`} className="ml-2 text-muted-foreground hover:underline">Show all end customers</Link>
              </p>
            )}
          </div>
          {canCreate && (
            <Button size="sm" className="gap-1.5" onClick={() => openNew()}><PlusIcon className="size-4" /> New {k.one}</Button>
          )}
        </div>
      </div>

      {!focus && items.length === 0 && engagements.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No {k.title.toLowerCase()} yet.{canCreate ? ` Create the first ${k.one} — you can add more for other phases or end customers later.` : ""}
        </div>
      )}

      {groups.map((g) => (
        (g.items.length > 0 || g.id !== null || engagements.length === 0) && (
          <section key={g.id ?? "project"} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <LayersIcon className="size-3.5 text-muted-foreground" /> {g.name}
              </h2>
              {g.members.length > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={g.members.join(", ")}>
                  <UsersIcon className="size-3.5" /> {g.members.length === 1 ? g.members[0] : `${g.members.length} people`}
                </span>
              )}
              {canCreate && g.id !== null && (
                <button type="button" onClick={() => openNew(g.id)} className="ml-auto text-xs text-primary hover:underline">+ New {k.one} for {g.name}</button>
              )}
            </div>
            {g.items.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">No {k.one} for {g.name} yet.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((it) => (
                  <div key={it.id} className="group relative flex flex-col gap-2 rounded-xl border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-sm">
                    <Link href={hrefOf(it.id)} className="flex items-start gap-3">
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium group-hover:underline">{it.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {it.pill && <span className={cn("rounded-full px-2 py-0.5 font-medium", it.pill.tone)}>{it.pill.label}</span>}
                          <span>{it.meta}</span>
                          <span>· updated {it.updatedAt}</span>
                        </div>
                      </div>
                      <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground/40 group-hover:text-primary" />
                    </Link>
                    {canCreate && (
                      <div className="flex items-center gap-1 self-end">
                        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-muted-foreground" onClick={() => openEdit(it)}><PencilIcon className="size-3.5" /> Rename / move</Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => del(it)} disabled={pending}><Trash2Icon className="size-3.5" /></Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )
      ))}

      {dialog && (
        <Dialog open onOpenChange={(v) => !v && setDialog(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>{dialog.mode === "new" ? `New ${k.one}` : `Edit ${k.one}`}</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "cutover" ? "e.g. Wave 1 go-live" : "e.g. UAT phase 1"} maxLength={200} autoFocus onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>End customer</Label>
                <select
                  value={engId}
                  onChange={(e) => setEngId(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="">Project overall</option>
                  {engagements.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <span className="text-[11px] text-muted-foreground">Ties the {k.one} to that end customer&apos;s section of the cockpit and to the people assigned there.</span>
              </div>
            </div>
            <DialogFooter>
              <Button size="sm" onClick={submit} disabled={pending}>{pending ? "Saving…" : dialog.mode === "new" ? "Create" : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
