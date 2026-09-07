import "server-only";
import { prisma } from "@/lib/prisma";
import { convertWith, loadRateResolver, type ExcludedGroup } from "@/lib/fx";

// Vendor bills attributed to a project ("subcontractor / external" cost). Kept separate from the
// pure margin math in `@/lib/revenue` — this module only queries and converts.

/** Both statuses count. A bill sitting in TO_PAY is money already owed for work already done;
 *  waiting for it to be settled before it hits margin would flatter every in-flight project. */
const COUNTED_STATUSES = ["TO_PAY", "PAID"] as const;

export type ExternalCostBill = {
  id: string;
  vendorId: string;
  vendorName: string;
  description: string | null;
  invoiceNumber: string | null;
  status: (typeof COUNTED_STATUSES)[number];
  /** As billed, in the vendor's own currency. */
  amount: number;
  currency: string;
  /** Converted to the reporting currency; null when no exchange rate covers it. */
  baseAmount: number | null;
  invoiceDate: string | null;
  dueDate: string | null;
  paymentDate: string | null;
  projectId: string;
  milestoneId: string | null;
};

export type ExternalCostResult = {
  bills: ExternalCostBill[];
  /** projectId → total external cost in the reporting currency. */
  byProject: Map<string, number>;
  /** milestoneId → total external cost in the reporting currency (bills attributed that finely). */
  byMilestone: Map<string, number>;
  /** Bills that couldn't be converted — surfaced, never summed at 1:1 or silently dropped. */
  excluded: ExcludedGroup[];
};

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Project-attributed vendor bills, converted to `reportingCurrency` at the bill's economic date
 *  (`invoiceDate ?? paymentDate`, falling back to when it was recorded).
 *
 *  `projectIds` scopes the query to what the caller may see — pass the already-permission-filtered
 *  set, since this returns cost figures. */
export async function loadExternalCost(
  companyId: string,
  reportingCurrency: string,
  projectIds?: string[],
): Promise<ExternalCostResult> {
  const rows = await prisma.vendorPayment.findMany({
    where: {
      companyId,
      status: { in: [...COUNTED_STATUSES] },
      projectId: projectIds ? { in: projectIds } : { not: null },
    },
    select: {
      id: true, vendorId: true, description: true, invoiceNumber: true, status: true,
      amount: true, currency: true, invoiceDate: true, dueDate: true, paymentDate: true,
      createdAt: true, projectId: true, milestoneId: true,
      vendor: { select: { name: true } },
    },
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
  });

  const resolve = await loadRateResolver();
  const bills: ExternalCostBill[] = [];
  const byProject = new Map<string, number>();
  const byMilestone = new Map<string, number>();
  const exMap = new Map<string, ExcludedGroup>();

  for (const r of rows) {
    if (!r.projectId) continue; // narrowing; the query already excludes nulls
    const amount = Number(r.amount);
    // Economic date: when the bill was raised, else when it was paid, else when it was recorded.
    const date = r.invoiceDate ?? r.paymentDate ?? r.createdAt;
    const converted =
      r.currency === reportingCurrency
        ? amount
        : await convertWith(amount, r.currency, reportingCurrency, (f, t) => resolve(f, t, date));
    const baseAmount = converted === null ? null : round2(converted);

    if (baseAmount === null) {
      const key = `${r.currency}|${iso(date)}`;
      const g = exMap.get(key) ?? { currency: r.currency, date: iso(date) ?? "", count: 0 };
      g.count++;
      exMap.set(key, g);
    } else {
      byProject.set(r.projectId, round2((byProject.get(r.projectId) ?? 0) + baseAmount));
      if (r.milestoneId) byMilestone.set(r.milestoneId, round2((byMilestone.get(r.milestoneId) ?? 0) + baseAmount));
    }

    bills.push({
      id: r.id,
      vendorId: r.vendorId,
      vendorName: r.vendor.name,
      description: r.description,
      invoiceNumber: r.invoiceNumber,
      status: r.status,
      amount: round2(amount),
      currency: r.currency,
      baseAmount,
      invoiceDate: iso(r.invoiceDate),
      dueDate: iso(r.dueDate),
      paymentDate: iso(r.paymentDate),
      projectId: r.projectId,
      milestoneId: r.milestoneId,
    });
  }

  return { bills, byProject, byMilestone, excluded: [...exMap.values()] };
}
