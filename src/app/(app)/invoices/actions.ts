"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

async function nextInvoiceNumber(companyId: string): Promise<string> {
  const invoiceCount = await prisma.invoice.count({ where: { companyId } });
  return `INV-${String(invoiceCount + 1).padStart(4, "0")}`;
}

const GenerateInvoiceSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  periodStart: z.string().min(1, "Start date is required"),
  periodEnd: z.string().min(1, "End date is required"),
  poNumber: z.string().optional(),
  referenceNumber: z.string().optional(),
});

export async function generateInvoiceAction(_prevState: string | undefined, formData: FormData) {
  const user = await requirePermission("invoices:manage");

  const parsed = GenerateInvoiceSchema.safeParse({
    clientId: formData.get("clientId"),
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
    poNumber: formData.get("poNumber") || undefined,
    referenceNumber: formData.get("referenceNumber") || undefined,
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";
  const { clientId, periodStart, periodEnd, poNumber, referenceNumber } = parsed.data;

  const client = await prisma.client.findFirst({ where: { id: clientId, companyId: user.companyId } });
  if (!client) return "Invalid client.";

  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  if (end < start) return "End date must be after start date.";

  const entries = await prisma.timeEntry.findMany({
    where: {
      invoiceLineId: null,
      date: { gte: start, lte: end },
      timeCard: { status: "APPROVED" },
      milestone: {
        billable: true,
        project: { clientId, companyId: user.companyId, billingType: { in: ["TIME_AND_MATERIALS", "RETAINER"] } },
      },
    },
    include: {
      milestone: true,
    },
  });

  if (entries.length === 0) {
    return "No approved, billable, un-invoiced T&M time found for this client and period.";
  }

  type Group = { milestoneId: string; description: string; hours: number; rate: number; entryIds: string[] };
  const groups = new Map<string, Group>();

  for (const entry of entries) {
    const key = entry.milestoneId;
    const existing = groups.get(key);
    if (existing) {
      existing.hours += Number(entry.hours);
      existing.entryIds.push(entry.id);
    } else {
      groups.set(key, {
        milestoneId: entry.milestoneId,
        description: entry.milestone.name,
        hours: Number(entry.hours),
        rate: Number(entry.milestone.salesPrice),
        entryIds: [entry.id],
      });
    }
  }

  const invoiceNumber = await nextInvoiceNumber(user.companyId);
  const currency = (await prisma.company.findUniqueOrThrow({ where: { id: user.companyId } })).currency;

  const invoiceId = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        companyId: user.companyId,
        clientId,
        invoiceNumber,
        status: "DRAFT",
        periodStart: start,
        periodEnd: end,
        currency,
        poNumber,
        referenceNumber,
      },
    });

    for (const group of groups.values()) {
      const line = await tx.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          milestoneId: group.milestoneId,
          description: group.description,
          quantity: group.hours,
          rate: group.rate,
          amount: group.hours * group.rate,
        },
      });
      await tx.timeEntry.updateMany({
        where: { id: { in: group.entryIds } },
        data: { invoiceLineId: line.id },
      });
    }

    return invoice.id;
  });

  revalidatePath("/invoices");
  redirect(`/invoices/${invoiceId}`);
}

const BillMilestoneSchema = z.object({
  milestoneId: z.string().min(1),
  poNumber: z.string().optional(),
  referenceNumber: z.string().optional(),
});

