// The delivery plan's scheduling math — pure (no Prisma, no Date.now()), so the cockpit grid, the
// server actions, the Portfolio and the status editor all agree. Dates are yyyy-MM-dd strings.

const DAY_MS = 86_400_000;
const dayMs = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** `iso` moved by `days` whole days (negative moves earlier). */
export const addDaysIso = (iso: string, days: number): string => isoOf(dayMs(iso) + days * DAY_MS);
/** Whole days from `fromIso` to `toIso` (positive when `toIso` is later). */
export const diffDaysIso = (fromIso: string, toIso: string): number => Math.round((dayMs(toIso) - dayMs(fromIso)) / DAY_MS);

// ---------- dependencies (finish-to-start) ----------

export type DepTask = { id: string; dependsOnId: string | null };

/** Would making `taskId` depend on `dependsOnId` close a loop? Self-dependency counts as a loop, and
 *  so does walking into an existing loop further up the chain (never trust stored data to be clean). */
export function wouldCreateCycle(tasks: DepTask[], taskId: string, dependsOnId: string | null | undefined): boolean {
  if (!dependsOnId) return false;
  if (dependsOnId === taskId) return true;
  const parent = new Map(tasks.map((t) => [t.id, t.dependsOnId] as const));
  parent.set(taskId, dependsOnId);
  const seen = new Set<string>();
  let cur: string | null | undefined = dependsOnId;
  while (cur) {
    if (cur === taskId || seen.has(cur)) return true;
    seen.add(cur);
    cur = parent.get(cur) ?? null;
  }
  return false;
}

export type SchedTask = DepTask & { startDate: string | null; dueDate: string | null };
export type DateShift = { id: string; startDate: string | null; dueDate: string | null; prevStartDate: string | null; prevDueDate: string | null };

/** How far a finish-to-start chain moves when a task's due date changes: the delta of the due date.
 *  Moving only the start (a left-edge resize) doesn't push anyone. */
export function finishDelta(prevDue: string | null, nextDue: string | null): number {
  if (!prevDue || !nextDue) return 0;
  return diffDaysIso(prevDue, nextDue);
}

/** Every task downstream of `movedId` (dependents, their dependents, …) shifted by `deltaDays`.
 *  Undated sides stay undated. Guarded against stored loops: each task moves at most once. */
export function cascadeShift(tasks: SchedTask[], movedId: string, deltaDays: number): DateShift[] {
  if (!deltaDays) return [];
  const children = new Map<string, SchedTask[]>();
  for (const t of tasks) {
    if (!t.dependsOnId) continue;
    (children.get(t.dependsOnId) ?? children.set(t.dependsOnId, []).get(t.dependsOnId)!).push(t);
  }
  const out: DateShift[] = [];
  const visited = new Set<string>([movedId]);
  const queue = [...(children.get(movedId) ?? [])];
  while (queue.length) {
    const t = queue.shift()!;
    if (visited.has(t.id)) continue;
    visited.add(t.id);
    out.push({
      id: t.id,
      startDate: t.startDate ? addDaysIso(t.startDate, deltaDays) : null,
      dueDate: t.dueDate ? addDaysIso(t.dueDate, deltaDays) : null,
      prevStartDate: t.startDate,
      prevDueDate: t.dueDate,
    });
    queue.push(...(children.get(t.id) ?? []));
  }
  return out;
}

// ---------- baseline & slip ----------

/** Days a task finishes after its baseline (negative = ahead). Null without both dates. */
export function slipDays(dueDate: string | null, baselineEnd: string | null): number | null {
  if (!dueDate || !baselineEnd) return null;
  return diffDaysIso(baselineEnd, dueDate);
}

/** The plan's finish against its baseline finish, over the baselined tasks only: latest due date
 *  minus latest baseline end. Null when nothing is baselined. This is the Portfolio's slip. */
export function planSlip(tasks: { dueDate: string | null; baselineEnd: string | null }[]): number | null {
  const based = tasks.filter((t) => t.baselineEnd && t.dueDate);
  if (based.length === 0) return null;
  const latestDue = based.reduce((m, t) => (t.dueDate! > m ? t.dueDate! : m), based[0].dueDate!);
  const latestBase = based.reduce((m, t) => (t.baselineEnd! > m ? t.baselineEnd! : m), based[0].baselineEnd!);
  return diffDaysIso(latestBase, latestDue);
}

/** "+3 d" / "−2 d" / "0 d". */
export const formatSlip = (d: number): string => (d > 0 ? `+${d} d` : d < 0 ? `−${-d} d` : "0 d");

// ---------- weighted progress ----------

export type ProgressTask = {
  progress: number;
  isMilestone: boolean;
  startDate: Date | string | null;
  dueDate: Date | string | null;
  estimatedHours?: number | null;
};
export type ProgressBasis = "effort" | "duration" | "count" | "none";

function spanDays(t: ProgressTask): number | null {
  if (!t.startDate || !t.dueDate) return null;
  const a = new Date(t.startDate).getTime();
  const b = new Date(t.dueDate).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(1, Math.round((b - a) / DAY_MS) + 1); // inclusive: a one-day task weighs 1
}

/** Progress of a set of plan tasks (a phase, or the whole plan), weighted by what the tasks really
 *  cost: **effort** (estimated hours) when every task has an estimate, else **duration** (days, a
 *  two-week task counts twice a one-week one) when every task is dated, else a plain **count**
 *  average. Mixing bases would silently over-weight the half that has data, so it never does.
 *  Milestones carry no work and are ignored. */
export function weightedProgress(tasks: ProgressTask[]): { percent: number; basis: ProgressBasis } {
  const real = tasks.filter((t) => !t.isMilestone);
  if (real.length === 0) return { percent: 0, basis: "none" };
  const clamp = (p: number) => Math.max(0, Math.min(100, p));
  const weighted = (weights: number[], basis: ProgressBasis) => {
    const total = weights.reduce((s, w) => s + w, 0);
    return { percent: Math.round(real.reduce((s, t, i) => s + clamp(t.progress) * weights[i], 0) / total), basis };
  };
  if (real.every((t) => t.estimatedHours != null && t.estimatedHours > 0)) return weighted(real.map((t) => t.estimatedHours as number), "effort");
  const spans = real.map(spanDays);
  if (spans.every((d) => d != null)) return weighted(spans as number[], "duration");
  return { percent: Math.round(real.reduce((s, t) => s + clamp(t.progress), 0) / real.length), basis: "count" };
}

export const PROGRESS_BASIS_LABEL: Record<ProgressBasis, string> = {
  effort: "weighted by estimated hours",
  duration: "weighted by duration",
  count: "plain average (some tasks have no dates)",
  none: "no tasks",
};

// ---------- actuals ----------

export type ApprovedHours = { milestoneId: string; taskId: string | null; hours: number };

/** Approved hours per plan row: the linked milestone's approved time, narrowed to the linked task
 *  when the row names one. Rows without a milestone get nothing (the map has no entry). */
export function planActualHours(rows: { id: string; milestoneId: string | null; taskId: string | null }[], approved: ApprovedHours[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.milestoneId) continue;
    const h = approved
      .filter((a) => a.milestoneId === r.milestoneId && (r.taskId == null || a.taskId === r.taskId))
      .reduce((s, a) => s + a.hours, 0);
    out.set(r.id, Math.round(h * 100) / 100);
  }
  return out;
}
