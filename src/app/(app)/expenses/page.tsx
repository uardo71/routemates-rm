import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { toDateParam } from "@/lib/week";
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
    prisma.expenseCategory.findMany({ where: { companyId: caller.companyId }, orderBy: { name: "asc" } }),
    prisma.company.findUniqueOrThrow({ where: { id: caller.companyId }, select: { currency: true } }),
  ]);

  const rows: ExpenseRow[] = expenses.map((e) => ({
    id: e.id,
    categoryId: e.categoryId,
    categoryName: e.category.name,
    date: toDateParam(e.date),
    amount: Number(e.amount),
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
    const users = await prisma.user.findMany({ where: { companyId: caller.companyId, active: true }, orderBy: { name: "asc" } });
    people = users.map((u) => ({ id: u.id, name: u.name }));
  }

  const categoryOptions: CategoryOption[] = categories.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Expenses</h1>
        <p className="text-sm text-muted-foreground">
          {canManage
            ? "Company-wide expense tracking — company card purchases and reimbursement claims."
            : "Track what you've paid on the company card, or file a reimbursement claim."}
        </p>
      </div>
      <ExpensesClient
        callerId={caller.id}
        canManage={canManage}
        rows={rows}
        categories={categoryOptions}
        people={people}
        defaultCurrency={company.currency}
      />
    </div>
  );
}
