import "server-only";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/permissions";
import { loadUnbilledEntries } from "@/lib/wip-data";
import { readinessChecks, closureChecks, type GateCheck } from "@/lib/project-stage";

// Everything the lifecycle gates read for one project, loaded once, so the project page (dialog)
// and the status-change action evaluate exactly the same checks.

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export type LifecycleOverride = { reason: string; at: string | null; byName: string | null };
export type LifecycleContext = {
  projectId: string;
  name: string;
  status: string;
  isInternal: boolean;
  readiness: GateCheck[];
  closure: GateCheck[];
  unbilledHours: number;
  unbilledValue: number;
  currency: string;
  uatNotApplicable: boolean;
  /** Milestones that block closure (not complete, invoiced or written off). */
  openMilestones: { id: string; name: string; status: string }[];
  activationOverride: LifecycleOverride | null;
  closureOverride: LifecycleOverride | null;
};

export async function loadLifecycleContext(user: SessionUser, projectId: string, opts: { wipAcknowledged?: boolean; uatNotApplicable?: boolean } = {}): Promise<LifecycleContext | null> {
  const p = await prisma.project.findFirst({
    where: { id: projectId, companyId: user.companyId },
    select: {
      id: true, name: true, status: true, isInternal: true, managerId: true, startDate: true, endDate: true, billingType: true,
      contractValue: true, budgetAmount: true, sponsorContactId: true, sowNumber: true, poNumber: true, poWaived: true,
      uatStatus: true, uatNotApplicable: true,
      activationOverrideReason: true, activationOverrideAt: true, activationOverrideById: true,
      closureOverrideReason: true, closureOverrideAt: true, closureOverrideById: true,
      company: { select: { currency: true } },
      milestones: { select: { id: true, name: true, status: true, writtenOffAt: true, _count: { select: { assignments: true } } }, orderBy: { createdAt: "asc" } },
      statusReports: { orderBy: { reportDate: "desc" }, take: 1, select: { reportDate: true } },
      _count: { select: { raidItems: { where: { status: { in: ["OPEN", "IN_PROGRESS"] } } } } },
    },
  });
  if (!p) return null;

  const [submittedCardCount, unbilled, overriders] = await Promise.all([
    prisma.timeCard.count({ where: { status: "SUBMITTED", milestone: { projectId } } }),
    // Unbilled WIP comes from the one WIP loader — never re-derived here.
    loadUnbilledEntries(user).then((rows) => rows.filter((r) => r.projectId === projectId)),
    prisma.user.findMany({ where: { id: { in: [p.activationOverrideById, p.closureOverrideById].filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ]);
  const nameOf = (id: string | null) => (id ? overriders.find((u) => u.id === id)?.name ?? null : null);
  const unbilledHours = Math.round(unbilled.reduce((s, e) => s + e.hours, 0) * 100) / 100;
  const unbilledValue = Math.round(unbilled.reduce((s, e) => s + e.value, 0) * 100) / 100;
  const uatNotApplicable = p.uatNotApplicable || !!opts.uatNotApplicable;
  const milestones = p.milestones.map((m) => ({ name: m.name, status: m.status, writtenOff: m.writtenOffAt != null }));

  return {
    projectId: p.id,
    name: p.name,
    status: p.status,
    isInternal: p.isInternal,
    readiness: readinessChecks({
      managerId: p.managerId, startDate: iso(p.startDate), endDate: iso(p.endDate),
      milestoneCount: p.milestones.length, assignmentCount: p.milestones.reduce((s, m) => s + m._count.assignments, 0),
      billingType: p.billingType, contractValue: p.contractValue == null ? null : Number(p.contractValue),
      budgetAmount: p.budgetAmount == null ? null : Number(p.budgetAmount),
      sponsorContactId: p.sponsorContactId, sowNumber: p.sowNumber, poNumber: p.poNumber, poWaived: p.poWaived,
    }),
    closure: closureChecks({
      todayIso: new Date().toISOString().slice(0, 10),
      openRaidCount: p._count.raidItems,
      lastStatusIso: iso(p.statusReports[0]?.reportDate),
      uatStatus: p.uatStatus, uatNotApplicable,
      milestones,
      unbilledHours, unbilledValue, currency: p.company.currency,
      wipAcknowledged: !!opts.wipAcknowledged,
      submittedCardCount,
    }),
    unbilledHours, unbilledValue, currency: p.company.currency,
    uatNotApplicable: p.uatNotApplicable,
    openMilestones: p.milestones.filter((m) => m.status !== "COMPLETE" && m.status !== "INVOICED" && !m.writtenOffAt).map((m) => ({ id: m.id, name: m.name, status: m.status })),
    activationOverride: p.activationOverrideReason ? { reason: p.activationOverrideReason, at: iso(p.activationOverrideAt), byName: nameOf(p.activationOverrideById) } : null,
    closureOverride: p.closureOverrideReason ? { reason: p.closureOverrideReason, at: iso(p.closureOverrideAt), byName: nameOf(p.closureOverrideById) } : null,
  };
}
