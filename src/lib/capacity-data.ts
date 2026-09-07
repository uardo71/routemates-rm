import "server-only";
import { prisma } from "@/lib/prisma";
import { toDateParam } from "@/lib/week";
import {
  weekCapacity, holidayDaysInWeek, leaveDaysInWeekForAll,
  DEFAULT_WEEKLY_CAPACITY_HOURS, type LeaveRange, type WeekCapacity,
} from "@/lib/capacity";

// Loads what the pure capacity math in `@/lib/capacity` needs from the DB. The math itself stays
// Prisma-free and unit-tested; this module only queries and shapes.

/** Per-user, per-week available hours. Key: `${userId}|${weekKey}`. */
export type CapacityMap = Map<string, WeekCapacity>;

export function capacityKey(userId: string, weekKey: string): string {
  return `${userId}|${weekKey}`;
}

/** Available hours for each of `userIds` across each of `weekKeys`, deducting Albanian public
 *  holidays and approved leave (apportioned to the weeks the leave actually covers).
 *
 *  `rangeStart`/`rangeEnd` bound the leave query; they must span the given weeks. */
export async function loadCapacity(
  companyId: string,
  userIds: string[],
  weekKeys: string[],
  rangeStart: Date,
  rangeEnd: Date,
): Promise<CapacityMap> {
  const map: CapacityMap = new Map();
  if (userIds.length === 0 || weekKeys.length === 0) return map;

  const [employments, leaves] = await Promise.all([
    prisma.employment.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, weeklyCapacityHours: true },
    }),
    // Only APPROVED leave reduces capacity — a pending request isn't a commitment yet.
    // Overlap test: the leave starts before the range ends AND ends after it starts.
    prisma.leaveRequest.findMany({
      where: {
        userId: { in: userIds },
        status: "APPROVED",
        startDate: { lt: rangeEnd },
        endDate: { gte: rangeStart },
        user: { companyId },
      },
      select: {
        userId: true, startDate: true, endDate: true,
        returns: { select: { startDate: true, endDate: true } },
      },
    }),
  ]);

  const hoursByUser = new Map(employments.map((e) => [e.userId, Number(e.weeklyCapacityHours)]));
  const leavesByUser = new Map<string, LeaveRange[]>();
  for (const l of leaves) {
    const list = leavesByUser.get(l.userId) ?? [];
    list.push({
      startDate: toDateParam(l.startDate),
      endDate: toDateParam(l.endDate),
      returns: l.returns.map((r) => ({ startDate: toDateParam(r.startDate), endDate: toDateParam(r.endDate) })),
    });
    leavesByUser.set(l.userId, list);
  }

  // Holidays are company-wide, so count them once per week rather than per person.
  const holidaysByWeek = new Map(weekKeys.map((w) => [w, holidayDaysInWeek(w)]));

  for (const userId of userIds) {
    // Someone with no Employment row (employment tracking off) is assumed to be full-time —
    // the same assumption the planner made for everyone before capacity was modelled.
    const weeklyCapacityHours = hoursByUser.get(userId) ?? DEFAULT_WEEKLY_CAPACITY_HOURS;
    const userLeaves = leavesByUser.get(userId) ?? [];
    for (const weekKey of weekKeys) {
      map.set(
        capacityKey(userId, weekKey),
        weekCapacity({
          weeklyCapacityHours,
          holidayDays: holidaysByWeek.get(weekKey) ?? 0,
          leaveDays: leaveDaysInWeekForAll(userLeaves, weekKey),
        }),
      );
    }
  }
  return map;
}

/** Flattened for handing to a client component — Maps aren't serializable across the RSC boundary. */
export type CapacityCell = { userId: string; weekKey: string } & WeekCapacity;

export function toCapacityCells(map: CapacityMap): CapacityCell[] {
  return [...map.entries()].map(([key, cap]) => {
    const [userId, weekKey] = key.split("|");
    return { userId, weekKey, ...cap };
  });
}
