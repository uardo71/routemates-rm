import "server-only";
import { addWeeks } from "date-fns";
import { prisma } from "@/lib/prisma";
import { loadCapacity, capacityKey } from "@/lib/capacity-data";
import { freeHours } from "@/lib/capacity";
import { startOfWeek, toDateParam } from "@/lib/week";

// Free hours per person over a window of weeks — the same booked/available arithmetic as
// /planning/availability (task rollup wins over the assignment-level cell; capacity net of holidays
// and approved leave). Used by Find people so "who is free from October" is one query.

export type PersonAvailability = {
  userId: string;
  weekKeys: string[];
  /** Σ free hours over the window. */
  freeTotal: number;
  /** Smallest weekly free figure — 0 means at least one fully booked week. */
  minWeekFree: number;
  /** Σ available (capacity) over the window, to show "free / capacity". */
  availableTotal: number;
};

export async function loadAvailability(companyId: string, userIds: string[], start: Date, weeks: number): Promise<Map<string, PersonAvailability>> {
  const out = new Map<string, PersonAvailability>();
  if (userIds.length === 0 || weeks <= 0) return out;
  const timelineStart = startOfWeek(start);
  const timelineEnd = addWeeks(timelineStart, weeks);
  const weekKeys = Array.from({ length: weeks }, (_, i) => toDateParam(addWeeks(timelineStart, i)));

  const plans = await prisma.assignmentPlan.findMany({
    where: {
      weekStartDate: { gte: timelineStart, lt: timelineEnd },
      assignment: { userId: { in: userIds }, status: { not: "CLOSED" } },
    },
    select: { assignmentId: true, taskId: true, weekStartDate: true, hours: true, assignment: { select: { userId: true } } },
  });
  const assignmentWeek = new Map<string, { userId: string; level: number; taskSum: number }>();
  for (const p of plans) {
    const key = `${p.assignmentId}|${toDateParam(p.weekStartDate)}`;
    const entry = assignmentWeek.get(key) ?? { userId: p.assignment.userId, level: 0, taskSum: 0 };
    if (p.taskId) entry.taskSum += Number(p.hours);
    else entry.level += Number(p.hours);
    assignmentWeek.set(key, entry);
  }
  const booked = new Map<string, number>();
  for (const [key, entry] of assignmentWeek) {
    const weekKey = key.split("|")[1];
    const effective = entry.taskSum > 0 ? entry.taskSum : entry.level;
    const k = capacityKey(entry.userId, weekKey);
    booked.set(k, (booked.get(k) ?? 0) + effective);
  }

  const capacity = await loadCapacity(companyId, userIds, weekKeys, timelineStart, timelineEnd);
  for (const userId of userIds) {
    let freeTotal = 0, availableTotal = 0, minWeekFree = Number.POSITIVE_INFINITY;
    for (const weekKey of weekKeys) {
      const cap = capacity.get(capacityKey(userId, weekKey));
      const available = cap?.available ?? 0;
      const b = Math.round((booked.get(capacityKey(userId, weekKey)) ?? 0) * 100) / 100;
      const free = freeHours(b, available);
      freeTotal += free; availableTotal += available; minWeekFree = Math.min(minWeekFree, free);
    }
    out.set(userId, { userId, weekKeys, freeTotal: Math.round(freeTotal * 100) / 100, availableTotal: Math.round(availableTotal * 100) / 100, minWeekFree: Number.isFinite(minWeekFree) ? minWeekFree : 0 });
  }
  return out;
}
