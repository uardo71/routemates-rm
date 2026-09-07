import "server-only";
import { prisma } from "@/lib/prisma";
import { visibleProjectIds, type SessionUser } from "@/lib/permissions";
import type { UnbilledEntry } from "@/lib/wip";

// Loads unbilled work-in-progress from the DB. Shaping/grouping helpers live in the pure
// `@/lib/wip` module so client components can reuse them.
export * from "@/lib/wip";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Every unbilled approved entry the user can see, flattened. `asOf` drives the age calculation
 *  (defaults to now) — passed explicitly so callers/tests get a stable reference point. */
export async function loadUnbilledEntries(user: SessionUser, asOf: Date = new Date()): Promise<UnbilledEntry[]> {
  const projectIds = await visibleProjectIds(user);
  const projectWhere = projectIds === "ALL" ? { companyId: user.companyId } : { companyId: user.companyId, id: { in: projectIds } };

  const rows = await prisma.timeEntry.findMany({
    where: {
      invoiceLineId: null,
      timeCard: { status: "APPROVED" },
      milestone: { billable: true, project: projectWhere },
    },
    select: {
      id: true,
      date: true,
      hours: true,
      billRate: true,
      user: { select: { name: true } },
      assignment: { select: { billRate: true } },
      milestone: {
        select: { id: true, name: true, salesPrice: true, project: { select: { id: true, name: true, client: { select: { name: true } } } } },
      },
    },
    orderBy: { date: "asc" },
  });

  // Compare at UTC midnight — TimeEntry.date is stored there, so a same-day entry ages 0, not -1.
  const today = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return rows.map((e) => {
    const hours = Number(e.hours);
    const rate =
      e.billRate != null ? Number(e.billRate) : e.assignment.billRate != null ? Number(e.assignment.billRate) : Number(e.milestone.salesPrice);
    const iso = e.date.toISOString().slice(0, 10);
    return {
      entryId: e.id,
      projectId: e.milestone.project.id,
      projectName: e.milestone.project.name,
      clientName: e.milestone.project.client.name,
      milestoneId: e.milestone.id,
      milestoneName: e.milestone.name,
      userName: e.user.name,
      date: iso,
      month: iso.slice(0, 7),
      hours: round2(hours),
      rate: round2(rate),
      value: round2(hours * rate),
      ageDays: Math.max(0, Math.floor((today - e.date.getTime()) / 86_400_000)),
    };
  });
}

