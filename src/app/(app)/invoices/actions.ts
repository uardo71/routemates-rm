"use server";

import { revalidatePath } from "next/cache";
import { parseISO } from "date-fns";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { invoiceTotals, effectiveDueDate } from "@/lib/invoice";
import { recordAudit } from "@/lib/audit";
import { MAX_RECEIPT_SIZE_BYTES, isAllowedReceiptType, saveReceiptFile, deleteReceiptFile } from "@/lib/receipt-storage";
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

// The optional sales-commission discount is stored as a single negative line with this exact
// description (owner's required wording). Kept as a plain line so it flows through every total
// (net/VAT/gross), the register, and revenue recognition without special-casing.
const COMMISSION_DESC = "Sales comision";

// ---------- create (manual / partial / full / milestone / credit note) ----------

const LineSchema = z.object({
  description: z.string().min(1, "Line description is required.").max(300),
  quantity: z.coerce.number(),
  rate: z.coerce.number(),
  milestoneId: z.string().optional().nullable(),
});

// Update variant carries the existing line's id so we can diff in place: a line with a known
// id is edited (keeping its linked time entries), a line without one is created, and any
// existing line missing from the payload is deleted (releasing its time entries).
const UpdateLineSchema = LineSchema.extend({
  id: z.string().optional().nullable(),
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
  // Service period ("date of service" — which month the work relates to). Optional; stored on the
  // invoice and shown on the register. Parsed at UTC midnight (see createInvoiceFromTime).
  periodStart: z.string().optional().nullable(),
  periodEnd: z.string().optional().nullable(),
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
  // No explicit due date → default it from the client's standard payment terms (net N). Clients with
  // no agreed terms keep a null due date; AR ages those into their own bucket rather than guessing.
  const resolvedDueDate = effectiveDueDate(dueDate ?? null, issueDate ?? new Date(), client.paymentTermsDays);
  // Service period stored at UTC midnight so its month reads correctly regardless of timezone.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  const periodStart = d.periodStart && dateOnly.test(d.periodStart) ? new Date(`${d.periodStart}T00:00:00.000Z`) : null;
  const periodEnd = d.periodEnd && dateOnly.test(d.periodEnd) ? new Date(`${d.periodEnd}T00:00:00.000Z`) : null;

  const invoiceNumber = await nextInvoiceNumber(user.companyId, d.type);

  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
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
      dueDate: resolvedDueDate,
      periodStart,
      periodEnd,
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
    include: { lines: true },
    });
    await recordAudit(tx, { entityType: "Invoice", entityId: created.id, action: "create", actor: user, after: created, label: created.invoiceNumber });
    for (const line of created.lines) {
      await recordAudit(tx, { entityType: "InvoiceLine", entityId: line.id, action: "create", actor: user, after: line, label: line.description, parent: { entityType: "Invoice", entityId: created.id } });
    }
    return created;
  });

  // Reconcile the typed line quantities against approved time so manually-created invoices don't
  // leave their hours looking unbilled.
  await linkTimeEntriesToInvoice(invoice.id);

  revalidatePath("/invoices");
  return { invoiceId: invoice.id };
}

/** Attach approved time entries to a manually-created invoice's lines.
 *
 *  Only `createTimeInvoiceAction` used to set `invoiceLineId`, so an invoice typed by hand left its
 *  time entries looking untouched — and the same hours were then counted a second time as "still to
 *  bill". This reconciles them: for a time-billed project whose invoice carries a service period, it
 *  walks each line's quantity (hours) and claims unlinked approved entries in that period, oldest
 *  first, never exceeding the line's quantity.
 *
 *  Deliberately conservative: an entry is only claimed if it fits whole inside the remaining
 *  quantity, entries are never split, and anything already linked is left alone. Returns how many
 *  entries were linked. Best-effort — a mismatch just leaves entries unlinked rather than failing
 *  the invoice. */