export async function billFixedPriceMilestoneAction(_prevState: string | undefined, formData: FormData) {
  const user = await requirePermission("invoices:manage");

  const parsed = BillMilestoneSchema.safeParse({
    milestoneId: formData.get("milestoneId"),
    poNumber: formData.get("poNumber") || undefined,
    referenceNumber: formData.get("referenceNumber") || undefined,
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";
  const { milestoneId, poNumber, referenceNumber } = parsed.data;

  const milestone = await prisma.milestone.findFirst({
    where: { id: milestoneId, project: { companyId: user.companyId } },
    include: { project: { include: { client: true } } },
  });
  if (!milestone) return "Milestone not found.";
  if (milestone.project.billingType !== "FIXED_PRICE") return "This milestone's project isn't fixed-price.";
  if (!milestone.billable) return "This milestone is marked non-billable.";
  if (milestone.status === "INVOICED") return "This milestone has already been invoiced.";
  if (milestone.status !== "COMPLETE") return "Mark this milestone COMPLETE before billing it.";

  const invoiceNumber = await nextInvoiceNumber(user.companyId);
  const now = new Date();
  const currency = (await prisma.company.findUniqueOrThrow({ where: { id: user.companyId } })).currency;

  const [invoice] = await prisma.$transaction([
    prisma.invoice.create({
      data: {
        companyId: user.companyId,
        clientId: milestone.project.clientId,
        invoiceNumber,
        status: "DRAFT",
        periodStart: milestone.startDate ?? now,
        periodEnd: milestone.endDate ?? now,
        currency,
        poNumber,
        referenceNumber,
        lines: {
          create: [
            {
              milestoneId: milestone.id,
              description: `${milestone.project.name} — ${milestone.name} (fixed price)`,
              quantity: 1,
              rate: milestone.salesPrice,
              amount: milestone.salesPrice,
            },
          ],
        },
      },
    }),
    prisma.milestone.update({ where: { id: milestone.id }, data: { status: "INVOICED" } }),
  ]);

  revalidatePath("/invoices");
  revalidatePath(`/projects/${milestone.projectId}`);
  revalidatePath(`/projects/${milestone.projectId}/milestones/${milestone.id}`);
  redirect(`/invoices/${invoice.id}`);
}

const UpdateStatusSchema = z.object({
  invoiceId: z.string().min(1),
  status: z.enum(["DRAFT", "SENT", "PAID", "VOID"]),
});

export async function updateInvoiceStatusAction(formData: FormData) {
  const user = await requirePermission("invoices:manage");

  const parsed = UpdateStatusSchema.safeParse({
    invoiceId: formData.get("invoiceId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return;

  await prisma.invoice.update({
    where: { id: parsed.data.invoiceId, companyId: user.companyId },
    data: { status: parsed.data.status },
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${parsed.data.invoiceId}`);
}

const EditInvoiceSchema = z.object({
  invoiceId: z.string().min(1),
  periodStart: z.string().min(1, "Start date is required"),
  periodEnd: z.string().min(1, "End date is required"),
  poNumber: z.string().optional(),
  referenceNumber: z.string().optional(),
});

export async function updateInvoiceAction(_prevState: string | undefined, formData: FormData) {
  const user = await requirePermission("invoices:manage");
  const invoiceId = formData.get("invoiceId");
  if (typeof invoiceId !== "string") return "Missing invoice.";

  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId: user.companyId } });
  if (!invoice) return "Invoice not found.";
  if (invoice.status !== "DRAFT") return "Only draft invoices can be edited.";

  const parsed = EditInvoiceSchema.safeParse({
    invoiceId,
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
    poNumber: formData.get("poNumber") || undefined,
    referenceNumber: formData.get("referenceNumber") || undefined,
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";
  const data = parsed.data;

  const start = new Date(data.periodStart);
  const end = new Date(data.periodEnd);
  if (end < start) return "End date must be after start date.";

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { periodStart: start, periodEnd: end, poNumber: data.poNumber, referenceNumber: data.referenceNumber },
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  redirect(`/invoices/${invoiceId}`);
}

export async function deleteInvoiceAction(invoiceId: string) {
  const user = await requirePermission("invoices:manage");

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, companyId: user.companyId },
    include: { lines: true },
  });
  if (!invoice) throw new Error("Invoice not found.");
  if (invoice.status !== "DRAFT") throw new Error("Only draft invoices can be deleted — void it instead.");

  const lineIds = invoice.lines.map((l) => l.id);
  const milestoneIds = [...new Set(invoice.lines.map((l) => l.milestoneId).filter((id): id is string => !!id))];

  await prisma.$transaction([
    prisma.timeEntry.updateMany({ where: { invoiceLineId: { in: lineIds } }, data: { invoiceLineId: null } }),
    prisma.invoiceLine.deleteMany({ where: { invoiceId } }),
    prisma.invoice.delete({ where: { id: invoiceId } }),
    ...(milestoneIds.length > 0
      ? [prisma.milestone.updateMany({ where: { id: { in: milestoneIds }, status: "INVOICED" }, data: { status: "COMPLETE" } })]
      : []),
  ]);

  revalidatePath("/invoices");
  redirect("/invoices");
}
