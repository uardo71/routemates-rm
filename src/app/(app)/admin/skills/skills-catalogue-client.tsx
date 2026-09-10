"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, PencilIcon, Trash2Icon, WandSparklesIcon, XIcon, CheckIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SKILL_CATEGORIES, SKILL_CATEGORY_LABEL, type SkillCategoryKey } from "@/lib/skills";
import { saveSkillAction, deleteSkillAction, seedStarterSkillsAction } from "./actions";

type Row = { id: string; name: string; category: SkillCategoryKey; people: number };
const control = "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function SkillsCatalogueClient({ skills }: { skills: Row[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState<SkillCategoryKey>("SAP_MODULE");
  const [editing, setEditing] = useState<{ id: string; name: string; category: SkillCategoryKey } | null>(null);

  const run = (fn: () => Promise<{ error?: string }>, ok?: string) =>
    start(async () => { const r = await fn(); if (r.error) toast.error(r.error); else { if (ok) toast.success(ok); router.refresh(); } });

  function add() {
    if (!newName.trim()) return toast.error("Enter a name.");
    run(() => saveSkillAction({ name: newName.trim(), category: newCat }), "Skill added.");
    setNewName("");
  }
  function saveEdit() {
    if (!editing) return;
    run(() => saveSkillAction(editing), "Saved.");
    setEditing(null);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><SparklesIcon className="size-5 text-muted-foreground" /> Skills catalogue</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">The list people rate themselves against on their profile — SAP modules, technologies, languages, industries and methods. Keep names canonical so searches match.</p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={pending} onClick={() => start(async () => { const r = await seedStarterSkillsAction(); if (r.error) toast.error(r.error); else { toast.success(`${r.added ?? 0} skill${r.added === 1 ? "" : "s"} added.`); router.refresh(); } })}>
          <WandSparklesIcon className="size-4" /> Add SAP starter set
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-56 flex-1 flex-col gap-1"><Label className="text-xs">New skill</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. DRC (Document & Reporting Compliance)" onKeyDown={(e) => { if (e.key === "Enter") add(); }} /></div>
            <div className="flex flex-col gap-1"><Label className="text-xs">Category</Label>
              <select value={newCat} onChange={(e) => setNewCat(e.target.value as SkillCategoryKey)} className={control}>
                {SKILL_CATEGORIES.map((c) => <option key={c} value={c}>{SKILL_CATEGORY_LABEL[c]}</option>)}
              </select>
            </div>
            <Button size="sm" onClick={add} disabled={pending} className="gap-1.5"><PlusIcon className="size-4" /> Add</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {SKILL_CATEGORIES.map((cat) => {
          const rows = skills.filter((s) => s.category === cat);
          return (
            <Card key={cat}>
              <CardHeader><CardTitle className="text-base">{SKILL_CATEGORY_LABEL[cat]} <span className="font-normal text-muted-foreground">({rows.length})</span></CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-1">
                {rows.length === 0 && <p className="text-xs text-muted-foreground">Nothing here yet.</p>}
                {rows.map((s) => (
                  <div key={s.id} className={cn("flex items-center gap-2 rounded-md border px-2 py-1.5", editing?.id === s.id && "border-primary/50")}>
                    {editing?.id === s.id ? (
                      <>
                        <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="h-8 flex-1" autoFocus onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(null); }} />
                        <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as SkillCategoryKey })} className={cn(control, "h-8 text-xs")}>
                          {SKILL_CATEGORIES.map((c) => <option key={c} value={c}>{SKILL_CATEGORY_LABEL[c]}</option>)}
                        </select>
                        <Button size="sm" variant="ghost" onClick={saveEdit} disabled={pending}><CheckIcon className="size-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}><XIcon className="size-3.5" /></Button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 truncate text-sm">{s.name}</span>
                        <span className="text-[11px] text-muted-foreground" title="People who rated this skill">{s.people} {s.people === 1 ? "person" : "people"}</span>
                        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setEditing({ id: s.id, name: s.name, category: s.category })}><PencilIcon className="size-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={pending} onClick={() => { if (confirm(`Delete "${s.name}"?${s.people ? ` ${s.people} ${s.people === 1 ? "person loses" : "people lose"} this rating.` : ""}`)) run(() => deleteSkillAction(s.id), "Deleted."); }}><Trash2Icon className="size-3.5" /></Button>
                      </>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
