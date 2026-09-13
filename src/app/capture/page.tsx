import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { docIntelConfigured } from "@/lib/document-intelligence";
import { CaptureClient, type DraftSummary } from "./capture-client";

export const metadata: Metadata = { title: "Capture receipt · Routemates" };

export default async function CapturePage() {
  const caller = await requireUser();

  const [categories, company, draftRows] = await Promise.all([
    prisma.expenseCategory.findMany({
      where: { companyId: caller.companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.company.findUnique({ where: { id: caller.companyId }, select: { currency: true } }),
    // Saved the instant a photo is taken (so the receipt itself is never lost), but the record only
    // becomes a real expense once confirmed here — anyone who closed the tab mid-capture had no way
    // back to it until now.
    prisma.expense.findMany({
      where: { companyId: caller.companyId, userId: caller.id, status: "DRAFT" },
      select: {
        id: true, createdAt: true, date: true, amount: true, currency: true, description: true, vendor: true,
        categoryId: true, paymentMethod: true, paidBy: true,
        receipts: { select: { fileName: true }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const drafts: DraftSummary[] = draftRows.map((d) => ({
    id: d.id, createdAt: d.createdAt.toISOString(), date: d.date.toISOString().slice(0, 10),
    amount: Number(d.amount), currency: d.currency, description: d.description ?? "", vendor: d.vendor,
    categoryId: d.categoryId, paymentMethod: d.paymentMethod, paidBy: d.paidBy,
    receiptFileName: d.receipts[0]?.fileName ?? null,
  }));

  return (
    <CaptureClient
      categories={categories}
      defaultCurrency={company?.currency ?? "EUR"}
      canManage={can(caller, "expenses:manage")}
      ocrConfigured={docIntelConfigured()}
      drafts={drafts}
    />
  );
}
