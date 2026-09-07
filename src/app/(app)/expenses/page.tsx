import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can, STAFF_ONLY } from "@/lib/permissions";
import { toDateParam } from "@/lib/week";
import { convertRows } from "@/lib/fx";
import { ExpensesClient, type ExpenseRow, type CategoryOption, type PersonOption } from "./expenses-client";

export default async function ExpensesPage() {
  const caller = await requireUser();
  const canManage = can(caller, "expenses:manage"); // Admin/Finance: sees everyone's, decides, auto-approves own submissions

  const [expenses, categories, company] = await Promise.all([
    prisma.expense.findMany({
      // Exclude DRAFT (receipts captured via /capture but not yet confirmed) — they only surface in
      // the capture flow, never the main register/approvals/export.
      where: {
        ...(canManage
          ? { companyId: caller.companyId }
          : { OR: [{ userId: caller.id }, { submittedById: caller.id }] }),
        status: { not: "DRAFT" },
      },
      include: { category: true, user: true, submittedBy: true, decidedBy: true, receipts: true },
      orderBy: { date: "desc" },
    }),
    prisma.expenseCategory.findMany({
      where: { companyId: caller.companyId },
      include: { _count: { select: { expenses: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.company.findUniqueOrThrow({ where: { id: caller.companyId }, select: { currency: true } }),
  ]);

  // Convert every expense to the company reporting currency at its own date, so the KPIs/donut/
  // monthly chart/footer sum a single currency. Unconvertible rows (no rate) are surfaced, never
  // added at 1:1.
  const reportingCurrency = company.currency;
  const conv = await convertRows(expenses.map((e) => ({ amount: Number(e.amount), currency: e.currency, date: e.date })), reportingCurrency);

  const rows: ExpenseRow[] = expenses.map((e, i) => ({
    id: e.id,
    categoryId: e.categoryId,
    categoryName: e.category.name,
    date: toDateParam(e.date),
    amount: Number(e.amount),
    baseAmount: conv.rows[i].baseAmount,
    currency: e.currency,
    description: e.description,
    vendor: e.vendor,
    paymentMethod: e.paymentMethod,
    paidBy: e.paidBy,
    userId: e.userId,
    userName: e.user.name,
    submittedById: e.submittedById,
    submittedByName: e.submittedBy.name,
    status: e.status as ExpenseRow["status"], // DRAFT filtered out above, so this narrows safely
    decidedByName: e.decidedBy?.name ?? null,
    decidedAt: e.decidedAt ? toDateParam(e.decidedAt) : null,
    comment: e.comment,
    receipts: e.receipts.map((r) => ({ id: r.id, fileName: r.fileName, originalName: r.originalName })),
    canDelete: e.status === "PENDING" && (e.userId === caller.id || e.submittedById === caller.id || canManage),
  }));

  let people: PersonOption[] = [];
  if (canManage) {
    const users = await prisma.user.findMany({ where: { companyId: caller.companyId, active: true, ...STAFF_ONLY }, orderBy: { name: "asc" } });
    people = users.map((u) => ({ id: u.id, name: u.name }));
  }

  const categoryOptions: CategoryOption[] = categories.map((c) => ({ id: c.id, name: c.name, expenseCount: c._count.expenses }));

  // Aggregate totals (KPIs, donut, monthly chart, footer) are formatted in the currency the expenses
  // actually use — they're often logged in ALL, not the company's reporting currency (EUR). Use the
  // most-common currency among records, falling back to the company default; also the new-expense default.
  const currencyCounts = new Map<string, number>();
  for (const e of expenses) currencyCounts.set(e.currency, (currencyCounts.get(e.currency) ?? 0) + 1);
  const displayCurrency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? company.currency;

  return (
    <ExpensesClient
      callerId={caller.id}
      canManage={canManage}
      rows={rows}
      categories={categoryOptions}
      people={people}
      defaultCurrency={displayCurrency}
      reportingCurrency={reportingCurrency}
      excluded={conv.excluded}
    />
  );
}
