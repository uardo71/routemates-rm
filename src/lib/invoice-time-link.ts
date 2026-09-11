// Which approved time entries a MANUALLY typed invoice line bills — pure (no Prisma), so the live
// invoice actions, the repair script and the unbilled view all apply the same rule.
//
// The real-world shape this has to handle (Mindsquare / Neptune): each task is invoiced on its own
// invoice line ("[P019912] Systemservice …", 25.5h), hours may be logged on the task OR on the
// assignment with no task, and a PM corrects approved hours with a same-day negative line (4h, −2h).

const EPS = 0.005;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type LinkEntry = { id: string; hours: number; date: string; milestoneId: string; taskId: string | null; assignmentId: string };
export type LinkTask = { id: string; name: string; milestoneId: string };
export type AllocLine = { id: string; quantity: number; milestoneId: string | null; taskId: string | null };
/** One day of one person's work on one task (or on the assignment): its entries always travel
 *  together, so a correction is billed — or not — with the hours it corrects. */
export type TimeUnit = { key: string; stream: string; entryIds: string[]; hours: number; date: string; milestoneId: string; taskId: string | null };

const CODE_RE = /^\s*\[([^\]]+)\]/;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** "[P019912] Systemservice …" → "p019912". */
export function taskCode(name: string): string | null {
  const m = CODE_RE.exec(name);
  return m ? m[1].trim().toLowerCase() : null;
}

/** The task an invoice line bills, read from its description: the task's `[code]`, else its full
 *  name. Ambiguous (two different tasks equally good) ⇒ null, so the line never guesses. */
export function resolveLineTask(description: string, tasks: LinkTask[], milestoneId?: string | null): string | null {
  const d = norm(description);
  const pool = milestoneId ? tasks.filter((t) => t.milestoneId === milestoneId) : tasks;
  const longest = (xs: LinkTask[]): string | null => {
    if (xs.length === 0) return null;
    const sorted = [...xs].sort((a, b) => b.name.length - a.name.length);
    if (sorted.length > 1 && sorted[1].name.length === sorted[0].name.length && sorted[1].id !== sorted[0].id) return null;
    return sorted[0].id;
  };
  // The name a person would type: the full name, or the name without its "[code]" prefix.
  const nameIn = (t: LinkTask) => {
    const full = norm(t.name);
    const bare = norm(t.name.replace(CODE_RE, ""));
    return (full.length >= 4 && d.includes(full)) || (bare.length >= 4 && d.includes(bare));
  };
  const byCode = pool.filter((t) => { const c = taskCode(t.name); return c != null && d.includes(`[${c}]`); });
  if (byCode.length === 1) return byCode[0].id;
  if (byCode.length > 1) return longest(byCode.filter(nameIn));
  return longest(pool.filter(nameIn));
}

/** Groups entries into units (person-assignment × task × day, net hours). A correction entered on a
 *  LATER day than the hours it reverses is folded into the latest earlier unit of the same
 *  assignment + task, so it nets against what it corrects rather than floating on its own. */
export function buildUnits(entries: LinkEntry[]): TimeUnit[] {
  const byKey = new Map<string, TimeUnit>();
  for (const e of entries) {
    const stream = `${e.assignmentId}|${e.taskId ?? ""}`;
    const key = `${stream}|${e.date}`;
    const u = byKey.get(key) ?? { key, stream, entryIds: [], hours: 0, date: e.date, milestoneId: e.milestoneId, taskId: e.taskId };
    u.entryIds.push(e.id);
    u.hours += e.hours;
    byKey.set(key, u);
  }
  const units = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  for (const u of units) u.hours = r2(u.hours);
  for (let i = 0; i < units.length; i++) {
    let cur = i;
    while (units[cur].hours < -EPS) {
      let j = cur - 1;
      while (j >= 0 && !(units[j].stream === units[cur].stream && units[j].entryIds.length > 0 && units[j].hours > EPS)) j--;
      if (j < 0) break;
      units[j].entryIds.push(...units[cur].entryIds);
      units[j].hours = r2(units[j].hours + units[cur].hours);
      units[cur].entryIds = [];
      units[cur].hours = 0;
      cur = j;
    }
  }
  return units.filter((u) => u.entryIds.length > 0);
}

