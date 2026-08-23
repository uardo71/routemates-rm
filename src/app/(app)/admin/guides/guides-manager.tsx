"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, PencilIcon, Trash2Icon, EyeIcon, EyeOffIcon, GripVerticalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { GUIDE_CATEGORIES, GUIDE_CATEGORY_LABEL } from "@/lib/guides";
import type { Guide } from "@/lib/guides-server";
import { createGuideAction, updateGuideAction, deleteGuideAction, toggleGuideAction } from "./actions";

const CAT_ITEMS = GUIDE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }));

export function GuidesManager({ guides }: { guides: Guide[] }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<Guide | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function onToggle(g: Guide) {
    setBusyId(g.id);
    await toggleGuideAction(g.id, !g.active);
    setBusyId(null);
    router.refresh();
  }
  async function onDelete(g: Guide) {
    if (!confirm(`Delete “${g.title}”? This can't be undone.`)) return;
    setBusyId(g.id);
    await deleteGuideAction(g.id);
    setBusyId(null);
    router.refresh();
  }

  // Group by category, in canonical order.
  const order = new Map<string, number>(GUIDE_CATEGORIES.map((c, i) => [c.value, i]));
  const sorted = [...guides].sort(
    (a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99) || a.sortOrder - b.sortOrder,
  );
  const groups = new Map<string, Guide[]>();
  for (const g of sorted) (groups.get(g.category) ?? groups.set(g.category, []).get(g.category)!).push(g);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {guides.filter((g) => g.active).length} active · {guides.length} total
        </p>
        <Button onClick={() => setCreating(true)} className="gap-2">
          <PlusIcon className="size-4" /> Add guide
        </Button>
      </div>

      <div className="flex flex-col gap-5">
        {[...groups.entries()].map(([cat, items]) => (
          <section key={cat}>
            <h2 className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {GUIDE_CATEGORY_LABEL[cat] ?? cat}
            </h2>
            <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
              {items.map((g) => (
                <div
                  key={g.id}
                  className={cn(
                    "flex items-start gap-3 border-b px-4 py-3 last:border-none",
                    !g.active && "opacity-55",
                  )}
                >
                  <GripVerticalIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground/40" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{g.title}</span>
                      {!g.active && <Badge variant="secondary" className="text-[10px]">Hidden</Badge>}
                    </div>
                    {g.summary && <p className="mt-0.5 text-xs text-muted-foreground">{g.summary}</p>}
                    <p className="mt-1 text-xs text-muted-foreground/80">
                      {g.steps.length} step{g.steps.length === 1 ? "" : "s"}
                      {g.source ? ` · ${g.source}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon-sm" disabled={busyId === g.id} onClick={() => onToggle(g)} title={g.active ? "Hide from cockpit" : "Show in cockpit"}>
                      {g.active ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setEditing(g)} title="Edit">
                      <PencilIcon className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" disabled={busyId === g.id} onClick={() => onDelete(g)} title="Delete" className="text-destructive hover:text-destructive">
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        {guides.length === 0 && (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            No guides yet. Add the first one.
          </div>
        )}
      </div>

      {creating && <GuideDialog onClose={() => setCreating(false)} />}
      {editing && <GuideDialog guide={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function GuideDialog({ guide, onClose }: { guide?: Guide; onClose: () => void }) {
  const router = useRouter();
  const isEdit = !!guide;
  const action = isEdit ? updateGuideAction.bind(null, guide!.id) : createGuideAction;
  const [state, formAction, pending] = React.useActionState(action, undefined as { error?: string; ok?: boolean } | undefined);

  React.useEffect(() => {
    if (state?.ok) {
      onClose();
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open disablePointerDismissal onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit guide" : "New guide"}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Situation</Label>
            <Input id="title" name="title" required defaultValue={guide?.title} placeholder="A customer asks for extra work" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category">Category</Label>
            <Select name="category" defaultValue={guide?.category ?? "general"} items={CAT_ITEMS}>
              <SelectTrigger id="category" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CAT_ITEMS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="summary">When to use it <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="summary" name="summary" defaultValue={guide?.summary ?? ""} placeholder="Someone requests something that wasn't agreed." />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="steps">Steps — one per line</Label>
            <Textarea id="steps" name="steps" required rows={7} defaultValue={guide?.steps.join("\n")} placeholder={"Don't commit on the spot.\nCheck the SoW — is it in scope?\nLog a change request if not."} />
            <p className="text-xs text-muted-foreground">Each line becomes a numbered step.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="source">Source <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="source" name="source" defaultValue={guide?.source ?? ""} placeholder="SOP: Change Requests" />
          </div>
          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
          <div className="mt-1 flex justify-end gap-2 border-t pt-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : isEdit ? "Save changes" : "Add guide"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
