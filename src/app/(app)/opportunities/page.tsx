import { requirePermission } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { computeQuoteTotals } from "@/lib/opportunity";
import { OpportunitiesClient, type OppRow } from "./opportunities-client";

export default async function OpportunitiesPage() {
  const user = await requirePermission("opportunities:view");

  const [opps, company] = await Promise.all([
    prisma.opportunity.findMany({
      where: { companyId: user.companyId },
      include: {
        client: { select: { name: true } },
        owner: { select: { name: true } },
        lines: { select: { quantityHours: true, unitPrice: true } },
        _count: { select: { lines: true, revisions: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.company.findUnique({ where: { id: user.companyId }, select: { currency: true } }),
  ]);

  const rows: OppRow[] = opps.map((o) => {
    const totals = computeQuoteTotals(
      o.lines.map((l) => ({ quantityHours: Number(l.quantityHours), unitPrice: Number(l.unitPrice) })),
      o.discountType,
      o.discountValue == null ? null : Number(o.discountValue),
    );
    return {
      id: o.id,
      name: o.name,
      clientName: o.client.name,
      ownerName: o.owner.name,
      stage: o.stage,
      billingType: o.billingType,
      currency: o.currency,
      probability: o.probability,
      expectedCloseDate: o.expectedCloseDate ? o.expectedCloseDate.toISOString().slice(0, 10) : null,
      gross: totals.gross,
      net: totals.net,
      lineCount: o._count.lines,
      revisionCount: o._count.revisions,
      isWon: o.stage === "WON",
      projectId: o.projectId,
    };
  });

  return (
    <OpportunitiesClient
      rows={rows}
      canManage={can(user, "opportunities:manage")}
      defaultCurrency={company?.currency ?? "USD"}
    />
  );
}
