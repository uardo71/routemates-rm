import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { docIntelConfigured } from "@/lib/document-intelligence";
import { CaptureClient } from "./capture-client";

export const metadata: Metadata = { title: "Capture receipt · Routemates" };

export default async function CapturePage() {
  const caller = await requireUser();

  const [categories, company] = await Promise.all([
    prisma.expenseCategory.findMany({
      where: { companyId: caller.companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.company.findUnique({ where: { id: caller.companyId }, select: { currency: true } }),
  ]);

  return (
    <CaptureClient
      categories={categories}
      defaultCurrency={company?.currency ?? "EUR"}
      canManage={can(caller, "expenses:manage")}
      ocrConfigured={docIntelConfigured()}
    />
  );
}