async function linkTimeEntriesToInvoice(invoiceId: string): Promise<number> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true, projectId: true, periodStart: true, periodEnd: true, type: true,
      project: { select: { billingType: true } },
      lines: { select: { id: true, description: true, quantity: true, milestoneId: true }, orderBy: { id: "asc" } },
    },
  });
  if (!inv || inv.type === "CREDIT_NOTE") return 0;
  if (!inv.projectId || !inv.periodStart || !inv.periodEnd) return 0;
  // Fixed-price work isn't billed by the hour, so its line quantities aren't hours to match against.
  if (!inv.project || inv.project.billingType === "FIXED_PRICE") return 0;

  // Inclusive end-of-day, matching createInvoiceFromTime's UTC handling.
  const periodEnd = new Date(inv.periodEnd);
  periodEnd.setUTCHours(23, 59, 59, 999);

  const candidates = await prisma.timeEntry.findMany({
    where: {
      invoiceLineId: null,
      timeCard: { status: "APPROVED" },
      date: { gte: inv.periodStart, lte: periodEnd },
      milestone: { billable: true, projectId: inv.projectId },
    },
    select: { id: true, hours: true, milestoneId: true },
    orderBy: { date: "asc" },
  });
  if (candidates.length === 0) return 0;

  const used = new Set<string>();
  let linked = 0;
  for (const line of inv.lines) {
    if (line.description === COMMISSION_DESC) continue;
    let remaining = Number(line.quantity);
    if (!(remaining > 0)) continue;
    const claim: string[] = [];
    for (const e of candidates) {
      if (used.has(e.id)) continue;
      // A line tied to a milestone only claims that milestone's time.
      if (line.milestoneId && e.milestoneId !== line.milestoneId) continue;
      const h = Number(e.hours);
      if (h <= 0 || h > remaining + 0.001) continue;
      claim.push(e.id);
      used.add(e.id);
      remaining -= h;
      if (remaining <= 0.001) break;
    }
    if (claim.length > 0) {
      // Still guarded on invoiceLineId being null, so a concurrent invoice can't lose its claim.
      const r = await prisma.timeEntry.updateMany({
        where: { id: { in: claim }, invoiceLineId: null },
        data: { invoiceLineId: line.id },
      });
      linked += r.count;
    }
  }
  return linked;
}

// ---------- unbilled (WIP) preview for the "from approved time" basis ----------

export type UnbilledPreview = {
  hours: number;
  value: number;
  entries: number;
  /** Age in days of the oldest unbilled entry. */
  oldestAgeDays: number;
  /** Earliest / latest unbilled entry dates (yyyy-MM-dd) — the period that would bill all of it. */
  firstDate: string | null;
  lastDate: string | null;
  milestones: { milestoneId: string; name: string; hours: number; value: number }[];
};

/** What "from approved time" would pull for this project right now, so the user is offered the
 *  unbilled work rather than having to guess a period. Read-only. */
