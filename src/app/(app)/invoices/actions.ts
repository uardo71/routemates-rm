"use server";

import { revalidatePath } from "next/cache";
import { parseISO } from "date-fns";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { invoiceTotals } from "@/lib/invoice";
import type { InvoiceType } from "@prisma/client";

// ---------- helpers ----------

async function nextInvoiceNumber(companyId: string, type: InvoiceType): Promise<string> {
  const prefix = type === "CREDIT_NOTE" ? "CN" : "INV";
  const count = await prisma.invoice.count({ where: { companyId, type } });
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

function parseDate(value: string | null | undefined): Date | null | "invalid" {
  if (!value) return null;
  const d = parseISO(value);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

// ---------- create (manual / partial / full / milestone / credit note) ----------

const LineSchema = z.object({
  description: z.string().min(1, "Line description is required.").max(300),
  quantity: z.coerce.number(),
  rate: z.coerce.number(),
  milestoneId: z.string().optional().nullable(),
});

const CreateSchema = z.object({
  projectId: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  type: z.enum(["INVOICE", "CREDIT_NOTE"]).default("INVOICE"),
  selfBilled: z.boolean().optional(),
  creditNoteForId: z.string().optional().nullable(),
  currency: z.string().max(10).optional().nullable(),
  issueDate: z.string().min(1),
  recognitionDate: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  vatRate: z.coerce.number().min(0).max(100).optional().nullable(),
  fiscalNumber: z.string().max(100).optional().nullable(),
  fiscalReference: z.string().max(100).optional().nullable(),
  customerReference: z.string().max(100).optional().nullable(),
  poNumber: z.string().max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  lines: z.array(LineSchema).min(1, "Add at least one line."),
});
export type CreateInvoiceInput = z.infer<typeof CreateSchema>;

export async function createInvoiceAction(input: CreateInvoiceInput): Promise<{ error?: string; invoiceId?: string }> {
  const user = await requirePermission("invoices:manage");
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  // Resolve client via the project when given.
  let clientId = d.clientId ?? null;
  let currency = d.currency ?? null;
  if (d.projectId) {
    const project = await prisma.project.findFirst({ where: { id: d.projectId, companyId: user.companyId }, include: { company: true } });
    if (!project) return { error: "Invalid project." };
    clientId = project.clientId;
    currency = currency ?? project.company.currency;
  }
  if (!clientId) return { error: "Pick a project or client." };
  const client = await prisma.client.findFirst({ where: { id: clientId, companyId: user.companyId } });
  if (!client) return { error: "Invalid client." };
  if (!currency) currency = (await prisma.company.findUnique({ where: { id: user.companyId }, select: { currency: true } }))?.currency ?? "USD";

  if (d.creditNoteForId) {
    const orig = await prisma.invoice.findFirst({ where: { id: d.creditNoteForId, companyId: user.companyId } });
    if (!orig) return { error: "The invoice this credit note adjusts was not found." };
  }

  const issueDate = parseDate(d.issueDate);
  if (issueDate === "invalid" || !issueDate) return { error: "Invalid issue date." };
  const recognitionDate = parseDate(d.recognitionDate);
  if (recognitionDate === "invalid") return { error: "Invalid recognition date." };
  const dueDate = parseDate(d.dueDate);
  if (dueDate === "invalid") return { error: "Invalid due date." };

  const invoiceNumber = await nextInvoiceNumber(user.companyId, d.type);

  const invoice = await prisma.invoice.create({
    data: {
      companyId: user.companyId,
      clientId,
      projectId: d.projectId ?? null,
      invoiceNumber,
      type: d.type,
      status: "DRAFT",
      selfBilled: d.selfBilled ?? false,
      creditNoteForId: d.creditNoteForId ?? null,
      issueDate,
      recognitionDate: recognitionDate ?? null,
      dueDate: dueDate ?? null,
      currency,
      vatRate: d.vatRate ?? null,
      fiscalNumber: d.fiscalNumber ?? null,
      fiscalReference: d.fiscalReference ?? null,
      customerReference: d.customerReference ?? null,
      poNumber: d.poNumber ?? null,
      notes: d.notes ?? null,
      lines: {
        create: d.lines.map((l) => ({
          milestoneId: l.milestoneId ?? null,
          description: l.description,
          quantity: l.quantity,
          rate: l.rate,
          amount: Math.round(l.quantity * l.rate * 100) / 100,
        })),
      },
    },
  });

  revalidatePath("/invoices");
  return { invoiceId: invoice.id };
}

// ---------- create from approved time entries (T&M / Retainer) ----------

const TimeSchema = z.object({
  projectId: z.string().min(1),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  vatRate: z.coerce.number().min(0).max(100).optional().nullable(),
});
export type CreateTimeInvoiceInput = z.infer<typeof TimeSchema>;

export async function createTimeInvoiceAction(input: CreateTimeInvoiceInput): Promise<{ error?: string; invoiceId?: string }> {
  const user = await requirePermission("invoices:manage");
  const parsed = TimeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const project = await prisma.project.findFirst({ where: { id: d.projectId, companyId: user.companyId }, include: { company: true } });
  if (!project) return { error: "Invalid project." };
  if (project.billingType === "FIXED_PRICE") return { error: "Fixed-price projects are billed by amount/milestone, not by time." };

  const start = parseDate(d.periodStart);
  const end = parseDate(d.periodEnd);
  if (start === "invalid" || end === "invalid" || !start || !end) return { error: "Invalid period." };
  if (end < start) return { error: "End date must be after start date." };

  const entries = await prisma.timeEntry.findMany({
    where: {
      invoiceLineId: null,
      date: { gte: start, lte: end },
      timeCard: { status: "APPROVED" },
      milestone: { billable: true, projectId: project.id },
    },
    include: { milestone: true },
  });
  if (entries.length === 0) return { error: "No approved, billable, un-invoiced time found for this project and period." };

  type Group = { milestoneId: string; description: string; hours: number; rate: number; entryIds: string[] };
  const groups = new Map<string, Group>();
  for (const e of entries) {
    const g = groups.get(e.milestoneId);
    if (g) {
      g.hours += Number(e.hours);
      g.entryIds.push(e.id);
    } else {
      groups.set(e.milestoneId, { milestoneId: e.milestoneId, description: e.milestone.name, hours: Number(e.hours), rate: Number(e.milestone.salesPrice), entryIds: [e.id] });
    }
  }

  const invoiceNumber = await nextInvoiceNumber(user.companyId, "INVOICE");

  const invoiceId = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        companyId: user.companyId,
        clientId: project.clientId,
        projectId: project.id,
        invoiceNumber,
        type: "INVOICE",
        status: "DRAFT",
        issueDate: new Date(),
        periodStart: start,
        periodEnd: end,
        currency: project.company.currency,
        vatRate: d.vatRate ?? null,
      },
    });
    for (const g of groups.values()) {
      const line = await tx.invoiceLine.create({
        data: { invoiceId: invoice.id, milestoneId: g.milestoneId, description: g.description, quantity: g.hours, rate: g.rate, amount: Math.round(g.hours * g.rate * 100) / 100 },
      });
      await tx.timeEntry.updateMany({ where: { id: { in: g.entryIds } }, data: { invoiceLineId: line.id } });
    }
    return invoice.id;
  });

  revalidatePath("/invoices");
  revalidatePath(`/projects/${project.id}`);
  return { invoiceId };
}

