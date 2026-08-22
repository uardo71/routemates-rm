"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseISO } from "date-fns";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { computeQuoteTotals, isOpenStage } from "@/lib/opportunity";
import { nextOpportunityNumber, nextProjectNumber } from "@/lib/numbering";
import { applyPlaybookToProject } from "@/lib/playbook";
import { MAX_RECEIPT_SIZE_BYTES, isAllowedReceiptType, saveReceiptFile, deleteReceiptFile } from "@/lib/receipt-storage";

// ---------- helpers ----------

/** Parse an optional date-only string with parseISO (this app's convention — the native Date
 *  constructor treats "YYYY-MM-DD" as UTC and drifts off local midnight). Returns undefined for
 *  empty input, or the string "invalid" sentinel handled by callers. */
function parseOptionalDate(value: string | undefined): Date | null | "invalid" {
  if (!value) return null;
  const d = parseISO(value);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

// ---------- create ----------

const CreateSchema = z.object({
  name: z.string().min(1, "Name is required.").max(200),
  clientId: z.string().min(1, "Pick a client."),
  contactId: z.string().optional(),
  billingType: z.enum(["TIME_AND_MATERIALS", "FIXED_PRICE", "RETAINER"]),
  currency: z.string().max(10).optional(),
  reference: z.string().max(100).optional(),
  expectedCloseDate: z.string().optional(),
  probability: z.coerce.number().int().min(0).max(100).optional(),
  ownerId: z.string().optional(),
});

/** Form-action create (useActionState convention: returns an error string, or redirects on
 *  success). New opportunities always start in QUALIFYING, owned by the chosen owner (defaults to
 *  the creator). */
export async function createOpportunityAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const caller = await requirePermission("opportunities:manage");
  const parsed = CreateSchema.safeParse({
    name: formData.get("name"),
    clientId: formData.get("clientId"),
    contactId: formData.get("contactId") || undefined,
    billingType: formData.get("billingType"),
    currency: formData.get("currency") || undefined,
    reference: formData.get("reference") || undefined,
    expectedCloseDate: formData.get("expectedCloseDate") || undefined,
    probability: formData.get("probability") || undefined,
    ownerId: formData.get("ownerId") || undefined,
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input.";
  const data = parsed.data;

  const client = await prisma.client.findFirst({ where: { id: data.clientId, companyId: caller.companyId } });
  if (!client) return "Invalid client.";

  if (data.contactId) {
    const contact = await prisma.contact.findFirst({ where: { id: data.contactId, clientId: client.id } });
    if (!contact) return "That contact doesn't belong to the selected client.";
  }

  const ownerId = data.ownerId ?? caller.id;
  const owner = await prisma.user.findFirst({ where: { id: ownerId, companyId: caller.companyId } });
  if (!owner) return "Invalid owner.";

  const closeDate = parseOptionalDate(data.expectedCloseDate);
  if (closeDate === "invalid") return "Invalid expected close date.";

  let currency = data.currency;
  if (!currency) {
    const company = await prisma.company.findUnique({ where: { id: caller.companyId }, select: { currency: true } });
    currency = company?.currency ?? "USD";
  }

  const opp = await prisma.opportunity.create({
    data: {
      companyId: caller.companyId,
      clientId: client.id,
      contactId: data.contactId ?? null,
      name: data.name,
      number: await nextOpportunityNumber(caller.companyId),
      reference: data.reference ?? null,
      stage: "QUALIFYING",
      billingType: data.billingType,
      currency,
      expectedCloseDate: closeDate,
      probability: data.probability ?? null,
      ownerId,
    },
  });

  revalidatePath("/opportunities");
  redirect(`/opportunities/${opp.id}`);
}

// ---------- update header / discount / SoW / PO ----------

const UpdateSchema = z.object({
  opportunityId: z.string().min(1),
  name: z.string().min(1).max(200),
  clientId: z.string().min(1),
  contactId: z.string().optional().nullable(),
  billingType: z.enum(["TIME_AND_MATERIALS", "FIXED_PRICE", "RETAINER"]),
  currency: z.string().min(1).max(10),
  reference: z.string().max(100).optional().nullable(),
  expectedCloseDate: z.string().optional().nullable(),
  probability: z.coerce.number().int().min(0).max(100).optional().nullable(),
  ownerId: z.string().min(1),
  discountType: z.enum(["PERCENT", "ABSOLUTE"]).optional().nullable(),
  discountValue: z.coerce.number().min(0).optional().nullable(),
  sowNumber: z.string().max(100).optional().nullable(),
  sowSignedDate: z.string().optional().nullable(),
  poNumber: z.string().max(100).optional().nullable(),
  poAmount: z.coerce.number().min(0).optional().nullable(),
  poDate: z.string().optional().nullable(),
});
export type UpdateOpportunityInput = z.infer<typeof UpdateSchema>;

export async function updateOpportunityAction(input: UpdateOpportunityInput): Promise<{ error?: string }> {
  const caller = await requirePermission("opportunities:manage");
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const opp = await prisma.opportunity.findFirst({ where: { id: data.opportunityId, companyId: caller.companyId } });
  if (!opp) return { error: "Opportunity not found." };
  // Once won the deal is frozen (its Project already exists); other terminal states are closed.
  if (opp.stage === "WON" || opp.stage === "LOST" || opp.stage === "CANCELLED") {
    return { error: "This opportunity is closed and can no longer be edited." };
  }

  const client = await prisma.client.findFirst({ where: { id: data.clientId, companyId: caller.companyId } });
  if (!client) return { error: "Invalid client." };
  if (data.contactId) {
    const contact = await prisma.contact.findFirst({ where: { id: data.contactId, clientId: client.id } });
    if (!contact) return { error: "That contact doesn't belong to the selected client." };
  }
  const owner = await prisma.user.findFirst({ where: { id: data.ownerId, companyId: caller.companyId } });
  if (!owner) return { error: "Invalid owner." };

  const closeDate = parseOptionalDate(data.expectedCloseDate ?? undefined);
  if (closeDate === "invalid") return { error: "Invalid expected close date." };
  const sowDate = parseOptionalDate(data.sowSignedDate ?? undefined);
  if (sowDate === "invalid") return { error: "Invalid SoW signed date." };
  const poDate = parseOptionalDate(data.poDate ?? undefined);
  if (poDate === "invalid") return { error: "Invalid PO date." };

  // A discount type without a value (or vice-versa) is meaningless — require both or neither.
  const hasDiscountType = !!data.discountType;
  const hasDiscountValue = data.discountValue != null && data.discountValue > 0;
  if (hasDiscountType !== hasDiscountValue) {
    return { error: "Set both a discount type and a value, or leave both empty." };
  }
  if (data.discountType === "PERCENT" && (data.discountValue ?? 0) > 100) {
    return { error: "A percentage discount can't exceed 100%." };
  }

  await prisma.opportunity.update({
    where: { id: opp.id },
    data: {
      name: data.name,
      clientId: client.id,
      contactId: data.contactId ?? null,
      billingType: data.billingType,
      currency: data.currency,
      reference: data.reference ?? null,
      expectedCloseDate: closeDate,
      probability: data.probability ?? null,
      ownerId: owner.id,
      discountType: hasDiscountType ? data.discountType : null,
      discountValue: hasDiscountType ? data.discountValue : null,
      sowNumber: data.sowNumber ?? null,
      sowSignedDate: sowDate,
      poNumber: data.poNumber ?? null,
      poAmount: data.poAmount ?? null,
      poDate: poDate,
    },
  });
  revalidatePath(`/opportunities/${opp.id}`);
  revalidatePath("/opportunities");
  return {};
}

// ---------- quote line CRUD (open stages only) ----------

const LineSchema = z.object({
  opportunityId: z.string().min(1),
  name: z.string().min(1, "Line name is required.").max(200),
  description: z.string().max(1000).optional().nullable(),
  quantityHours: z.coerce.number().min(0, "Hours can't be negative."),
  unitPrice: z.coerce.number().min(0, "Price can't be negative."),
  billable: z.boolean().optional(),
});
export type LineInput = z.infer<typeof LineSchema>;

/** Guard: lines are only editable while the deal is actively worked (QUALIFYING/PROPOSAL_SENT/
 *  NEGOTIATION). Once submitted for approval / won / closed the quote is locked. */
async function assertLineEditable(opportunityId: string, companyId: string) {
  const opp = await prisma.opportunity.findFirst({ where: { id: opportunityId, companyId } });
  if (!opp) return { error: "Opportunity not found." as string };
  if (!isOpenStage(opp.stage)) return { error: "The quote can only be edited while the opportunity is open." };
  return { opp };
}

export async function addLineAction(input: LineInput): Promise<{ error?: string }> {
  const caller = await requirePermission("opportunities:manage");
  const parsed = LineSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;
  const guard = await assertLineEditable(data.opportunityId, caller.companyId);
  if (guard.error) return { error: guard.error };

  const last = await prisma.opportunityLine.findFirst({
    where: { opportunityId: data.opportunityId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  await prisma.opportunityLine.create({
    data: {
      opportunityId: data.opportunityId,
      name: data.name,
      description: data.description ?? null,
      quantityHours: data.quantityHours,
      unitPrice: data.unitPrice,
      billable: data.billable ?? true,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });
  revalidatePath(`/opportunities/${data.opportunityId}`);
  return {};
}

const UpdateLineSchema = LineSchema.extend({ lineId: z.string().min(1) });
export type UpdateLineInput = z.infer<typeof UpdateLineSchema>;

export async function updateLineAction(input: UpdateLineInput): Promise<{ error?: string }> {
  const caller = await requirePermission("opportunities:manage");
  const parsed = UpdateLineSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;
  const guard = await assertLineEditable(data.opportunityId, caller.companyId);
  if (guard.error) return { error: guard.error };

  const line = await prisma.opportunityLine.findFirst({ where: { id: data.lineId, opportunityId: data.opportunityId } });
  if (!line) return { error: "Line not found." };
  await prisma.opportunityLine.update({
    where: { id: line.id },
    data: {
      name: data.name,
      description: data.description ?? null,
      quantityHours: data.quantityHours,
      unitPrice: data.unitPrice,
      billable: data.billable ?? true,
    },
  });
  revalidatePath(`/opportunities/${data.opportunityId}`);
  return {};
}

export async function deleteLineAction(opportunityId: string, lineId: string): Promise<{ error?: string }> {
  const caller = await requirePermission("opportunities:manage");
  const guard = await assertLineEditable(opportunityId, caller.companyId);
  if (guard.error) return { error: guard.error };
  const line = await prisma.opportunityLine.findFirst({ where: { id: lineId, opportunityId } });
  if (!line) return { error: "Line not found." };
  await prisma.opportunityLine.delete({ where: { id: line.id } });
  revalidatePath(`/opportunities/${opportunityId}`);
  return {};
}

// ---------- stage transitions ----------

const SetStageSchema = z.object({
  opportunityId: z.string().min(1),
  stage: z.enum(["QUALIFYING", "PROPOSAL_SENT", "NEGOTIATION", "CANCELLED"]),
});

/** Move between the freely-worked stages (or cancel). Winning goes through submit-for-approval +
 *  admin decide; losing goes through markLost (captures a reason). */
export async function setStageAction(input: z.infer<typeof SetStageSchema>): Promise<{ error?: string }> {
  const caller = await requirePermission("opportunities:manage");
  const parsed = SetStageSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input." };
  const { opportunityId, stage } = parsed.data;

  const opp = await prisma.opportunity.findFirst({ where: { id: opportunityId, companyId: caller.companyId } });
  if (!opp) return { error: "Opportunity not found." };
  if (opp.stage === "WON") return { error: "A won opportunity can't change stage." };
  if (stage !== "CANCELLED" && !isOpenStage(opp.stage)) {
    return { error: "This opportunity is closed." };
  }
  await prisma.opportunity.update({ where: { id: opp.id }, data: { stage } });
  revalidatePath(`/opportunities/${opp.id}`);
  revalidatePath("/opportunities");
  return {};
}

/** Snapshot the current quote as a numbered proposal revision (the negotiation audit trail). Bumps
 *  the pipeline: first issue moves QUALIFYING → PROPOSAL_SENT; re-issuing during PROPOSAL_SENT moves
 *  to NEGOTIATION (a back-and-forth revision). */
const IssueSchema = z.object({
  opportunityId: z.string().min(1),
  label: z.string().max(120).optional(),
  note: z.string().max(1000).optional(),
});
export async function issueProposalAction(input: z.infer<typeof IssueSchema>): Promise<{ error?: string }> {
  const caller = await requirePermission("opportunities:manage");
  const parsed = IssueSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input." };
  const { opportunityId, label, note } = parsed.data;

  const opp = await prisma.opportunity.findFirst({
    where: { id: opportunityId, companyId: caller.companyId },
    include: { lines: { orderBy: { sortOrder: "asc" } }, _count: { select: { revisions: true } } },
  });
  if (!opp) return { error: "Opportunity not found." };
  if (!isOpenStage(opp.stage)) return { error: "Proposals can only be issued while the opportunity is open." };
  if (opp.lines.length === 0) return { error: "Add at least one quote line before issuing a proposal." };

  const lineNums = opp.lines.map((l) => ({ quantityHours: Number(l.quantityHours), unitPrice: Number(l.unitPrice) }));
  const discountValue = opp.discountValue == null ? null : Number(opp.discountValue);
  const totals = computeQuoteTotals(lineNums, opp.discountType, discountValue);

  const snapshot: Prisma.InputJsonValue = opp.lines.map((l) => ({
    name: l.name,
    description: l.description,
    quantityHours: Number(l.quantityHours),
    unitPrice: Number(l.unitPrice),
    billable: l.billable,
  }));

  const nextStage = opp.stage === "QUALIFYING" ? "PROPOSAL_SENT" : opp.stage === "PROPOSAL_SENT" ? "NEGOTIATION" : opp.stage;

  await prisma.$transaction([
    prisma.opportunityRevision.create({
      data: {
        opportunityId: opp.id,
        version: opp._count.revisions + 1,
        label: label ?? null,
        linesSnapshot: snapshot,
        discountType: opp.discountType,
        discountValue: opp.discountValue,
        grossAmount: totals.gross,
        discountAmount: totals.discountAmount,
        netAmount: totals.net,
        note: note ?? null,
        issuedById: caller.id,
      },
    }),
    prisma.opportunity.update({ where: { id: opp.id }, data: { stage: nextStage } }),
  ]);

  revalidatePath(`/opportunities/${opp.id}`);
  revalidatePath("/opportunities");
  return {};
}

/** Manager submits the deal to the admin deal-desk gate. Requires priced lines. */
export async function submitForApprovalAction(opportunityId: string): Promise<{ error?: string }> {
  const caller = await requirePermission("opportunities:manage");
  const opp = await prisma.opportunity.findFirst({
    where: { id: opportunityId, companyId: caller.companyId },
    include: { _count: { select: { lines: true } } },
  });
  if (!opp) return { error: "Opportunity not found." };
  if (!isOpenStage(opp.stage)) return { error: "Only an open opportunity can be submitted for approval." };
  if (opp._count.lines === 0) return { error: "Add at least one quote line before submitting for approval." };

  await prisma.opportunity.update({
    where: { id: opp.id },
    data: { stage: "PENDING_APPROVAL", submittedById: caller.id, submittedAt: new Date() },
  });
  revalidatePath(`/opportunities/${opp.id}`);
  revalidatePath("/opportunities");
  return {};
}

/** Pull a deal back out of the approval queue to keep negotiating. */
export async function recallSubmissionAction(opportunityId: string): Promise<{ error?: string }> {
  const caller = await requirePermission("opportunities:manage");
  const opp = await prisma.opportunity.findFirst({ where: { id: opportunityId, companyId: caller.companyId } });
  if (!opp) return { error: "Opportunity not found." };
  if (opp.stage !== "PENDING_APPROVAL") return { error: "Only a pending opportunity can be recalled." };
  await prisma.opportunity.update({
    where: { id: opp.id },
    data: { stage: "NEGOTIATION", submittedById: null, submittedAt: null },
  });
  revalidatePath(`/opportunities/${opp.id}`);
  revalidatePath("/opportunities");
  return {};
}

const LostSchema = z.object({ opportunityId: z.string().min(1), lostReason: z.string().max(500).optional() });
export async function markLostAction(input: z.infer<typeof LostSchema>): Promise<{ error?: string }> {
  const caller = await requirePermission("opportunities:manage");
  const parsed = LostSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input." };
  const { opportunityId, lostReason } = parsed.data;
  const opp = await prisma.opportunity.findFirst({ where: { id: opportunityId, companyId: caller.companyId } });
  if (!opp) return { error: "Opportunity not found." };
  if (opp.stage === "WON") return { error: "A won opportunity can't be marked lost." };
  await prisma.opportunity.update({ where: { id: opp.id }, data: { stage: "LOST", lostReason: lostReason ?? null } });
  revalidatePath(`/opportunities/${opp.id}`);
  revalidatePath("/opportunities");
  return {};
}

// ---------- admin decision: approve (convert to project) or reject ----------

const DecideSchema = z.object({
  opportunityId: z.string().min(1),
  decision: z.enum(["APPROVE", "REJECT"]),
  comment: z.string().max(500).optional(),
});
export type DecideOpportunityInput = z.infer<typeof DecideSchema>;

/** Admin-only deal-desk decision. REJECT bounces back to NEGOTIATION with a comment. APPROVE
 *  converts the opportunity into a delivery Project in a single transaction: one Milestone per quote
 *  line (list unit price → Milestone.salesPrice, hours → budgetHours), the negotiated discount +
 *  net contract value copied onto the Project, and SoW/PO carried over. Returns the new projectId so
 *  the caller can navigate to it. */
export async function decideOpportunityAction(
  input: DecideOpportunityInput,
): Promise<{ error?: string; projectId?: string }> {
  const caller = await requirePermission("opportunities:approve");
  const parsed = DecideSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input." };
  const { opportunityId, decision, comment } = parsed.data;

  const opp = await prisma.opportunity.findFirst({
    where: { id: opportunityId, companyId: caller.companyId },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!opp) return { error: "Opportunity not found." };
  if (opp.stage !== "PENDING_APPROVAL") return { error: "This opportunity isn't awaiting approval." };

  if (decision === "REJECT") {
    await prisma.opportunity.update({
      where: { id: opp.id },
      data: { stage: "NEGOTIATION", decidedById: caller.id, decidedAt: new Date(), decisionComment: comment ?? null },
    });
    revalidatePath(`/opportunities/${opp.id}`);
    revalidatePath("/opportunities");
    return {};
  }

  // APPROVE → convert.
  if (opp.lines.length === 0) return { error: "Cannot convert an opportunity with no quote lines." };

  const owner = await prisma.user.findUnique({ where: { id: opp.ownerId }, select: { role: true } });
  const managerId = owner?.role === "PM" ? opp.ownerId : null;

  const lineNums = opp.lines.map((l) => ({ quantityHours: Number(l.quantityHours), unitPrice: Number(l.unitPrice) }));
  const discountValue = opp.discountValue == null ? null : Number(opp.discountValue);
  const totals = computeQuoteTotals(lineNums, opp.discountType, discountValue);
  const totalHours = lineNums.reduce((s, l) => s + l.quantityHours, 0);

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        companyId: opp.companyId,
        clientId: opp.clientId,
        name: opp.name,
        number: await nextProjectNumber(opp.companyId, tx),
        status: "PLANNED",
        billingType: opp.billingType,
        budgetAmount: totals.net,
        budgetHours: totalHours,
        managerId,
        discountType: opp.discountType,
        discountValue: opp.discountValue,
        contractValue: totals.net,
        sowNumber: opp.sowNumber,
        poNumber: opp.poNumber,
      },
    });

    for (const line of opp.lines) {
      // Milestone salesPrice semantics differ by billing type (see schema): a per-hour LIST rate for
      // T&M/RETAINER, but a lump sum for FIXED_PRICE. The quote line always carries hours × unit price,
      // so for fixed price the milestone's lump sum is the line TOTAL, not the unit rate.
      const salesPrice =
        opp.billingType === "FIXED_PRICE" ? Number(line.quantityHours) * Number(line.unitPrice) : line.unitPrice;
      await tx.milestone.create({
        data: {
          projectId: created.id,
          name: line.name,
          description: line.description ?? undefined,
          billable: line.billable,
          salesPrice, // list figure — the negotiated discount stays at project level
          cost: 0,
          budgetHours: line.quantityHours,
          status: "PLANNED",
        },
      });
    }

    await applyPlaybookToProject(opp.companyId, created.id, created.startDate, tx);

    await tx.opportunity.update({
      where: { id: opp.id },
      data: {
        stage: "WON",
        projectId: created.id,
        decidedById: caller.id,
        decidedAt: new Date(),
        decisionComment: comment ?? null,
      },
    });

    return created;
  });

  revalidatePath(`/opportunities/${opp.id}`);
  revalidatePath("/opportunities");
  revalidatePath("/projects");
  return { projectId: project.id };
}

// ---------- amendments (change-orders on a won deal) ----------

const AmendmentLineSchema = z.object({
  name: z.string().min(1, "Line name is required.").max(200),
  quantityHours: z.coerce.number().positive("Hours must be greater than 0."),
  unitPrice: z.coerce.number().min(0, "Rate can't be negative."),
  billable: z.boolean().default(true),
  // "NEW" → create a new milestone for this line; otherwise an existing milestoneId on the
  // project whose budget hours (and, for fixed price, lump sum) get grown.
  target: z.string().min(1),
});

const AmendmentSchema = z.object({
  opportunityId: z.string().min(1),
  reference: z.string().max(100).optional(),
  poNumber: z.string().max(100).optional(),
  signedDate: z.string().optional(),
  note: z.string().max(1000).optional(),
  lines: z.array(AmendmentLineSchema).min(1, "Add at least one amendment line."),
});

export type CreateAmendmentInput = z.infer<typeof AmendmentSchema>;

/** Applies a contract amendment / change-order to an already-WON opportunity: for each line it
 *  either creates a new milestone on the linked project (default) or grows an existing one's budget
 *  hours (+ lump sum for fixed price), then bumps the project's contractValue / budgetAmount /
 *  budgetHours and writes an immutable OpportunityAmendment audit row. Admin-only (it changes the
 *  contract value), mirroring the deal-desk approval gate. Amendments carry no deal-level discount —
 *  net added = Σ hours × rate. */
export async function createAmendmentAction(input: CreateAmendmentInput): Promise<{ error?: string }> {
  const caller = await requirePermission("opportunities:approve");
  const parsed = AmendmentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const signedDate = parseOptionalDate(data.signedDate);
  if (signedDate === "invalid") return { error: "Invalid signed date." };

  const opp = await prisma.opportunity.findFirst({
    where: { id: data.opportunityId, companyId: caller.companyId },
    include: {
      project: { include: { milestones: { select: { id: true } } } },
      _count: { select: { amendments: true } },
    },
  });
  if (!opp) return { error: "Opportunity not found." };
  if (opp.stage !== "WON" || !opp.projectId || !opp.project) {
    return { error: "Amendments can only be added to a won opportunity that has a project." };
  }
  const project = opp.project;

  const milestoneIds = new Set(project.milestones.map((m) => m.id));
  for (const line of data.lines) {
    if (line.target !== "NEW" && !milestoneIds.has(line.target)) {
      return { error: "A line targets a milestone that isn't on this project." };
    }
  }

  const isFixedPrice = opp.billingType === "FIXED_PRICE";
  const addedHours = data.lines.reduce((s, l) => s + l.quantityHours, 0);
  const netAmount = computeQuoteTotals(
    data.lines.map((l) => ({ quantityHours: l.quantityHours, unitPrice: l.unitPrice })),
    null,
    null,
  ).net;

  await prisma.$transaction(async (tx) => {
    const version = opp._count.amendments + 1;
    const snapshot: Prisma.InputJsonValue = [];

    for (const line of data.lines) {
      const lineTotal = line.quantityHours * line.unitPrice;
      let createdMilestoneId: string | null = null;

      if (line.target === "NEW") {
        // Same FP-vs-T&M salesPrice split as the original conversion: lump sum for fixed price,
        // per-hour list rate otherwise.
        const salesPrice = isFixedPrice ? lineTotal : line.unitPrice;
        const created = await tx.milestone.create({
          data: {
            projectId: project.id,
            name: line.name,
            billable: line.billable,
            salesPrice,
            cost: 0,
            budgetHours: line.quantityHours,
            status: "PLANNED",
          },
        });
        createdMilestoneId = created.id;
      } else {
        const existing = await tx.milestone.findUniqueOrThrow({ where: { id: line.target } });
        const updateData: Prisma.MilestoneUpdateInput = {
          budgetHours: Number(existing.budgetHours ?? 0) + line.quantityHours,
        };
        // For fixed price the milestone salesPrice is a lump sum, so grow it; for T&M/RETAINER it's
        // a per-hour rate that stays as-is (the added hours simply bill at the existing rate).
        if (isFixedPrice) updateData.salesPrice = Number(existing.salesPrice) + lineTotal;
        await tx.milestone.update({ where: { id: line.target }, data: updateData });
      }

      (snapshot as Prisma.JsonArray).push({
        name: line.name,
        quantityHours: line.quantityHours,
        unitPrice: line.unitPrice,
        billable: line.billable,
        target: line.target,
        createdMilestoneId,
      });
    }

    await tx.project.update({
      where: { id: project.id },
      data: {
        contractValue: Number(project.contractValue ?? 0) + netAmount,
        budgetAmount: Number(project.budgetAmount ?? 0) + netAmount,
        budgetHours: Number(project.budgetHours ?? 0) + addedHours,
      },
    });

    await tx.opportunityAmendment.create({
      data: {
        opportunityId: opp.id,
        projectId: project.id,
        version,
        reference: data.reference?.trim() || null,
        poNumber: data.poNumber?.trim() || null,
        signedDate: signedDate ?? null,
        note: data.note?.trim() || null,
        linesSnapshot: snapshot,
        addedHours,
        netAmount,
        appliedById: caller.id,
      },
    });
  });

  revalidatePath(`/opportunities/${opp.id}`);
  revalidatePath(`/projects/${opp.projectId}`);
  revalidatePath("/projects");
  revalidatePath("/revenue");
  return {};
}

// ---------- documents (SoW / PO / other) ----------

const OPP_DOC_KINDS = ["SOW", "PO", "OTHER"] as const;
type OppDocKind = (typeof OPP_DOC_KINDS)[number];

export async function uploadOpportunityDocumentAction(opportunityId: string, formData: FormData): Promise<{ error?: string }> {
  const caller = await requirePermission("opportunities:manage");
  const opp = await prisma.opportunity.findFirst({ where: { id: opportunityId, companyId: caller.companyId }, select: { id: true } });
  if (!opp) return { error: "Opportunity not found." };

  const kind = String(formData.get("kind") ?? "");
  if (!OPP_DOC_KINDS.includes(kind as OppDocKind)) return { error: "Invalid document type." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Pick a file to upload." };
  if (file.size > MAX_RECEIPT_SIZE_BYTES) return { error: `File is too large (max ${MAX_RECEIPT_SIZE_BYTES / 1024 / 1024}MB).` };
  if (!isAllowedReceiptType(file.type)) return { error: "Unsupported file type — use a PDF or an image (JPG/PNG/WEBP)." };

  const saved = await saveReceiptFile(file, "documents");
  await prisma.document.create({
    data: { companyId: caller.companyId, kind: kind as OppDocKind, opportunityId, uploadedById: caller.id, ...saved },
  });
  revalidatePath(`/opportunities/${opportunityId}`);
  return {};
}

export async function deleteOpportunityDocumentAction(documentId: string): Promise<{ error?: string }> {
  const caller = await requirePermission("opportunities:manage");
  const doc = await prisma.document.findFirst({ where: { id: documentId, companyId: caller.companyId, opportunityId: { not: null } } });
  if (!doc) return { error: "Document not found." };
  await prisma.document.delete({ where: { id: doc.id } });
  await deleteReceiptFile(doc.fileName, "documents");
  if (doc.opportunityId) revalidatePath(`/opportunities/${doc.opportunityId}`);
  return {};
}
