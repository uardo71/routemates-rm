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
      project: { select: { id: true, name: true, milestones: { select: { id: true, name: true }, orderBy: { createdAt: "asc" } } } },
      lines: { orderBy: { sortOrder: "asc" } },
      revisions: { orderBy: { version: "desc" }, include: { issuedBy: { select: { name: true } } } },
      amendments: { orderBy: { version: "desc" }, include: { appliedBy: { select: { name: true } } } },
      documents: { orderBy: { uploadedAt: "desc" }, select: { id: true, kind: true, fileName: true, originalName: true } },
      milestoneAdjustments: {
        orderBy: { createdAt: "desc" },
        include: { milestone: { select: { id: true, name: true, project: { select: { id: true, name: true } } } } },
      },
    },
  });
  if (!opp) notFound();
  // PMs can only open opportunities they own or submitted (not the whole pipeline).
  if (user.role === "PM" && opp.ownerId !== user.id && opp.submittedById !== user.id) notFound();

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
    number: opp.number,
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
    // Milestone value absorbed into this deal from other projects (indication of real value only —
    // the removed money is stored as a NEGATIVE adjustment on the milestone; here we surface its
    // magnitude so "real value = net + absorbed" reads correctly without inflating the contract).
    absorbedFrom: opp.milestoneAdjustments
      .filter((adj) => Number(adj.amount) < 0)
      .map((adj) => ({
        id: adj.id,
        amount: -Number(adj.amount),
        reason: adj.reason,
        milestoneId: adj.milestone.id,
        milestoneName: adj.milestone.name,
        projectId: adj.milestone.project.id,
        projectName: adj.milestone.project.name,
      })),
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
    documents: opp.documents.map((d) => ({ id: d.id, kind: d.kind, fileName: d.fileName, originalName: d.originalName })),
    projectMilestones: opp.project?.milestones.map((m) => ({ id: m.id, name: m.name })) ?? [],
    amendments: opp.amendments.map((a) => ({
      id: a.id,
      version: a.version,
      reference: a.reference,
      poNumber: a.poNumber,
      signedDate: a.signedDate ? a.signedDate.toISOString().slice(0, 10) : null,
      note: a.note,
      addedHours: Number(a.addedHours),
      netAmount: Number(a.netAmount),
      appliedByName: a.appliedBy.name,
      createdAt: a.createdAt.toISOString().slice(0, 10),
      lines: (Array.isArray(a.linesSnapshot) ? a.linesSnapshot : []) as unknown as {
        name: string;
        quantityHours: number;
        unitPrice: number;
        billable: boolean;
        target: string;
        createdMilestoneId: string | null;
      }[],
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
