import Link from "next/link";
import { LayoutGridIcon, AlertTriangleIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { STAFF_ONLY } from "@/lib/permissions";
import { Card, CardContent } from "@/components/ui/card";
import { InitialsAvatar } from "@/components/initials-avatar";
import { avatarSrc } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { SKILL_CATEGORIES, SKILL_CATEGORY_LABEL, LEVEL_TONE, SKILL_LEVEL_LABEL, skillCoverage, type SkillCategoryKey, type SkillLevel } from "@/lib/skills";

export const metadata = { title: "Skills matrix" };

// People × skills heatmap. A column is a gap when nobody is at level 3+ (missing) or only one
// person is (single point of failure). Gated people:search.
export default async function SkillsMatrixPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { category } = await searchParams;
  const user = await requirePermission("people:search");
  const cat = (SKILL_CATEGORIES as readonly string[]).includes(category ?? "") ? (category as SkillCategoryKey) : null;

  const [skills, people] = await Promise.all([
    prisma.skill.findMany({ where: { companyId: user.companyId, ...(cat ? { category: cat } : {}) }, orderBy: [{ category: "asc" }, { name: "asc" }], select: { id: true, name: true, category: true } }),
    prisma.user.findMany({
      where: { companyId: user.companyId, active: true, ...STAFF_ONLY },
      orderBy: { name: "asc" },
      select: { id: true, name: true, avatarUrl: true, skills: { select: { skillId: true, level: true } } },
    }),
  ]);
  const levelOf = new Map<string, number>();
  for (const p of people) for (const s of p.skills) levelOf.set(`${p.id}|${s.skillId}`, s.level);
  const coverage = new Map(skillCoverage(skills.map((s) => ({ skillId: s.id, levels: people.map((p) => levelOf.get(`${p.id}|${s.id}`) ?? 0).filter((l) => l > 0) }))).map((c) => [c.skillId, c]));
  const gaps = skills.filter((s) => coverage.get(s.id)?.gap !== "NONE");
  const groups = SKILL_CATEGORIES.map((c) => ({ cat: c, cols: skills.filter((s) => s.category === c) })).filter((g) => g.cols.length > 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/people" className="text-sm text-muted-foreground hover:underline">← Find people</Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight"><LayoutGridIcon className="size-5 text-muted-foreground" /> Skills matrix</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Who knows what, at a glance. Highlighted columns are gaps: nobody solid (level 3+), or a single person carrying it.</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Link href="/people/matrix" className={cn("rounded-full border px-3 py-1 text-xs", !cat && "bg-foreground text-background")}>All</Link>
          {SKILL_CATEGORIES.map((c) => <Link key={c} href={`/people/matrix?category=${c}`} className={cn("rounded-full border px-3 py-1 text-xs", cat === c && "bg-foreground text-background")}>{SKILL_CATEGORY_LABEL[c]}</Link>)}
        </div>
      </div>

      {gaps.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/45 bg-amber-500/[0.07] px-4 py-3 text-sm">
          <AlertTriangleIcon className="size-4 shrink-0 text-amber-600" />
          <span className="font-medium">{gaps.length} gap{gaps.length === 1 ? "" : "s"}:</span>
          {gaps.map((s) => { const c = coverage.get(s.id)!; return <span key={s.id} className={cn("rounded-full px-2 py-0.5 text-xs", c.gap === "MISSING" ? "bg-rose-500/15 text-rose-700 dark:text-rose-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400")}>{s.name} · {c.gap === "MISSING" ? "nobody at 3+" : "one person"}</span>; })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>Level:</span>
        {([1, 2, 3, 4, 5] as SkillLevel[]).map((l) => <span key={l} className={cn("rounded px-1.5 py-0.5 font-semibold", LEVEL_TONE[l])}>{l} {SKILL_LEVEL_LABEL[l]}</span>)}
        <span className="ml-2 rounded px-1.5 py-0.5 ring-2 ring-rose-400/70">column: missing</span>
        <span className="rounded px-1.5 py-0.5 ring-2 ring-amber-400/70">column: single person</span>
      </div>

      <Card>
        <CardContent className="px-0">
          {skills.length === 0 || people.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">{skills.length === 0 ? "The skill catalogue is empty — add skills under Admin → Skills catalogue." : "No staff found."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-xs">
                <thead>
                  <tr>
                    <th rowSpan={2} className="sticky left-0 z-20 border-b border-r bg-muted px-3 py-2 text-left font-semibold">Person</th>
                    {groups.map((g) => <th key={g.cat} colSpan={g.cols.length} className="border-b bg-muted px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{SKILL_CATEGORY_LABEL[g.cat]}</th>)}
                  </tr>
                  <tr>
                    {groups.flatMap((g) => g.cols.map((s) => {
                      const c = coverage.get(s.id)!;
                      return (
                        <th key={s.id} className={cn("h-32 border-b bg-muted px-1 align-bottom font-medium", c.gap === "MISSING" && "ring-2 ring-inset ring-rose-400/70", c.gap === "SINGLE" && "ring-2 ring-inset ring-amber-400/70")} title={`${s.name}: ${c.covered} at 3+, best ${c.maxLevel}`}>
                          <div className="flex h-full items-end justify-center">
                            <span className="inline-block max-w-28 -rotate-60 origin-bottom-left translate-x-3 whitespace-nowrap">{s.name}</span>
                          </div>
                        </th>
                      );
                    }))}
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/40">
                      <td className="sticky left-0 z-10 border-b border-r bg-card px-3 py-1.5 whitespace-nowrap">
                        <Link href={`/people/${p.id}`} className="inline-flex items-center gap-2 hover:underline"><InitialsAvatar name={p.name} src={avatarSrc(p.avatarUrl)} className="size-6 text-[10px]" />{p.name}</Link>
                      </td>
                      {groups.flatMap((g) => g.cols.map((s) => {
                        const l = levelOf.get(`${p.id}|${s.id}`);
                        const c = coverage.get(s.id)!;
                        return (
                          <td key={s.id} className={cn("border-b p-0.5 text-center", c.gap !== "NONE" && "bg-amber-500/[0.04]")} title={l ? `${p.name} · ${s.name}: ${l} ${SKILL_LEVEL_LABEL[l as SkillLevel]}` : undefined}>
                            {l ? <span className={cn("inline-flex size-7 items-center justify-center rounded font-semibold", LEVEL_TONE[l as SkillLevel])}>{l}</span> : <span className="inline-block size-7 rounded bg-muted/40" />}
                          </td>
                        );
                      }))}
                    </tr>
                  ))}
                  <tr>
                    <td className="sticky left-0 z-10 border-r bg-muted px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">People at 3+</td>
                    {groups.flatMap((g) => g.cols.map((s) => { const c = coverage.get(s.id)!; return <td key={s.id} className={cn("bg-muted px-1 py-1.5 text-center font-mono", c.gap === "MISSING" ? "text-rose-600" : c.gap === "SINGLE" ? "text-amber-600" : "text-muted-foreground")}>{c.covered}</td>; }))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