// ---------- lifecycle: issue / reconcile / void ----------

export async function issueInvoiceAction(invoiceId: string): Promise<{ error?: string }> {
  const user = await requirePermission("invoices:manage");
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId: user.companyId }, include: { _count: { select: { lines: true } } } });
  if (!inv) return { error: "Invoice not found." };
  if (inv.status !== "DRAFT") return { error: "Only a draft can be issued." };
  if (inv._count.lines === 0) return { error: "Add at least one line before issuing." };
  await prisma.invoice.update({ where: { id: inv.id }, data: { status: "ISSUED", issuedAt: new Date(), recognitionDate: inv.recognitionDate ?? inv.issueDate } });
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${inv.id}`);
  if (inv.projectId) revalidatePath(`/projects/${inv.projectId}`);
  return {};
}

const ReconcileSchema = z.object({
  invoiceId: z.string().min(1),
  fiscalNumber: z.string().min(1, "The fiscal app's invoice number is required to reconcile.").max(100),
  fiscalReference: z.string().max(100).optional().nullable(),
  customerReference: z.string().max(100).optional().nullable(),
});
export type ReconcileInput = z.infer<typeof ReconcileSchema>;

export async function reconcileInvoiceAction(input: ReconcileInput): Promise<{ error?: string }> {
  const user = await requirePermission("invoices:manage");
  const parsed = ReconcileSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;
  const inv = await prisma.invoice.findFirst({ where: { id: d.invoiceId, companyId: user.companyId } });
  if (!inv) return { error: "Invoice not found." };
  if (inv.status === "DRAFT") return { error: "Issue the invoice before reconciling it." };
  if (inv.status === "VOID") return { error: "This invoice is void." };
  await prisma.invoice.update({
    where: { id: inv.id },
    data: {
      fiscalNumber: d.fiscalNumber,
      fiscalReference: d.fiscalReference ?? null,
      customerReference: d.customerReference ?? inv.customerReference,
      reconciledAt: new Date(),
      // Keep PAID if already paid; otherwise mark RECONCILED.
      status: inv.status === "PAID" ? "PAID" : "RECONCILED",
    },
  });
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${inv.id}`);
  return {};
}

