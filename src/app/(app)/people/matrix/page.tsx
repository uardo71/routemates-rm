import Link from "next/link";
import { BackLink } from "@/components/back-link";
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

// Fixed, narrow skill columns: the matrix reads as a compact grid instead of a few cells stretched
// across the page. Labels run vertically INSIDE their column, so they can never drift over a neighbour.
const COL_W = 52;
const PERSON_W = 220;

// "DRC (SAP Document Reporting Compliance)" → "DRC" in the header; the full name stays in the tooltip.
const shortName = (name: string) => name.replace(/\s*\(.*\)\s*$/, "") || name;
// A one-column category is only as wide as one skill, so it gets a short label; wider groups show the full one.
const CATEGORY_SHORT: Record<SkillCategoryKey, string> = { SAP_MODULE: "SAP", TECHNOLOGY: "Tech", LANGUAGE: "Lang", INDUSTRY: "Ind.", METHODOLOGY: "Method" };

type Gap = "NONE" | "MISSING" | "SINGLE";
const GAP_COL: Record<Gap, string> = { NONE: "", MISSING: "bg-rose-500/[0.07]", SINGLE: "bg-amber-500/[0.08]" };
const GAP_BAR: Record<Gap, string> = { NONE: "", MISSING: "bg-rose-500", SINGLE: "bg-amber-500" };
const GAP_TEXT: Record<Gap, string> = { NONE: "text-muted-foreground", MISSING: "text-rose-600 dark:text-rose-400", SINGLE: "text-amber-600 dark:text-amber-400" };

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
  const gapOf = (skillId: string): Gap => (coverage.get(skillId)?.gap ?? "NONE") as Gap;
  const gaps = skills.filter((s) => gapOf(s.id) !== "NONE");
  const groups = SKILL_CATEGORIES.map((c) => ({ cat: c, cols: skills.filter((s) => s.category === c) })).filter((g) => g.cols.length > 0);
  // First column of each category gets a divider so the groups read as blocks.
  const groupStart = new Set(groups.map((g) => g.cols[0].id));
  const colStyle = { width: COL_W, minWidth: COL_W, maxWidth: COL_W };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <BackLink href="/people" label="Find people" />
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight"><LayoutGridIcon className="size-5 text-muted-foreground" /> Skills matrix</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Who knows what, at a glance. Tinted columns are gaps: nobody solid (level 3+), or only one person carrying it.</p>
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
          {gaps.map((s) => { const g = gapOf(s.id); return <span key={s.id} className={cn("rounded-full px-2 py-0.5 text-xs", g === "MISSING" ? "bg-rose-500/15 text-rose-700 dark:text-rose-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400")}>{s.name} · {g === "MISSING" ? "nobody at 3+" : "one person"}</span>; })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5">Level</span>
          {([1, 2, 3, 4, 5] as SkillLevel[]).map((l) => (
            <span key={l} className="inline-flex items-center gap-1">
              <span className={cn("inline-flex size-5 items-center justify-center rounded text-[10px] font-semibold", LEVEL_TONE[l])}>{l}</span>
              <span>{SKILL_LEVEL_LABEL[l]}</span>
            </span>
          ))}
        </div>
        <span className="h-4 w-px bg-border" />
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-sm border border-rose-500/40 bg-rose-500/15" /> Gap: nobody at 3+</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-sm border border-amber-500/40 bg-amber-500/15" /> Gap: only one person</span>
      </div>

      <Card className="py-0">
        <CardContent className="px-0">
          {skills.length === 0 || people.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">{skills.length === 0 ? "The skill catalogue is empty — add skills under Admin → Skills catalogue." : "No staff found."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-max border-separate border-spacing-0 text-xs">
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ width: PERSON_W, minWidth: PERSON_W }} className="sticky left-0 z-20 border-b border-r bg-muted px-3 py-2 text-left align-bottom font-semibold">Person</th>
                    {groups.map((g) => (
                      <th key={g.cat} colSpan={g.cols.length} className="border-b border-l bg-muted p-0 text-left">
                        {/* Width pinned to its columns so a long category name can never widen them. */}
                        <div style={{ width: g.cols.length * COL_W }} className="truncate px-1.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground" title={SKILL_CATEGORY_LABEL[g.cat]}>
                          {g.cols.length === 1 ? CATEGORY_SHORT[g.cat] : SKILL_CATEGORY_LABEL[g.cat]}
                        </div>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {groups.flatMap((g) => g.cols.map((s) => {
                      const c = coverage.get(s.id)!;
                      const gap = gapOf(s.id);
                      return (
                        <th key={s.id} style={colStyle} className={cn("relative h-36 border-b bg-muted p-0 align-bottom font-medium", groupStart.has(s.id) && "border-l", GAP_COL[gap])} title={`${s.name} — ${c.covered} at level 3+, best level ${c.maxLevel || "none"}`}>
                          {gap !== "NONE" && <span className={cn("absolute inset-x-1.5 top-0 h-1 rounded-b", GAP_BAR[gap])} />}
                          <div className="flex h-36 items-end justify-center pb-2">
                            <span className="max-h-32 truncate rotate-180 text-[11px] leading-none [writing-mode:vertical-rl]">{shortName(s.name)}</span>
                          </div>
                        </th>
                      );
                    }))}
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id} className="group">
                      <td style={{ width: PERSON_W, minWidth: PERSON_W }} className="sticky left-0 z-10 border-b border-r bg-card px-3 py-1.5 whitespace-nowrap group-hover:bg-muted">
                        <Link href={`/people/${p.id}`} className="inline-flex max-w-full items-center gap-2 hover:underline"><InitialsAvatar name={p.name} src={avatarSrc(p.avatarUrl)} className="size-6 shrink-0 text-[10px]" /><span className="truncate">{p.name}</span></Link>
                      </td>
                      {groups.flatMap((g) => g.cols.map((s) => {
                        const l = levelOf.get(`${p.id}|${s.id}`);
                        return (
                          <td key={s.id} style={colStyle} className={cn("border-b p-1 text-center group-hover:bg-muted/60", groupStart.has(s.id) && "border-l", GAP_COL[gapOf(s.id)])} title={`${p.name} · ${s.name}: ${l ? `${l} ${SKILL_LEVEL_LABEL[l as SkillLevel]}` : "not recorded"}`}>
                            {l
                              ? <span className={cn("inline-flex size-7 items-center justify-center rounded font-semibold", LEVEL_TONE[l as SkillLevel])}>{l}</span>
                              : <span className="inline-block size-1 rounded-full bg-muted-foreground/25 align-middle" />}
                          </td>
                        );
                      }))}
                    </tr>
                  ))}
                  <tr>
                    <td style={{ width: PERSON_W, minWidth: PERSON_W }} className="sticky left-0 z-10 border-r bg-muted px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">People at level 3+</td>
                    {groups.flatMap((g) => g.cols.map((s) => {
                      const c = coverage.get(s.id)!;
                      const gap = gapOf(s.id);
                      return <td key={s.id} style={colStyle} className={cn("bg-muted px-1 py-2 text-center font-mono font-semibold tabular-nums", groupStart.has(s.id) && "border-l", GAP_TEXT[gap])}>{c.covered}</td>;
                    }))}
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
