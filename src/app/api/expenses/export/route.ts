import { NextRequest } from "next/server";
import { parseISO } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { toDateParam } from "@/lib/week";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

const STATUS_VALUES = new Set(["PENDING", "APPROVED", "REJECTED"]);

// Produces the year-end "send this to my accountant" report: every field they'd need to match
// against bank statement lines, one row per expense. Scoped like the /expenses page itself —
// Admin/Finance get the whole company, everyone else only what they own or filed.
export async function GET(req: NextRequest) {
  const user = await requireUser();
  const isManager = can(user, "expenses:manage");
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const categoryId = searchParams.get("categoryId");
  const status = searchParams.get("status");

  const expenses = await prisma.expense.findMany({
    where: {
      companyId: user.companyId,
      // Never export DRAFT captures (unconfirmed). A specific status filter below overrides this.
      status: { not: "DRAFT" },
      ...(isManager ? {} : { OR: [{ userId: user.id }, { submittedById: user.id }] }),
      ...(from ? { date: { gte: parseISO(from) } } : {}),
      ...(to ? { date: { lte: parseISO(to) } } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(status && STATUS_VALUES.has(status) ? { status: status as "PENDING" | "APPROVED" | "REJECTED" } : {}),
    },
    include: { category: true, user: true, submittedBy: true, decidedBy: true, receipts: true },
    orderBy: { date: "desc" },
  });

  const header = [
    "Date", "Category", "Description", "Vendor", "Amount", "Currency", "Payment method", "Paid by",
    "Person", "Status", "Submitted by", "Decided by", "Decided at", "Receipts", "Comment",
  ];
  const rows = expenses.map((e) => [
    toDateParam(e.date),
    e.category.name,
    e.description,
    e.vendor ?? "",
    Number(e.amount).toFixed(2),
    e.currency,
    e.paymentMethod,
    e.paidBy,
    e.user.name,
    e.status,
    e.submittedBy.name,
    e.decidedBy?.name ?? "",
    e.decidedAt ? toDateParam(e.decidedAt) : "",
    String(e.receipts.length),
    e.comment ?? "",
  ]);

  const csv = [header, ...rows].map((r) => r.map((v) => csvEscape(String(v))).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="expenses-${toDateParam(new Date())}.csv"`,
    },
  });
}