export async function voidInvoiceAction(invoiceId: string): Promise<{ error?: string }> {
  const user = await requirePermission("invoices:manage");
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId: user.companyId }, include: { lines: true } });
  if (!inv) return { error: "Invoice not found." };
  if (inv.status === "VOID") return { error: "Already void." };
  const lineIds = inv.lines.map((l) => l.id);
  await prisma.$transaction([
    prisma.timeEntry.updateMany({ where: { invoiceLineId: { in: lineIds } }, data: { invoiceLineId: null } }),
    prisma.invoice.update({ where: { id: inv.id }, data: { status: "VOID" } }),
  ]);
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${inv.id}`);
  if (inv.projectId) revalidatePath(`/projects/${inv.projectId}`);
  return {};
}

// ---------- payments ----------

const PaymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.coerce.number(),
  date: z.string().min(1),
  method: z.string().max(50).optional().nullable(),
  reference: z.string().max(100).optional().nullable(),
});
export type PaymentInput = z.infer<typeof PaymentSchema>;

export async function recordPaymentAction(input: PaymentInput): Promise<{ error?: string }> {
  const user = await requirePermission("invoices:manage");
  const parsed = PaymentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;
  if (d.amount === 0) return { error: "Payment amount can't be zero." };
  const date = parseDate(d.date);
  if (date === "invalid" || !date) return { error: "Invalid payment date." };

  const inv = await prisma.invoice.findFirst({ where: { id: d.invoiceId, companyId: user.companyId }, include: { lines: true, payments: true } });
  if (!inv) return { error: "Invoice not found." };
  if (inv.status === "DRAFT" || inv.status === "VOID") return { error: "Issue the invoice before recording payments." };

  const gross = invoiceTotals(inv.lines.map((l) => ({ amount: Number(l.amount) })), inv.vatRate == null ? null : Number(inv.vatRate)).gross;
  const paidSoFar = inv.payments.reduce((s, p) => s + Number(p.amount), 0) + d.amount;

  await prisma.$transaction([
    prisma.invoicePayment.create({ data: { invoiceId: inv.id, amount: d.amount, date, method: d.method ?? null, reference: d.reference ?? null } }),
    ...(paidSoFar >= gross ? [prisma.invoice.update({ where: { id: inv.id }, data: { status: "PAID" } })] : []),
  ]);
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${inv.id}`);
  return {};
}

