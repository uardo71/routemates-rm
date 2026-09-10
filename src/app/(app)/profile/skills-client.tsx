"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon, PencilIcon, PaperclipIcon, UploadIcon, XIcon, AwardIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  SKILL_CATEGORIES, SKILL_CATEGORY_LABEL, SKILL_LEVELS, SKILL_LEVEL_LABEL, LEVEL_TONE,
  certificationStatus, CERT_STATUS_LABEL, CERT_STATUS_TONE, type SkillCategoryKey, type SkillLevel,
} from "@/lib/skills";
import {
  setMySkillAction, removeMySkillAction, saveMyCertificationAction, deleteMyCertificationAction,
  uploadMyCertificateAction, removeMyCertificateFileAction,
} from "./skills-actions";

export type CatalogueSkill = { id: string; name: string; category: SkillCategoryKey };
export type MySkill = { skillId: string; level: number; lastUsedYear: number | null };
export type MyCertification = {
  id: string; name: string; issuer: string | null; issuedDate: string | null; expiryDate: string | null;
  file: { fileName: string; originalName: string } | null;
};

const control = "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Five clickable dots: the level selector used in the skills table. */
export function LevelPicker({ value, onChange, disabled }: { value: number; onChange: (l: SkillLevel) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Level">
      {SKILL_LEVELS.map((l) => (
        <button
          key={l} type="button" role="radio" aria-checked={value === l} disabled={disabled}
          title={`${l} — ${SKILL_LEVEL_LABEL[l]}`} onClick={() => onChange(l)}
          className={cn("size-5 rounded-full border text-[10px] font-semibold transition", l <= value ? cn("border-transparent", LEVEL_TONE[value as SkillLevel]) : "border-border text-transparent hover:border-primary/60")}
        >{l}</button>
      ))}
      <span className="ml-1.5 text-xs text-muted-foreground">{SKILL_LEVEL_LABEL[value as SkillLevel] ?? ""}</span>
    </div>
  );
}

