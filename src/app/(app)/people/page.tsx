import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { STAFF_ONLY } from "@/lib/permissions";
import { loadAvailability } from "@/lib/availability-data";
import { matchPeople, parseRequirements, certificationStatus } from "@/lib/skills";
import { parseDateParam, startOfWeek, toDateParam } from "@/lib/week";
import { PeopleClient, type PeopleResult, type PeopleSkill } from "./people-client";

export const metadata = { title: "Find people" };

const DEFAULT_WEEKS = 8;
const MAX_WEEKS = 26;

// Staffing search: required skills (with a minimum level each) combined with free hours over a
// window. "Who can do a DRC rollout in French starting in October" is one URL. Gated people:search.
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ skills?: string; start?: string; weeks?: string; minFree?: string; q?: string; all?: string }> }) {
  const sp = await searchParams;
  const user = await requirePermission("people:search");

  const catalogue = await prisma.skill.findMany({ where: { companyId: user.companyId }, orderBy: [{ category: "asc" }, { name: "asc" }], select: { id: true, name: true, category: true } });
  const requirements = parseRequirements(sp.skills, new Set(catalogue.map((s) => s.id)));
  const start = startOfWeek(parseDateParam(sp.start));
  const weeks = Math.min(MAX_WEEKS, Math.max(1, Number(sp.weeks) || DEFAULT_WEEKS));
  const minFree = Math.max(0, Number(sp.minFree) || 0);
  const showAll = sp.all === "1";

  const people = await prisma.user.findMany({
    where: { companyId: user.companyId, active: true, ...STAFF_ONLY },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, role: true, title: true, avatarUrl: true,
      skills: { select: { skillId: true, level: true, lastUsedYear: true } },
      certifications: { select: { name: true, expiryDate: true } },
    },
  });
  const availability = await loadAvailability(user.companyId, people.map((p) => p.id), start, weeks);
  const today = format(new Date(), "yyyy-MM-dd");

  const matches = matchPeople(
    people.map((p) => {
      const a = availability.get(p.id);
      return { userId: p.id, levels: Object.fromEntries(p.skills.map((s) => [s.skillId, s.level])), freeHours: a?.freeTotal ?? 0, minWeekFree: a?.minWeekFree ?? 0 };
    }),
    requirements,
    { minFreeHours: minFree },
  );
  const byId = new Map(people.map((p) => [p.id, p]));
  const results: PeopleResult[] = matches
    .filter((m) => showAll || requirements.length === 0 || m.meetsAll || m.missing.length < requirements.length)
    .map((m) => {
      const p = byId.get(m.userId)!;
      const a = availability.get(p.id);
      return {
        userId: p.id, name: p.name, role: p.role, title: p.title, avatarUrl: p.avatarUrl,
        meetsAll: m.meetsAll, score: m.score,
        met: m.met, missing: m.missing,
        skills: p.skills.map((s) => ({ skillId: s.skillId, level: s.level, lastUsedYear: s.lastUsedYear })),
        freeTotal: a?.freeTotal ?? 0, availableTotal: a?.availableTotal ?? 0, minWeekFree: a?.minWeekFree ?? 0,
        certifications: p.certifications.length,
        expiringCerts: p.certifications.filter((c) => ["EXPIRING", "EXPIRED"].includes(certificationStatus(c.expiryDate ? c.expiryDate.toISOString().slice(0, 10) : null, today))).length,
      };
    });

  const skills: PeopleSkill[] = catalogue.map((s) => ({ id: s.id, name: s.name, category: s.category }));
  return (
    <PeopleClient
      skills={skills}
      requirements={requirements}
      start={toDateParam(start)}
      weeks={weeks}
      minFree={minFree}
      showAll={showAll}
      results={results}
      totalPeople={people.length}
    />
  );
}
