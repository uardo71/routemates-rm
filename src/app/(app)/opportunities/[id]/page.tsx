import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { computeQuoteTotals } from "@/lib/opportunity";
import { OpportunityDetailClient, type OpportunityDetail } from "./opportunity-detail-client";

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("opportunities:view");

  const opp = await prisma.opportunity.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      client: { select: { id: true, name: true } },
      contact: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
      submittedBy: { select: { name: true } },
      decidedBy: { select: { name: true } },
      project: { select: { id: true, name: true } },
      lines: { orderBy: { sortOrder: "asc" } },
      revisions: { orderBy: { version: "desc" }, include: { issuedBy: { select: { name: true } } } },
    },
  });
  if (!opp) notFound();

  const [clients, contacts, owners] = await Promise.all([
    prisma.client.findMany({ where: { companyId: user.companyId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.contact.findMany({
      where: { client: { companyId: user.companyId } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, clientId: true },
    }),
    prisma.user.findMany({
      where: { companyId: user.companyId, active: true, role: { in: ["ADMIN", "PM", "SALES"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const lineNums = opp.lines.map((l) => ({ quantityHours: Number(l.quantityHours), unitPrice: Number(l.unitPrice) }));
  const discountValue = opp.discountValue == null ? null : Number(opp.discountValue);
  const totals = computeQuoteTotals(lineNums, opp.discountType, discountValue);

  const detail: OpportunityDetail = {
    id: opp.id,
    name: opp.name,
    reference: opp.reference,
    stage: opp.stage,
    billingType: opp.billingType,
    currency: opp.currency,
    clientId: opp.client.id,
    clientName: opp.client.name,
    contactId: opp.contact?.id ?? null,
    contactName: opp.contact?.name ?? null,
    ownerId: opp.owner.id,
    ownerName: opp.owner.name,
    probability: opp.probability,
    expectedCloseDate: opp.expectedCloseDate ? opp.expectedCloseDate.toISOString().slice(0, 10) : null,
    discountType: opp.discountType,
    discountValue,
    sowNumber: opp.sowNumber,
    sowSignedDate: opp.sowSignedDate ? opp.sowSignedDate.toISOString().slice(0, 10) : null,
    poNumber: opp.poNumber,
    poAmount: opp.poAmount == null ? null : Number(opp.poAmount),
    poDate: opp.poDate ? opp.poDate.toISOString().slice(0, 10) : null,
    lostReason: opp.lostReason,
    decisionComment: opp.decisionComment,
    submittedByName: opp.submittedBy?.name ?? null,
    decidedByName: opp.decidedBy?.name ?? null,
    projectId: opp.project?.id ?? null,
    projectName: opp.project?.name ?? null,
    gross: totals.gross,
    discountAmount: totals.discountAmount,
    net: totals.net,
    lines: opp.lines.map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description,
      quantityHours: Number(l.quantityHours),
      unitPrice: Number(l.unitPrice),
      billable: l.billable,
    })),
    revisions: opp.revisions.map((r) => ({
      id: r.id,
      version: r.version,
      label: r.label,
      note: r.note,
      grossAmount: Number(r.grossAmount),
      discountAmount: Number(r.discountAmount),
      netAmount: Number(r.netAmount),
      issuedByName: r.issuedBy.name,
      createdAt: r.createdAt.toISOString().slice(0, 10),
    })),
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/opportunities" className="text-sm text-muted-foreground hover:underline">
          ← Opportunities
        </Link>
      </div>
      <OpportunityDetailClient
        detail={detail}
        canManage={can(user, "opportunities:manage")}
        canApprove={can(user, "opportunities:approve")}
        clients={clients}
        contacts={contacts}
        owners={owners}
      />
    </div>
  );
}