export function SkillsClient({ catalogue, mine, certifications, today }: { catalogue: CatalogueSkill[]; mine: MySkill[]; certifications: MyCertification[]; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [addSkillId, setAddSkillId] = useState("");
  const [addLevel, setAddLevel] = useState<SkillLevel>(3);
  const [addYear, setAddYear] = useState("");
  const [certDialog, setCertDialog] = useState<MyCertification | { id?: undefined } | null>(null);
  const [cName, setCName] = useState(""); const [cIssuer, setCIssuer] = useState(""); const [cIssued, setCIssued] = useState(""); const [cExpiry, setCExpiry] = useState("");
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const byId = useMemo(() => new Map(catalogue.map((s) => [s.id, s])), [catalogue]);
  const mineIds = new Set(mine.map((m) => m.skillId));
  const available = catalogue.filter((s) => !mineIds.has(s.id));
  const grouped = SKILL_CATEGORIES.map((cat) => ({ cat, rows: mine.filter((m) => byId.get(m.skillId)?.category === cat).sort((a, b) => b.level - a.level || (byId.get(a.skillId)?.name ?? "").localeCompare(byId.get(b.skillId)?.name ?? "")) })).filter((g) => g.rows.length > 0);

  const run = (fn: () => Promise<{ error?: string }>, ok?: string) =>
    start(async () => { const r = await fn(); if (r.error) toast.error(r.error); else { if (ok) toast.success(ok); router.refresh(); } });

  function addSkill() {
    if (!addSkillId) return toast.error("Pick a skill.");
    run(() => setMySkillAction({ skillId: addSkillId, level: addLevel, lastUsedYear: addYear ? Number(addYear) : null }), "Skill added.");
    setAddSkillId(""); setAddLevel(3); setAddYear("");
  }
  function openCert(c: MyCertification | null) {
    setCName(c?.name ?? ""); setCIssuer(c?.issuer ?? ""); setCIssued(c?.issuedDate ?? ""); setCExpiry(c?.expiryDate ?? "");
    setCertDialog(c ?? {});
  }
  function saveCert() {
    const id = certDialog && "name" in certDialog ? certDialog.id : undefined;
    start(async () => {
      const r = await saveMyCertificationAction({ id, name: cName, issuer: cIssuer || null, issuedDate: cIssued || null, expiryDate: cExpiry || null });
      if (r.error) { toast.error(r.error); return; }
      toast.success("Saved."); setCertDialog(null); router.refresh();
    });
  }
  function upload(certId: string, file: File | null) {
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    run(() => uploadMyCertificateAction(certId, fd), "Certificate attached.");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ---------------- skills ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><SparklesIcon className="size-4 text-muted-foreground" /> Skills</CardTitle>
          <CardDescription>Rate yourself 1 (basic) to 5 (expert). Staffing searches and the team matrix read these — keep them honest and current.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {mine.length === 0 && <p className="text-sm text-muted-foreground">No skills yet — add your SAP modules, technologies, languages and industries below.</p>}
          {grouped.map((g) => (
            <div key={g.cat} className="flex flex-col gap-1.5">
              <div className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">{SKILL_CATEGORY_LABEL[g.cat]}</div>
              {g.rows.map((m) => {
                const s = byId.get(m.skillId)!;
                return (
                  <div key={m.skillId} className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2">
                    <span className="min-w-40 flex-1 text-sm font-medium">{s.name}</span>
                    <LevelPicker value={m.level} disabled={pending} onChange={(l) => run(() => setMySkillAction({ skillId: m.skillId, level: l, lastUsedYear: m.lastUsedYear }))} />
                    <input
                      type="number" min={1990} max={2100} placeholder="last used" defaultValue={m.lastUsedYear ?? ""} title="Year last used"
                      onBlur={(e) => { const y = e.target.value ? Number(e.target.value) : null; if (y !== m.lastUsedYear) run(() => setMySkillAction({ skillId: m.skillId, level: m.level, lastUsedYear: y })); }}
                      className={cn(control, "h-8 w-24 text-xs")}
                    />
                    <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={pending} onClick={() => run(() => removeMySkillAction(m.skillId), "Removed.")}><Trash2Icon className="size-3.5" /></Button>
                  </div>
                );
              })}
            </div>
          ))}

          <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label className="text-xs">Add a skill</Label>
              <select value={addSkillId} onChange={(e) => setAddSkillId(e.target.value)} className={control}>
                <option value="">Pick from the catalogue…</option>
                {SKILL_CATEGORIES.map((cat) => {
                  const opts = available.filter((s) => s.category === cat);
                  return opts.length ? (
                    <optgroup key={cat} label={SKILL_CATEGORY_LABEL[cat]}>
                      {opts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </optgroup>
                  ) : null;
                })}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Level</Label>
              <LevelPicker value={addLevel} onChange={setAddLevel} />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Last used</Label>
              <Input type="number" min={1990} max={2100} value={addYear} onChange={(e) => setAddYear(e.target.value)} placeholder="2026" className="h-9 w-24" />
            </div>
            <Button size="sm" onClick={addSkill} disabled={pending || !addSkillId} className="gap-1.5"><PlusIcon className="size-4" /> Add</Button>
            {available.length === 0 && catalogue.length > 0 && <span className="text-xs text-muted-foreground">You have rated every skill in the catalogue.</span>}
            {catalogue.length === 0 && <span className="text-xs text-muted-foreground">The catalogue is empty — ask an administrator to add skills.</span>}
          </div>
        </CardContent>
      </Card>

      {/* ---------------- certifications ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><AwardIcon className="size-4 text-muted-foreground" /> Certifications</CardTitle>
          <CardDescription>Attach the certificate and keep the expiry date right — you and the administrators get a reminder 90 and 30 days before it lapses.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {certifications.length === 0 && <p className="text-sm text-muted-foreground">No certifications yet.</p>}
          {certifications.map((c) => {
            const status = certificationStatus(c.expiryDate, today);
            return (
              <div key={c.id} className="flex flex-col gap-2 rounded-md border px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{c.name}</span>
                  {c.issuer && <span className="text-xs text-muted-foreground">· {c.issuer}</span>}
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", CERT_STATUS_TONE[status])}>{CERT_STATUS_LABEL[status]}</span>
                  <span className="ml-auto flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => openCert(c)}><PencilIcon className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={pending} onClick={() => { if (confirm(`Delete "${c.name}"?`)) run(() => deleteMyCertificationAction(c.id), "Deleted."); }}><Trash2Icon className="size-3.5" /></Button>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Issued {c.issuedDate ?? "—"}</span>
                  <span>Expires {c.expiryDate ?? "—"}</span>
                  {c.file ? (
                    <span className="inline-flex items-center gap-1.5">
                      <a href={`/api/documents/${c.file.fileName}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><PaperclipIcon className="size-3" /> {c.file.originalName}</a>
                      <button type="button" title="Remove file" disabled={pending} onClick={() => run(() => removeMyCertificateFileAction(c.id), "File removed.")} className="text-muted-foreground hover:text-destructive"><XIcon className="size-3" /></button>
                    </span>
                  ) : (
                    <label className="inline-flex cursor-pointer items-center gap-1 text-primary hover:underline">
                      <UploadIcon className="size-3" /> Attach certificate
                      <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden" ref={(el) => { fileRefs.current[c.id] = el; }} onChange={(e) => upload(c.id, e.target.files?.[0] ?? null)} />
                    </label>
                  )}
                </div>
              </div>
            );
          })}
          <Button size="sm" variant="outline" className="w-fit gap-1.5" onClick={() => openCert(null)}><PlusIcon className="size-4" /> Add certification</Button>
        </CardContent>
      </Card>

      {certDialog && (
        <Dialog open onOpenChange={(v) => !v && setCertDialog(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>{"name" in certDialog ? "Edit certification" : "Add certification"}</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div className="flex flex-col gap-1.5"><Label htmlFor="c-name">Name</Label><Input id="c-name" value={cName} onChange={(e) => setCName(e.target.value)} placeholder="e.g. SAP Certified Associate — S/4HANA Finance" autoFocus /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="c-issuer">Issuer</Label><Input id="c-issuer" value={cIssuer} onChange={(e) => setCIssuer(e.target.value)} placeholder="SAP, PMI, Scrum.org…" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5"><Label htmlFor="c-issued">Issued</Label><Input id="c-issued" type="date" value={cIssued} onChange={(e) => setCIssued(e.target.value)} /></div>
                <div className="flex flex-col gap-1.5"><Label htmlFor="c-expiry">Expires</Label><Input id="c-expiry" type="date" value={cExpiry} onChange={(e) => setCExpiry(e.target.value)} /></div>
              </div>
              <p className="text-[11px] text-muted-foreground">Leave &quot;Expires&quot; empty for certifications that never lapse.</p>
            </div>
            <DialogFooter>
              <Button size="sm" variant="outline" onClick={() => setCertDialog(null)}>Cancel</Button>
              <Button size="sm" onClick={saveCert} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