export async function unbilledPreviewAction(projectId: string): Promise<{ error?: string; preview?: UnbilledPreview }> {
  const user = await requirePermission("invoices:manage");
  const project = await prisma.project.findFirst({ where: { id: projectId, companyId: user.companyId }, select: { id: true, billingType: true } });
  if (!project) return { error: "Invalid project." };
  // Fixed-price work isn't billed by the hour — its milestone salesPrice is a lump sum, not a rate.
  // Offering "unbilled time" here would price every hour at the whole contract value.
  if (project.billingType === "FIXED_PRICE") {
    return { preview: { hours: 0, value: 0, entries: 0, oldestAgeDays: 0, firstDate: null, lastDate: null, milestones: [] } };
  }

  const entries = await prisma.timeEntry.findMany({
    where: { invoiceLineId: null, timeCard: { status: "APPROVED" }, milestone: { billable: true, projectId: project.id } },
    select: {
      date: true, hours: true, billRate: true,
      assignment: { select: { billRate: true } },
      milestone: { select: { id: true, name: true, salesPrice: true } },
    },
    orderBy: { date: "asc" },
  });
  if (entries.length === 0) {
    return { preview: { hours: 0, value: 0, entries: 0, oldestAgeDays: 0, firstDate: null, lastDate: null, milestones: [] } };
  }

  const byMs = new Map<string, { milestoneId: string; name: string; hours: number; value: number }>();
  let hours = 0;
  let value = 0;
  for (const e of entries) {
    const h = Number(e.hours);
    const rate = e.billRate != null ? Number(e.billRate) : e.assignment.billRate != null ? Number(e.assignment.billRate) : Number(e.milestone.salesPrice);
    const g = byMs.get(e.milestone.id) ?? { milestoneId: e.milestone.id, name: e.milestone.name, hours: 0, value: 0 };
    g.hours += h;
    g.value += h * rate;
    byMs.set(e.milestone.id, g);
    hours += h;
    value += h * rate;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const first = entries[0].date;
  const last = entries[entries.length - 1].date;
  const todayUtc = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());

  return {
    preview: {
      hours: r2(hours),
      value: r2(value),
      entries: entries.length,
      oldestAgeDays: Math.max(0, Math.floor((todayUtc - first.getTime()) / 86_400_000)),
      firstDate: first.toISOString().slice(0, 10),
      lastDate: last.toISOString().slice(0, 10),
      milestones: [...byMs.values()].map((g) => ({ ...g, hours: r2(g.hours), value: r2(g.value) })).sort((a, b) => b.value - a.value),
    },
  };
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

  // TimeEntry.date is stored at UTC midnight (new Date("yyyy-MM-dd")), so parse the period the same
  // way. parseDate's parseISO uses LOCAL midnight, which in a non-UTC timezone shifts the boundary
  // and silently drops the final day's hours (e.g. a Jul 31 entry at UTC-midnight falls just after a
  // local-midnight Jul 31 period end). `queryEnd` covers the whole last day so it's inclusive.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateOnly.test(d.periodStart) || !dateOnly.test(d.periodEnd)) return { error: "Invalid period." };
  const start = new Date(`${d.periodStart}T00:00:00.000Z`);
  const end = new Date(`${d.periodEnd}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { error: "Invalid period." };
  if (end < start) return { error: "End date must be after start date." };
  const queryEnd = new Date(`${d.periodEnd}T23:59:59.999Z`);

  const invoiceNumber = await nextInvoiceNumber(user.companyId, "INVOICE");

  // Everything — selecting the entries, creating the lines and claiming the entries — happens inside
  // ONE transaction. Each claim is conditional on the entry still being unlinked (invoiceLineId
  // null), and a short count means someone else invoiced it in the meantime → the whole invoice
  // rolls back rather than silently stealing an entry from another invoice.
  let emptyPeriod = false;
  let raced = false;
  const invoiceId = await prisma.$transaction(async (tx) => {
    const entries = await tx.timeEntry.findMany({
      where: {
        invoiceLineId: null,
        date: { gte: start, lte: queryEnd },
        timeCard: { status: "APPROVED" },
        milestone: { billable: true, projectId: project.id },
      },
      include: { milestone: true, assignment: { select: { billRate: true } } },
    });
    if (entries.length === 0) {
      emptyPeriod = true;
      return null;
    }

    // Group by milestone. The line's rate is the BILL rate frozen on each entry at approval (falling
    // back to the assignment snapshot, then the milestone's list rate for legacy entries). Different
    // people on one milestone can carry different bill rates, so the group's rate is the
    // hours-weighted average and `amount` is the exact Σ(hours × rate) — amount is the source of
    // truth for the invoice total; the displayed rate is the average that produced it.
    type Group = { milestoneId: string; description: string; hours: number; value: number; entryIds: string[] };
    const groups = new Map<string, Group>();
    for (const e of entries) {
      const hours = Number(e.hours);
      const rate =
        e.billRate != null ? Number(e.billRate) : e.assignment.billRate != null ? Number(e.assignment.billRate) : Number(e.milestone.salesPrice);
      const g = groups.get(e.milestoneId) ?? { milestoneId: e.milestoneId, description: e.milestone.name, hours: 0, value: 0, entryIds: [] };
      g.hours += hours;
      g.value += hours * rate;
      g.entryIds.push(e.id);
      groups.set(e.milestoneId, g);
    }

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
    await recordAudit(tx, { entityType: "Invoice", entityId: invoice.id, action: "create", actor: user, after: invoice, label: invoiceNumber, note: "from approved time" });
    for (const g of groups.values()) {
      const rate = g.hours > 0 ? Math.round((g.value / g.hours) * 10000) / 10000 : 0;
      const line = await tx.invoiceLine.create({
        data: { invoiceId: invoice.id, milestoneId: g.milestoneId, description: g.description, quantity: g.hours, rate, amount: Math.round(g.value * 100) / 100 },
      });
      await recordAudit(tx, { entityType: "InvoiceLine", entityId: line.id, action: "create", actor: user, after: line, label: line.description, parent: { entityType: "Invoice", entityId: invoice.id } });
      const claimed = await tx.timeEntry.updateMany({
        // `invoiceLineId: null` here is the guard: only still-unbilled entries can be claimed.
        where: { id: { in: g.entryIds }, invoiceLineId: null },
        data: { invoiceLineId: line.id },
      });
      if (claimed.count !== g.entryIds.length) {
        raced = true;
        throw new Error("TIME_ENTRY_RACE");
      }
    }
    return invoice.id;
  }).catch((e) => {
    if (raced) return null;
    throw e;
  });

  if (emptyPeriod) return { error: "No approved, billable, un-invoiced time found for this project and period." };
  if (raced || !invoiceId) {
    return { error: "Some of that time was invoiced by someone else just now — nothing was billed. Reload and try again." };
  }

  revalidatePath("/invoices");
  revalidatePath("/revenue");
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
  await prisma.$transaction(async (tx) => {
    const after = await tx.invoice.update({ where: { id: inv.id }, data: { status: "ISSUED", issuedAt: new Date(), recognitionDate: inv.recognitionDate ?? inv.issueDate } });
    await recordAudit(tx, { entityType: "Invoice", entityId: inv.id, action: "update", actor: user, before: inv, after, label: inv.invoiceNumber });
  });
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
  await prisma.$transaction(async (tx) => {
    const after = await tx.invoice.update({
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
    await recordAudit(tx, { entityType: "Invoice", entityId: inv.id, action: "update", actor: user, before: inv, after, label: inv.invoiceNumber });
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
  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.updateMany({ where: { invoiceLineId: { in: lineIds } }, data: { invoiceLineId: null } });
    const after = await tx.invoice.update({ where: { id: inv.id }, data: { status: "VOID" } });
    await recordAudit(tx, { entityType: "Invoice", entityId: inv.id, action: "update", actor: user, before: inv, after, label: inv.invoiceNumber });
  });
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${inv.id}`);
  if (inv.projectId) revalidatePath(`/projects/${inv.projectId}`);
  return {};
}