/** Entries whose unit nets to zero (e.g. +4h then −4h the same day): nothing was worked, nothing is
 *  owed, so the unbilled view must not show them — not even as a negative. */
export function netZeroEntryIds(entries: LinkEntry[]): Set<string> {
  const out = new Set<string>();
  for (const u of buildUnits(entries)) if (Math.abs(u.hours) < EPS) for (const id of u.entryIds) out.add(id);
  return out;
}

/** Assigns units to the manual invoice lines of ONE billing period (one project, one service
 *  period — possibly several invoices). Whole units only; never more hours in total than invoiced.
 *   1. A line that names a task takes that task's units, oldest first, only while they fit.
 *   2. Time logged without a task then fills whatever room the lines still have, in date order,
 *      carrying over from line to line — one day may straddle two invoices, but the period total is
 *      exact. (Neptune July: 46h logged on the assignment, four task invoices totalling 46h.)
 *   3. A line naming no task finally takes any leftover unit of its milestone that fits.
 *  Units netting to ≤ 0 are never assigned. */
export function allocateUnits(lines: AllocLine[], units: TimeUnit[]): { links: Map<string, string>; lineHours: Map<string, number>; unassigned: TimeUnit[] } {
  const remaining = new Map(lines.map((l) => [l.id, l.quantity] as const));
  const lineOf = new Map<string, string>(); // unit key → line id
  const pool = units.filter((u) => u.hours > EPS).sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  const fits = (l: AllocLine, u: TimeUnit) => !l.milestoneId || l.milestoneId === u.milestoneId;
  const claim = (l: AllocLine, u: TimeUnit) => { lineOf.set(u.key, l.id); remaining.set(l.id, remaining.get(l.id)! - u.hours); };
  const room = (l: AllocLine) => remaining.get(l.id)!;

  for (const l of lines) {
    if (!l.taskId) continue;
    for (const u of pool) {
      if (lineOf.has(u.key) || u.taskId !== l.taskId || !fits(l, u)) continue;
      if (u.hours <= room(l) + EPS) claim(l, u);
    }
  }

  for (const u of pool) {
    if (lineOf.has(u.key) || u.taskId !== null) continue;
    const eligible = lines.filter((l) => fits(l, u) && room(l) > EPS);
    if (eligible.length === 0) continue;
    const total = eligible.reduce((s, l) => s + room(l), 0);
    if (u.hours > total + EPS) {
      const whole = eligible.find((l) => u.hours <= room(l) + EPS);
      if (whole) claim(whole, u);
      continue;
    }
    const first = eligible[0];
    claim(first, u);
    let over = -room(first);
    if (over > EPS) {
      remaining.set(first.id, 0);
      for (const l of eligible.slice(1)) {
        if (over <= EPS) break;
        const take = Math.min(over, room(l));
        remaining.set(l.id, room(l) - take);
        over -= take;
      }
    }
  }

  for (const l of lines) {
    if (l.taskId) continue;
    for (const u of pool) {
      if (lineOf.has(u.key) || !fits(l, u)) continue;
      if (u.hours <= room(l) + EPS) claim(l, u);
    }
  }

  const links = new Map<string, string>();
  const lineHours = new Map<string, number>(lines.map((l) => [l.id, 0] as const));
  for (const u of pool) {
    const lineId = lineOf.get(u.key);
    if (!lineId) continue;
    for (const id of u.entryIds) links.set(id, lineId);
    lineHours.set(lineId, r2(lineHours.get(lineId)! + u.hours));
  }
  return { links, lineHours, unassigned: pool.filter((u) => !lineOf.has(u.key)) };
}