export async function deletePaymentAction(paymentId: string): Promise<{ error?: string }> {
  const user = await requirePermission("invoices:manage");
  const payment = await prisma.invoicePayment.findFirst({ where: { id: paymentId, invoice: { companyId: user.companyId } }, include: { invoice: { include: { lines: true, payments: true } } } });
  if (!payment) return { error: "Payment not found." };
  const inv = payment.invoice;
  const gross = invoiceTotals(inv.lines.map((l) => ({ amount: Number(l.amount) })), inv.vatRate == null ? null : Number(inv.vatRate)).gross;
  const remainingPaid = inv.payments.filter((p) => p.id !== paymentId).reduce((s, p) => s + Number(p.amount), 0);
  await prisma.$transaction([
    prisma.invoicePayment.delete({ where: { id: paymentId } }),
    // If it was marked PAID but no longer fully covered, fall back to RECONCILED/ISSUED.
    ...(inv.status === "PAID" && remainingPaid < gross
      ? [prisma.invoice.update({ where: { id: inv.id }, data: { status: inv.reconciledAt ? "RECONCILED" : "ISSUED" } })]
      : []),
  ]);
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${inv.id}`);
  return {};
}

// ---------- edit (metadata; lines only while DRAFT) ----------

const UpdateSchema = z.object({
  invoiceId: z.string().min(1),
  issueDate: z.string().min(1),
  recognitionDate: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  vatRate: z.coerce.number().min(0).max(100).optional().nullable(),
  selfBilled: z.boolean().optional(),
  fiscalNumber: z.string().max(100).optional().nullable(),
  fiscalReference: z.string().max(100).optional().nullable(),
  customerReference: z.string().max(100).optional().nullable(),
  poNumber: z.string().max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  lines: z.array(LineSchema).optional(),
});
export type UpdateInvoiceInput = z.infer<typeof UpdateSchema>;

export async function updateInvoiceAction(input: UpdateInvoiceInput): Promise<{ error?: string }> {
  const user = await requirePermission("invoices:manage");
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;
  const inv = await prisma.invoice.findFirst({ where: { id: d.invoiceId, companyId: user.companyId }, include: { lines: true } });
  if (!inv) return { error: "Invoice not found." };
  if (inv.status === "VOID") return { error: "A void invoice can't be edited." };

  const issueDate = parseDate(d.issueDate);
  if (issueDate === "invalid" || !issueDate) return { error: "Invalid issue date." };
  const recognitionDate = parseDate(d.recognitionDate);
  if (recognitionDate === "invalid") return { error: "Invalid recognition date." };
  const dueDate = parseDate(d.dueDate);
  if (dueDate === "invalid") return { error: "Invalid due date." };

  const replaceLines = d.lines && inv.status === "DRAFT";
  if (d.lines && inv.status !== "DRAFT") return { error: "Lines can only be edited while the invoice is a draft." };

  await prisma.$transaction(async (tx) => {
    if (replaceLines && d.lines) {
      const oldLineIds = inv.lines.map((l) => l.id);
      await tx.timeEntry.updateMany({ where: { invoiceLineId: { in: oldLineIds } }, data: { invoiceLineId: null } });
      await tx.invoiceLine.deleteMany({ where: { invoiceId: inv.id } });
      for (const l of d.lines) {
        await tx.invoiceLine.create({ data: { invoiceId: inv.id, milestoneId: l.milestoneId ?? null, description: l.description, quantity: l.quantity, rate: l.rate, amount: Math.round(l.quantity * l.rate * 100) / 100 } });
      }
    }
    await tx.invoice.update({
      where: { id: inv.id },
      data: {
        issueDate,
        recognitionDate: recognitionDate ?? null,
        dueDate: dueDate ?? null,
        vatRate: d.vatRate ?? null,
        selfBilled: d.selfBilled ?? inv.selfBilled,
        fiscalNumber: d.fiscalNumber ?? null,
        fiscalReference: d.fiscalReference ?? null,
        customerReference: d.customerReference ?? null,
        poNumber: d.poNumber ?? null,
        notes: d.notes ?? null,
      },
    });
  });
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${inv.id}`);
  return {};
}

export async function deleteInvoiceAction(invoiceId: string): Promise<{ error?: string }> {
  const user = await requirePermission("invoices:manage");
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId: user.companyId }, include: { lines: true } });
  if (!inv) return { error: "Invoice not found." };
  if (inv.status !== "DRAFT") return { error: "Only a draft can be deleted — void it instead." };
  const lineIds = inv.lines.map((l) => l.id);
  await prisma.$transaction([
    prisma.timeEntry.updateMany({ where: { invoiceLineId: { in: lineIds } }, data: { invoiceLineId: null } }),
    prisma.invoicePayment.deleteMany({ where: { invoiceId: inv.id } }),
    prisma.invoiceLine.deleteMany({ where: { invoiceId: inv.id } }),
    prisma.invoice.delete({ where: { id: inv.id } }),
  ]);
  revalidatePath("/invoices");
  return {};
}