// ---------- payments ----------

const PaymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.coerce.number(),
  // Bank charges withheld in transit. The customer parted with amount + bankFee, so that sum is
  // what settles the invoice.
  bankFee: z.coerce.number().min(0).optional().nullable(),
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
  const bankFee = d.bankFee ?? 0;
  const settledSoFar =
    inv.payments.reduce((s, p) => s + Number(p.amount) + Number(p.bankFee), 0) + d.amount + bankFee;

  await prisma.$transaction(async (tx) => {
    const payment = await tx.invoicePayment.create({ data: { invoiceId: inv.id, amount: d.amount, bankFee, date, method: d.method ?? null, reference: d.reference ?? null } });
    await recordAudit(tx, { entityType: "InvoicePayment", entityId: payment.id, action: "create", actor: user, after: payment, label: inv.invoiceNumber, parent: { entityType: "Invoice", entityId: inv.id } });
    if (settledSoFar >= gross) {
      const after = await tx.invoice.update({ where: { id: inv.id }, data: { status: "PAID" } });
      await recordAudit(tx, { entityType: "Invoice", entityId: inv.id, action: "update", actor: user, before: inv, after, fields: ["status"], label: inv.invoiceNumber, note: "fully settled" });
    }
  });
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${inv.id}`);
  return {};
}

const UpdatePaymentSchema = z.object({
  paymentId: z.string().min(1),
  amount: z.coerce.number(),
  // Bank charges withheld in transit. The customer parted with amount + bankFee, so that sum is
  // what settles the invoice.
  bankFee: z.coerce.number().min(0).optional().nullable(),
  date: z.string().min(1),
  method: z.string().max(50).optional().nullable(),
  reference: z.string().max(100).optional().nullable(),
});
export type UpdatePaymentInput = z.infer<typeof UpdatePaymentSchema>;

export async function updatePaymentAction(input: UpdatePaymentInput): Promise<{ error?: string }> {
  const user = await requirePermission("invoices:manage");
  const parsed = UpdatePaymentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;
  if (d.amount === 0) return { error: "Payment amount can't be zero." };
  const date = parseDate(d.date);
  if (date === "invalid" || !date) return { error: "Invalid payment date." };

  const payment = await prisma.invoicePayment.findFirst({
    where: { id: d.paymentId, invoice: { companyId: user.companyId } },
    include: { invoice: { include: { lines: true, payments: true } } },
  });
  if (!payment) return { error: "Payment not found." };
  const inv = payment.invoice;

  const gross = invoiceTotals(inv.lines.map((l) => ({ amount: Number(l.amount) })), inv.vatRate == null ? null : Number(inv.vatRate)).gross;
  const paidAfter =
    inv.payments.filter((p) => p.id !== d.paymentId).reduce((s, p) => s + Number(p.amount) + Number(p.bankFee), 0) +
    d.amount +
    (d.bankFee ?? 0);

  const nextStatus =
    paidAfter >= gross && (inv.status === "ISSUED" || inv.status === "RECONCILED")
      ? "PAID"
      : paidAfter < gross && inv.status === "PAID"
        ? inv.reconciledAt ? "RECONCILED" : "ISSUED"
        : null;

  await prisma.$transaction(async (tx) => {
    const after = await tx.invoicePayment.update({ where: { id: d.paymentId }, data: { amount: d.amount, bankFee: d.bankFee ?? 0, date, method: d.method ?? null, reference: d.reference ?? null } });
    await recordAudit(tx, { entityType: "InvoicePayment", entityId: payment.id, action: "update", actor: user, before: payment, after, label: inv.invoiceNumber, parent: { entityType: "Invoice", entityId: inv.id } });
    if (nextStatus) {
      const invAfter = await tx.invoice.update({ where: { id: inv.id }, data: { status: nextStatus } });
      await recordAudit(tx, { entityType: "Invoice", entityId: inv.id, action: "update", actor: user, before: inv, after: invAfter, fields: ["status"], label: inv.invoiceNumber, note: "payment edited" });
    }
  });
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
  await prisma.$transaction(async (tx) => {
    await tx.invoicePayment.delete({ where: { id: paymentId } });
    await recordAudit(tx, { entityType: "InvoicePayment", entityId: paymentId, action: "delete", actor: user, before: payment, label: inv.invoiceNumber, parent: { entityType: "Invoice", entityId: inv.id } });
    // If it was marked PAID but no longer fully covered, fall back to RECONCILED/ISSUED.
    if (inv.status === "PAID" && remainingPaid < gross) {
      const after = await tx.invoice.update({ where: { id: inv.id }, data: { status: inv.reconciledAt ? "RECONCILED" : "ISSUED" } });
      await recordAudit(tx, { entityType: "Invoice", entityId: inv.id, action: "update", actor: user, before: inv, after, fields: ["status"], label: inv.invoiceNumber, note: "payment removed" });
    }
  });
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
  periodStart: z.string().optional().nullable(),
  periodEnd: z.string().optional().nullable(),
  lines: z.array(UpdateLineSchema).min(1, "Add at least one line.").optional(),
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
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  const periodStart = d.periodStart && dateOnly.test(d.periodStart) ? new Date(`${d.periodStart}T00:00:00.000Z`) : null;
  const periodEnd = d.periodEnd && dateOnly.test(d.periodEnd) ? new Date(`${d.periodEnd}T00:00:00.000Z`) : null;

  const replaceLines = d.lines && inv.status === "DRAFT";
  if (d.lines && inv.status !== "DRAFT") return { error: "Lines can only be edited while the invoice is a draft." };

  await prisma.$transaction(async (tx) => {
    if (replaceLines && d.lines) {
      // Per-line diff (keyed by existing line id) so kept lines retain their linked time
      // entries; only lines actually removed release theirs. A payload id that isn't one of
      // this invoice's lines is treated as a new line (never trusts a foreign id).
      const existingIds = new Set(inv.lines.map((l) => l.id));
      const keptIds = new Set<string>();
      for (const l of d.lines) {
        const amount = Math.round(l.quantity * l.rate * 100) / 100;
        if (l.id && existingIds.has(l.id)) {
          keptIds.add(l.id);
          const lineAfter = await tx.invoiceLine.update({
            where: { id: l.id },
            data: { milestoneId: l.milestoneId ?? null, description: l.description, quantity: l.quantity, rate: l.rate, amount },
          });
          await recordAudit(tx, { entityType: "InvoiceLine", entityId: l.id, action: "update", actor: user, before: inv.lines.find((x) => x.id === l.id), after: lineAfter, label: lineAfter.description, parent: { entityType: "Invoice", entityId: inv.id } });
        } else {
          const lineAfter = await tx.invoiceLine.create({
            data: { invoiceId: inv.id, milestoneId: l.milestoneId ?? null, description: l.description, quantity: l.quantity, rate: l.rate, amount },
          });
          await recordAudit(tx, { entityType: "InvoiceLine", entityId: lineAfter.id, action: "create", actor: user, after: lineAfter, label: lineAfter.description, parent: { entityType: "Invoice", entityId: inv.id } });
        }
      }
      const removedIds = inv.lines.filter((l) => !keptIds.has(l.id)).map((l) => l.id);
      if (removedIds.length > 0) {
        await tx.timeEntry.updateMany({ where: { invoiceLineId: { in: removedIds } }, data: { invoiceLineId: null } });
        await tx.invoiceLine.deleteMany({ where: { id: { in: removedIds } } });
        for (const removed of inv.lines.filter((x) => removedIds.includes(x.id))) {
          await recordAudit(tx, { entityType: "InvoiceLine", entityId: removed.id, action: "delete", actor: user, before: removed, label: removed.description, parent: { entityType: "Invoice", entityId: inv.id } });
        }
      }
    }
    const after = await tx.invoice.update({
      where: { id: inv.id },
      data: {
        issueDate,
        recognitionDate: recognitionDate ?? null,
        dueDate: dueDate ?? null,
        periodStart,
        periodEnd,
        vatRate: d.vatRate ?? null,
        selfBilled: d.selfBilled ?? inv.selfBilled,
        fiscalNumber: d.fiscalNumber ?? null,
        fiscalReference: d.fiscalReference ?? null,
        customerReference: d.customerReference ?? null,
        poNumber: d.poNumber ?? null,
        notes: d.notes ?? null,
      },
    });
    await recordAudit(tx, { entityType: "Invoice", entityId: inv.id, action: "update", actor: user, before: inv, after, label: inv.invoiceNumber });
  });
  // Line quantities may have changed — re-reconcile against approved time. Entries released by a
  // deleted line are already unlinked above, so they become claimable again here.
  await linkTimeEntriesToInvoice(inv.id);

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${inv.id}`);
  return {};
}

