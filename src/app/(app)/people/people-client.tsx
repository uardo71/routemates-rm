"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserSearchIcon, PlusIcon, XIcon, LayoutGridIcon, AwardIcon, AlertTriangleIcon, CheckIcon, MinusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InitialsAvatar } from "@/components/initials-avatar";
import { RoleBadge } from "@/components/role-badge";
import { LevelPill } from "@/components/skills-summary";
import { avatarSrc } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { SKILL_CATEGORIES, SKILL_CATEGORY_LABEL, SKILL_LEVELS, SKILL_LEVEL_LABEL, serializeRequirements, type SkillRequirement, type SkillCategoryKey } from "@/lib/skills";
import type { SystemRole } from "@prisma/client";

export type PeopleSkill = { id: string; name: string; category: SkillCategoryKey };
export type PeopleResult = {
  userId: string; name: string; role: SystemRole; title: string | null; avatarUrl: string | null;
  meetsAll: boolean; score: number;
  met: { skillId: string; level: number; minLevel: number }[];
  missing: { skillId: string; level: number | null; minLevel: number }[];
  skills: { skillId: string; level: number; lastUsedYear: number | null }[];
  freeTotal: number; availableTotal: number; minWeekFree: number;
  certifications: number; expiringCerts: number;
};

const control = "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const fmtH = (n: number) => `${Math.round(n)}h`;

