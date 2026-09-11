"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { manualInvoicePeriods, relinkInvoicePeriod } from "@/lib/invoice-time-link-db";

export type RematchPeriod = {
  projectName: string;
  periodStart: string;
  periodEnd: string;
  changes: number;
  unbilledHours: number;
  lines: { invoiceNumber: string; description: string; quantity: number; before: number; after: number; locked: boolean }[];
};
export type RematchSummary = { periods: RematchPeriod[]; totalChanges: number };

/** Re-matches approved time to the manually typed invoices of every billing period of this company,
 *  with the same rule the invoice actions use on create/edit (task on the line, corrections with the
 *  hours they correct, the whole service period together). Invoices created from approved time are
 *  never touched. `apply: false` only reports. */
async function rematch(apply: boolean): Promise<{ error?: string; summary?: RematchSummary }> {
  const user = await requirePermission("invoices:manage");
  const all = await manualInvoicePeriods(prisma);
  const projects = await prisma.project.findMany({
    where: { companyId: user.companyId, id: { in: [...new Set(all.map((p) => p.projectId))] } },
    select: { id: true, name: true },
  });
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const periods: RematchPeriod[] = [];
  for (const p of all) {
    const name = names.get(p.projectId);
    if (!name) continue; // another company's invoice
    const r = await relinkInvoicePeriod(prisma, p.projectId, p.periodStart, p.periodEnd, { apply });
    if (!r || r.changes.length === 0) continue;
    periods.push({
      projectName: name, periodStart: r.periodStart, periodEnd: r.periodEnd, changes: r.changes.length, unbilledHours: r.unbilledHours,
      lines: r.lines.map((l) => ({ invoiceNumber: l.invoiceNumber, description: l.description, quantity: l.quantity, before: l.before, after: l.after, locked: l.locked })),
    });
  }
  if (apply) {
    revalidatePath("/revenue/unbilled");
    revalidatePath("/revenue");
    revalidatePath("/invoices");
  }
  return { summary: { periods, totalChanges: periods.reduce((s, p) => s + p.changes, 0) } };
}

export async function previewRematchAction(): Promise<{ error?: string; summary?: RematchSummary }> {
  return rematch(false);
}

export async function applyRematchAction(): Promise<{ error?: string; summary?: RematchSummary }> {
  return rematch(true);
}
