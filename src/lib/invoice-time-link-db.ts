// Database side of manual-invoice time linking. Deliberately NOT server-only: the repair script
// (scripts/link-manual-invoice-time.ts) runs the exact same routine as the live invoice actions.
import type { PrismaClient } from "@prisma/client";
import { buildUnits, allocateUnits, resolveLineTask, type AllocLine } from "@/lib/invoice-time-link";

const COMMISSION_DESC = "Sales comision";
const EPS = 0.005;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export type RelinkLine = { invoiceNumber: string; lineId: string; description: string; quantity: number; before: number; after: number; locked: boolean };
export type RelinkChange = { entryId: string; from: string | null; to: string | null };
export type RelinkReport = { projectId: string; periodStart: string; periodEnd: string; lines: RelinkLine[]; changes: RelinkChange[]; unbilledHours: number };

/** Re-matches approved time to the MANUAL invoice lines of one billing period: one project, one
 *  service period, every non-void invoice carrying that period. Lines created from approved time
 *  (tied to a milestone and already linked to exactly their quantity) are left exactly as they are;
 *  every other line of the period is cleared and re-matched with `allocateUnits`. With
 *  `apply: false` nothing is written and the report says what would change. */
export async function relinkInvoicePeriod(db: PrismaClient, projectId: string, periodStart: Date, periodEnd: Date, opts: { apply: boolean }): Promise<RelinkReport | null> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { billingType: true } });
  // Fixed-price lines are lump sums, not hours — there is nothing to match them against.
  if (!project || project.billingType === "FIXED_PRICE") return null;

  const invoices = await db.invoice.findMany({
    where: { projectId, type: "INVOICE", status: { not: "VOID" }, periodStart, periodEnd },
    select: {
      invoiceNumber: true,
      lines: { select: { id: true, description: true, quantity: true, milestoneId: true, timeEntries: { select: { id: true, hours: true } } }, orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ issueDate: "asc" }, { invoiceNumber: "asc" }],
  });
  const lines = invoices.flatMap((inv) => inv.lines
    .filter((l) => l.description !== COMMISSION_DESC && Number(l.quantity) > EPS)
    .map((l) => {
      const linked = r2(l.timeEntries.reduce((s, t) => s + Number(t.hours), 0));
      return { invoiceNumber: inv.invoiceNumber, id: l.id, description: l.description, quantity: Number(l.quantity), milestoneId: l.milestoneId, linked, locked: l.milestoneId != null && l.timeEntries.length > 0 && Math.abs(linked - Number(l.quantity)) < EPS };
    }));
  const open = lines.filter((l) => !l.locked);
  const openIds = open.map((l) => l.id);

  const end = new Date(periodEnd);
  end.setUTCHours(23, 59, 59, 999);
  const [candidates, tasks] = await Promise.all([
    db.timeEntry.findMany({
      where: {
        timeCard: { status: "APPROVED" },
        date: { gte: periodStart, lte: end },
        milestone: { billable: true, projectId },
        OR: [{ invoiceLineId: null }, ...(openIds.length ? [{ invoiceLineId: { in: openIds } }] : [])],
      },
      select: { id: true, hours: true, date: true, milestoneId: true, taskId: true, assignmentId: true, invoiceLineId: true },
    }),
    db.task.findMany({ where: { milestone: { projectId } }, select: { id: true, name: true, milestoneId: true } }),
  ]);

  const allocLines: AllocLine[] = open.map((l) => ({ id: l.id, quantity: l.quantity, milestoneId: l.milestoneId, taskId: resolveLineTask(l.description, tasks, l.milestoneId) }));
  const units = buildUnits(candidates.map((c) => ({ id: c.id, hours: Number(c.hours), date: iso(c.date), milestoneId: c.milestoneId, taskId: c.taskId, assignmentId: c.assignmentId })));
  const { links, lineHours } = allocateUnits(allocLines, units);

  const changes: RelinkChange[] = candidates
    .map((c) => ({ entryId: c.id, from: c.invoiceLineId, to: links.get(c.id) ?? null }))
    .filter((c) => c.from !== c.to);

  if (opts.apply && changes.length > 0) {
    await db.$transaction(async (tx) => {
      const candidateIds = candidates.map((c) => c.id);
      if (openIds.length) await tx.timeEntry.updateMany({ where: { id: { in: candidateIds }, invoiceLineId: { in: openIds } }, data: { invoiceLineId: null } });
      const byLine = new Map<string, string[]>();
      for (const [entryId, lineId] of links) (byLine.get(lineId) ?? byLine.set(lineId, []).get(lineId)!).push(entryId);
      for (const [lineId, ids] of byLine) {
        // Guarded on still being unlinked, so a concurrent time-based invoice can't lose its claim.
        await tx.timeEntry.updateMany({ where: { id: { in: ids }, invoiceLineId: null }, data: { invoiceLineId: lineId } });
      }
    });
  }

  const linkedIds = new Set(links.keys());
  return {
    projectId,
    periodStart: iso(periodStart),
    periodEnd: iso(periodEnd),
    lines: lines.map((l) => ({ invoiceNumber: l.invoiceNumber, lineId: l.id, description: l.description, quantity: l.quantity, before: l.linked, after: l.locked ? l.linked : lineHours.get(l.id) ?? 0, locked: l.locked })),
    changes,
    unbilledHours: r2(candidates.filter((c) => !linkedIds.has(c.id) && (c.invoiceLineId == null || openIds.includes(c.invoiceLineId))).reduce((s, c) => s + Number(c.hours), 0)),
  };
}

/** The live hook: after a manual invoice is created or edited, re-match its whole billing period. */
export async function relinkForInvoice(db: PrismaClient, invoiceId: string): Promise<RelinkReport | null> {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, select: { type: true, projectId: true, periodStart: true, periodEnd: true } });
  if (!inv || inv.type !== "INVOICE" || !inv.projectId || !inv.periodStart || !inv.periodEnd) return null;
  return relinkInvoicePeriod(db, inv.projectId, inv.periodStart, inv.periodEnd, { apply: true });
}

/** Every billing period that has a manual-invoice candidate, oldest first — the repair script's worklist. */
export async function manualInvoicePeriods(db: PrismaClient): Promise<{ projectId: string; periodStart: Date; periodEnd: Date }[]> {
  const rows = await db.invoice.findMany({
    where: { type: "INVOICE", status: { not: "VOID" }, projectId: { not: null }, periodStart: { not: null }, periodEnd: { not: null }, project: { billingType: { in: ["TIME_AND_MATERIALS", "RETAINER"] } } },
    select: { projectId: true, periodStart: true, periodEnd: true },
    orderBy: { periodStart: "asc" },
  });
  const seen = new Set<string>();
  const out: { projectId: string; periodStart: Date; periodEnd: Date }[] = [];
  for (const r of rows) {
    const key = `${r.projectId}|${iso(r.periodStart!)}|${iso(r.periodEnd!)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ projectId: r.projectId!, periodStart: r.periodStart!, periodEnd: r.periodEnd! });
  }
  return out;
}