export function PeopleClient({ skills, requirements, start, weeks, minFree, showAll, results, totalPeople }: {
  skills: PeopleSkill[]; requirements: SkillRequirement[]; start: string; weeks: number; minFree: number; showAll: boolean; results: PeopleResult[]; totalPeople: number;
}) {
  const router = useRouter();
  const byId = useMemo(() => new Map(skills.map((s) => [s.id, s])), [skills]);
  const [reqs, setReqs] = useState<SkillRequirement[]>(requirements);
  const [pick, setPick] = useState("");
  const [pickLevel, setPickLevel] = useState(3);
  const [startV, setStartV] = useState(start);
  const [weeksV, setWeeksV] = useState(String(weeks));
  const [minFreeV, setMinFreeV] = useState(minFree ? String(minFree) : "");
  const [q, setQ] = useState("");

  function apply(next: Partial<{ reqs: SkillRequirement[]; start: string; weeks: string; minFree: string; all: boolean }> = {}) {
    const p = new URLSearchParams();
    const r = next.reqs ?? reqs;
    if (r.length) p.set("skills", serializeRequirements(r));
    const s = next.start ?? startV; if (s) p.set("start", s);
    const w = next.weeks ?? weeksV; if (w && Number(w) !== 8) p.set("weeks", w);
    const mf = next.minFree ?? minFreeV; if (mf && Number(mf) > 0) p.set("minFree", mf);
    if (next.all ?? showAll) p.set("all", "1");
    router.push(`/people${p.size ? `?${p.toString()}` : ""}`);
  }
  function addReq() {
    if (!pick || reqs.some((r) => r.skillId === pick)) return;
    const next = [...reqs, { skillId: pick, minLevel: pickLevel }];
    setReqs(next); setPick(""); apply({ reqs: next });
  }
  function removeReq(id: string) { const next = reqs.filter((r) => r.skillId !== id); setReqs(next); apply({ reqs: next }); }
  function setReqLevel(id: string, lvl: number) { const next = reqs.map((r) => (r.skillId === id ? { ...r, minLevel: lvl } : r)); setReqs(next); apply({ reqs: next }); }

  const shown = results.filter((r) => !q.trim() || `${r.name} ${r.title ?? ""} ${r.skills.map((s) => byId.get(s.skillId)?.name ?? "").join(" ")}`.toLowerCase().includes(q.trim().toLowerCase()));
  const full = shown.filter((r) => r.meetsAll).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><UserSearchIcon className="size-5 text-muted-foreground" /> Find people</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Staff from a filter, not from memory: required skills with a minimum level, plus who actually has free hours in the window.</p>
        </div>
        <Link href="/people/matrix" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:border-primary/50 hover:text-primary"><LayoutGridIcon className="size-4" /> Skills matrix</Link>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-4">
          {/* requirements */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs">Required skills</Label>
            <div className="flex flex-wrap items-center gap-2">
              {reqs.map((r) => {
                const s = byId.get(r.skillId);
                return (
                  <span key={r.skillId} className="inline-flex items-center gap-1.5 rounded-full border bg-primary/5 py-1 pl-3 pr-1 text-sm">
                    {s?.name ?? r.skillId}
                    <span className="text-xs text-muted-foreground">≥</span>
                    <select value={r.minLevel} onChange={(e) => setReqLevel(r.skillId, Number(e.target.value))} className="h-6 rounded border border-input bg-background px-1 text-xs" title="Minimum level">
                      {SKILL_LEVELS.map((l) => <option key={l} value={l}>{l} · {SKILL_LEVEL_LABEL[l]}</option>)}
                    </select>
                    <button type="button" onClick={() => removeReq(r.skillId)} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><XIcon className="size-3.5" /></button>
                  </span>
                );
              })}
              <select value={pick} onChange={(e) => setPick(e.target.value)} className={cn(control, "min-w-56")}>
                <option value="">Add a skill…</option>
                {SKILL_CATEGORIES.map((cat) => {
                  const opts = skills.filter((s) => s.category === cat && !reqs.some((r) => r.skillId === s.id));
                  return opts.length ? <optgroup key={cat} label={SKILL_CATEGORY_LABEL[cat]}>{opts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup> : null;
                })}
              </select>
              <select value={pickLevel} onChange={(e) => setPickLevel(Number(e.target.value))} className={control} title="Minimum level">
                {SKILL_LEVELS.map((l) => <option key={l} value={l}>≥ {l} · {SKILL_LEVEL_LABEL[l]}</option>)}
              </select>
              <Button size="sm" onClick={addReq} disabled={!pick} className="gap-1.5"><PlusIcon className="size-4" /> Require</Button>
            </div>
          </div>

          {/* window + availability */}
          <div className="flex flex-wrap items-end gap-3 border-t pt-3">
            <div className="flex flex-col gap-1"><Label className="text-xs">Starting</Label><Input type="date" value={startV} onChange={(e) => setStartV(e.target.value)} className="h-9 w-40" /></div>
            <div className="flex flex-col gap-1"><Label className="text-xs">Weeks</Label><Input type="number" min={1} max={26} value={weeksV} onChange={(e) => setWeeksV(e.target.value)} className="h-9 w-20" /></div>
            <div className="flex flex-col gap-1"><Label className="text-xs">Min free hours in window</Label><Input type="number" min={0} value={minFreeV} onChange={(e) => setMinFreeV(e.target.value)} placeholder="any" className="h-9 w-28" /></div>
            <Button size="sm" variant="outline" onClick={() => apply()}>Apply window</Button>
            <label className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={showAll} onChange={(e) => apply({ all: e.target.checked })} className="accent-primary" /> Show people missing every requirement
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>{reqs.length ? <><span className="font-medium text-foreground">{full}</span> of {totalPeople} people meet every requirement</> : <><span className="font-medium text-foreground">{shown.length}</span> people, ranked by free hours</>} · window {start} + {weeks} wk</span>
        <div className="relative ml-auto">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or skill…" className="h-8 w-56" />
        </div>
      </div>

      <Card>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  {reqs.map((r) => <TableHead key={r.skillId} className="whitespace-nowrap text-center">{byId.get(r.skillId)?.name ?? r.skillId}<span className="ml-1 text-[10px] text-muted-foreground">≥{r.minLevel}</span></TableHead>)}
                  <TableHead>Other strengths</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Free in window</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Min week</TableHead>
                  <TableHead className="text-right">Certs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.length === 0 && (
                  <TableRow><TableCell colSpan={5 + reqs.length} className="py-10 text-center text-sm text-muted-foreground">{reqs.length ? "Nobody matches. Lower a minimum level, drop a requirement, or widen the window." : "No people found."}</TableCell></TableRow>
                )}
                {shown.map((r) => {
                  const reqIds = new Set(reqs.map((x) => x.skillId));
                  const others = r.skills.filter((s) => !reqIds.has(s.skillId) && s.level >= 4).sort((a, b) => b.level - a.level).slice(0, 6);
                  const pct = r.availableTotal > 0 ? Math.round((r.freeTotal / r.availableTotal) * 100) : 0;
                  return (
                    <TableRow key={r.userId} className={cn("align-top", reqs.length > 0 && !r.meetsAll && "opacity-70")}>
                      <TableCell>
                        <Link href={`/people/${r.userId}`} className="flex items-center gap-2.5 hover:underline">
                          <InitialsAvatar name={r.name} src={avatarSrc(r.avatarUrl)} className="size-8 text-xs" />
                          <span>
                            <span className="block font-medium">{r.name} {reqs.length > 0 && (r.meetsAll ? <CheckIcon className="ml-1 inline size-3.5 text-emerald-600" /> : null)}</span>
                            <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><RoleBadge role={r.role} />{r.title && <span>{r.title}</span>}</span>
                          </span>
                        </Link>
                      </TableCell>
                      {reqs.map((req) => {
                        const m = r.met.find((x) => x.skillId === req.skillId);
                        const miss = r.missing.find((x) => x.skillId === req.skillId);
                        const skill = r.skills.find((s) => s.skillId === req.skillId);
                        return (
                          <TableCell key={req.skillId} className="text-center">
                            {m ? <span className="inline-flex flex-col items-center gap-0.5"><LevelPill level={m.level} />{skill?.lastUsedYear && <span className="text-[10px] text-muted-foreground">{skill.lastUsedYear}</span>}</span>
                              : miss?.level != null ? <span className="inline-flex items-center gap-1 text-xs text-rose-600"><LevelPill level={miss.level} /><span className="text-[10px]">below</span></span>
                              : <MinusIcon className="inline size-4 text-muted-foreground/40" />}
                          </TableCell>
                        );
                      })}
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {others.map((s) => <span key={s.skillId} className="rounded border px-1.5 py-0.5 text-[11px]">{byId.get(s.skillId)?.name} <span className="text-muted-foreground">{s.level}</span></span>)}
                          {others.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <span className={cn("font-mono text-sm", r.freeTotal <= 0 ? "text-rose-600" : pct >= 50 ? "text-emerald-700" : "")}>{fmtH(r.freeTotal)}</span>
                        <span className="ml-1 text-[11px] text-muted-foreground">/ {fmtH(r.availableTotal)} · {pct}%</span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{fmtH(r.minWeekFree)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap text-sm">
                        <span className="inline-flex items-center gap-1"><AwardIcon className="size-3.5 text-muted-foreground" />{r.certifications}</span>
                        {r.expiringCerts > 0 && <span className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-amber-600" title="Expiring or expired"><AlertTriangleIcon className="size-3" />{r.expiringCerts}</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