// ---------- sales commission (discount) — editable in ANY status, independent of the line editor ----------

const CommissionSchema = z.object({
  invoiceId: z.string().min(1),
  // A percentage of the invoice's line net and/or a flat amount — they combine.
  percent: z.coerce.number().min(0, "Percentage can't be negative.").max(100, "Percentage can't exceed 100.").optional().nullable(),
  fixed: z.coerce.number().min(0, "Amount can't be negative.").max(100_000_000).optional().nullable(),
});
export type SetCommissionInput = z.infer<typeof CommissionSchema>;

// Reconciles the single "Sales comision" line from a percentage of the line net and/or a flat
// amount (discount = net*percent/100 + fixed). Creates/updates the line when the result is > 0,
// removes it when 0, and stores the raw percent/fixed on the invoice so it round-trips on edit.
// Works on issued/reconciled/paid invoices too — the commission is a deal-level discount that can
// be agreed after issuing, so it is deliberately not gated to DRAFT like the work lines.
export async function setInvoiceCommissionAction(input: SetCommissionInput): Promise<{ error?: string }> {
  const user = await requirePermission("invoices:manage");
  const parsed = CommissionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;
  const inv = await prisma.invoice.findFirst({ where: { id: d.invoiceId, companyId: user.companyId }, include: { lines: true } });
  if (!inv) return { error: "Invoice not found." };
  if (inv.status === "VOID") return { error: "A void invoice can't be edited." };

  const percent = d.percent && d.percent > 0 ? Math.round(d.percent * 100) / 100 : 0;
  const fixed = d.fixed && d.fixed > 0 ? Math.round(d.fixed * 100) / 100 : 0;
  // Base = net of the non-commission (work) lines. The percent is taken against that.
  const base = inv.lines.filter((l) => l.description !== COMMISSION_DESC).reduce((s, l) => s + Number(l.amount), 0);
  const amount = Math.round((base * (percent / 100) + fixed) * 100) / 100;
  const existing = inv.lines.find((l) => l.description === COMMISSION_DESC);

  await prisma.$transaction(async (tx) => {
    if (amount > 0) {
      if (existing) {
        const lineAfter = await tx.invoiceLine.update({ where: { id: existing.id }, data: { quantity: 1, rate: -amount, amount: -amount } });
        await recordAudit(tx, { entityType: "InvoiceLine", entityId: existing.id, action: "update", actor: user, before: existing, after: lineAfter, label: COMMISSION_DESC, parent: { entityType: "Invoice", entityId: inv.id } });
      } else {
        const lineAfter = await tx.invoiceLine.create({ data: { invoiceId: inv.id, milestoneId: null, description: COMMISSION_DESC, quantity: 1, rate: -amount, amount: -amount } });
        await recordAudit(tx, { entityType: "InvoiceLine", entityId: lineAfter.id, action: "create", actor: user, after: lineAfter, label: COMMISSION_DESC, parent: { entityType: "Invoice", entityId: inv.id } });
      }
    } else if (existing) {
      await tx.invoiceLine.delete({ where: { id: existing.id } });
      await recordAudit(tx, { entityType: "InvoiceLine", entityId: existing.id, action: "delete", actor: user, before: existing, label: COMMISSION_DESC, parent: { entityType: "Invoice", entityId: inv.id } });
    }
    const after = await tx.invoice.update({
      where: { id: inv.id },
      data: { commissionPercent: percent > 0 ? percent : null, commissionFixed: fixed > 0 ? fixed : null },
    });
    await recordAudit(tx, { entityType: "Invoice", entityId: inv.id, action: "update", actor: user, before: inv, after, fields: ["commissionPercent", "commissionFixed"], label: inv.invoiceNumber });
  });
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${inv.id}`);
  if (inv.projectId) revalidatePath(`/projects/${inv.projectId}`);
  return {};
}

export async function deleteInvoiceAction(invoiceId: string): Promise<{ error?: string }> {
  const user = await requirePermission("invoices:manage");
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId: user.companyId }, include: { lines: true, documents: true } });
  if (!inv) return { error: "Invoice not found." };
  if (inv.status !== "DRAFT") return { error: "Only a draft can be deleted — void it instead." };
  const lineIds = inv.lines.map((l) => l.id);
  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.updateMany({ where: { invoiceLineId: { in: lineIds } }, data: { invoiceLineId: null } });
    await tx.invoicePayment.deleteMany({ where: { invoiceId: inv.id } });
    await tx.invoiceLine.deleteMany({ where: { invoiceId: inv.id } });
    await tx.invoice.delete({ where: { id: inv.id } }); // Document rows cascade via FK
    await recordAudit(tx, { entityType: "Invoice", entityId: inv.id, action: "delete", actor: user, before: inv, label: inv.invoiceNumber, note: `${inv.lines.length} line(s) removed` });
  });
  // Cascade only removes the DB rows; unlink the orphaned files too (best-effort).
  for (const d of inv.documents) await deleteReceiptFile(d.fileName, "documents");
  revalidatePath("/invoices");
  return {};
}

// ---------- documents (fiscal invoice / credit note / other) ----------

const INVOICE_DOC_KINDS = ["FISCAL_INVOICE", "CREDIT_NOTE", "OTHER"] as const;
type InvoiceDocKind = (typeof INVOICE_DOC_KINDS)[number];

export async function uploadInvoiceDocumentAction(invoiceId: string, formData: FormData): Promise<{ error?: string }> {
  const user = await requirePermission("invoices:manage");
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId: user.companyId }, select: { id: true } });
  if (!invoice) return { error: "Invoice not found." };

  const kind = String(formData.get("kind") ?? "");
  if (!INVOICE_DOC_KINDS.includes(kind as InvoiceDocKind)) return { error: "Invalid document type." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Pick a file to upload." };
  if (file.size > MAX_RECEIPT_SIZE_BYTES) return { error: `File is too large (max ${MAX_RECEIPT_SIZE_BYTES / 1024 / 1024}MB).` };
  if (!isAllowedReceiptType(file.type)) return { error: "Unsupported file type — use a PDF or an image (JPG/PNG/WEBP)." };

  const saved = await saveReceiptFile(file, "documents");
  await prisma.document.create({
    data: { companyId: user.companyId, kind: kind as InvoiceDocKind, invoiceId, uploadedById: user.id, ...saved },
  });
  revalidatePath(`/invoices/${invoiceId}`);
  return {};
}

export async function deleteInvoiceDocumentAction(documentId: string): Promise<{ error?: string }> {
  const user = await requirePermission("invoices:manage");
  const doc = await prisma.document.findFirst({ where: { id: documentId, companyId: user.companyId, invoiceId: { not: null } } });
  if (!doc) return { error: "Document not found." };
  await prisma.document.delete({ where: { id: doc.id } });
  await deleteReceiptFile(doc.fileName, "documents");
  if (doc.invoiceId) revalidatePath(`/invoices/${doc.invoiceId}`);
  return {};
}
