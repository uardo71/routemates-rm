// Pure work-in-progress (unbilled) shaping — no Prisma/server imports, so both the server loader
// and the client detail view can use it.

export type UnbilledEntry = {
  entryId: string;
  projectId: string;
  projectName: string;
  clientName: string;
  milestoneId: string;
  milestoneName: string;
  userName: string;
  /** yyyy-MM-dd (UTC — TimeEntry.date is stored at UTC midnight). */
  date: string;
  /** yyyy-MM bucket of the entry date. */
  month: string;
  hours: number;
  rate: number;
  value: number;
  /** Whole days between the entry date and today. */
  ageDays: number;
};

export type AgeBucketKey = "0-30" | "31-60" | "61-90" | "90+";
export type AgeBucket = { key: AgeBucketKey; label: string; hours: number; value: number; entries: number };

export const AGE_BUCKETS: { key: AgeBucketKey; label: string }[] = [
  { key: "0-30", label: "0–30 days" },
  { key: "31-60", label: "31–60 days" },
  { key: "61-90", label: "61–90 days" },
  { key: "90+", label: "90+ days" },
];

export function bucketForAge(ageDays: number): AgeBucketKey {
  if (ageDays <= 30) return "0-30";
  if (ageDays <= 60) return "31-60";
  if (ageDays <= 90) return "61-90";
  return "90+";
}

/** Bucket a set of unbilled entries by age. Always returns all four buckets, in order. */
export function summarizeAge(entries: UnbilledEntry[]): AgeBucket[] {
  const acc = new Map<AgeBucketKey, AgeBucket>(AGE_BUCKETS.map((b) => [b.key, { ...b, hours: 0, value: 0, entries: 0 }]));
  for (const e of entries) {
    const b = acc.get(bucketForAge(e.ageDays))!;
    b.hours += e.hours;
    b.value += e.value;
    b.entries++;
  }
  return [...acc.values()].map((b) => ({ ...b, hours: round2(b.hours), value: round2(b.value) }));
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type UnbilledProjectTotal = { hours: number; value: number };

/** Unbilled hours + value per project id, for the revenue rollup. */
export function totalsByProject(entries: UnbilledEntry[]): Map<string, UnbilledProjectTotal> {
  const m = new Map<string, UnbilledProjectTotal>();
  for (const e of entries) {
    const t = m.get(e.projectId) ?? { hours: 0, value: 0 };
    t.hours += e.hours;
    t.value += e.value;
    m.set(e.projectId, t);
  }
  for (const [k, v] of m) m.set(k, { hours: round2(v.hours), value: round2(v.value) });
  return m;
}

export type UnbilledMonthGroup = { month: string; hours: number; value: number; entries: number; oldestAgeDays: number };
export type UnbilledMilestoneGroup = { milestoneId: string; milestoneName: string; hours: number; value: number; oldestAgeDays: number; months: UnbilledMonthGroup[] };
export type UnbilledProjectGroup = {
  projectId: string;
  projectName: string;
  clientName: string;
  hours: number;
  value: number;
  oldestAgeDays: number;
  milestones: UnbilledMilestoneGroup[];
};

/** Group entries project → milestone → month, carrying the age in days of the OLDEST entry at each
 *  level (the number that matters for month-end review). */
export function groupUnbilled(entries: UnbilledEntry[]): UnbilledProjectGroup[] {
  const projects = new Map<string, UnbilledProjectGroup>();
  const msIndex = new Map<string, UnbilledMilestoneGroup>();
  const moIndex = new Map<string, UnbilledMonthGroup>();

  for (const e of entries) {
    let p = projects.get(e.projectId);
    if (!p) {
      p = { projectId: e.projectId, projectName: e.projectName, clientName: e.clientName, hours: 0, value: 0, oldestAgeDays: 0, milestones: [] };
      projects.set(e.projectId, p);
    }
    const msKey = `${e.projectId}|${e.milestoneId}`;
    let ms = msIndex.get(msKey);
    if (!ms) {
      ms = { milestoneId: e.milestoneId, milestoneName: e.milestoneName, hours: 0, value: 0, oldestAgeDays: 0, months: [] };
      msIndex.set(msKey, ms);
      p.milestones.push(ms);
    }
    const moKey = `${msKey}|${e.month}`;
    let mo = moIndex.get(moKey);
    if (!mo) {
      mo = { month: e.month, hours: 0, value: 0, entries: 0, oldestAgeDays: 0 };
      moIndex.set(moKey, mo);
      ms.months.push(mo);
    }
    for (const node of [p, ms, mo]) {
      node.hours += e.hours;
      node.value += e.value;
      node.oldestAgeDays = Math.max(node.oldestAgeDays, e.ageDays);
    }
    mo.entries++;
  }

  const fix = <T extends { hours: number; value: number }>(n: T): T => ({ ...n, hours: round2(n.hours), value: round2(n.value) });
  return [...projects.values()]
    .map((p) => ({
      ...fix(p),
      milestones: p.milestones
        .map((ms) => ({ ...fix(ms), months: ms.months.map(fix).sort((a, b) => a.month.localeCompare(b.month)) }))
        .sort((a, b) => b.value - a.value),
    }))
    .sort((a, b) => b.value - a.value);
}
