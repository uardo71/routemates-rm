import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { NewInvoiceClient, type ProjectOption } from "./new-invoice-client";

export default async function NewInvoicePage() {
  const user = await requirePermission("invoices:manage");

  const [projects, company, invoices] = await Promise.all([
    prisma.project.findMany({
      where: { companyId: user.companyId },
      orderBy: { name: "asc" },
      include: { client: { select: { name: true } }, milestones: { where: { billable: true }, select: { id: true, name: true, salesPrice: true, budgetHours: true }, orderBy: { createdAt: "asc" } } },
    }),
    prisma.company.findUniqueOrThrow({ where: { id: user.companyId }, select: { currency: true } }),
    prisma.invoice.findMany({ where: { companyId: user.companyId, type: "INVOICE" }, orderBy: { issueDate: "desc" }, select: { id: true, invoiceNumber: true, projectId: true } }),
  ]);

  const projectOptions: ProjectOption[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    clientName: p.client.name,
    billingType: p.billingType,
    uatAccepted: p.uatAccepted,
    contractValue: Number(p.contractValue ?? p.budgetAmount ?? 0),
    milestones: p.milestones.map((m) => ({
      id: m.id,
      name: m.name,
      salesPrice: Number(m.salesPrice),
      budgetHours: m.budgetHours ? Number(m.budgetHours) : null,
    })),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/invoices" className="text-sm text-muted-foreground hover:underline">← Invoice register</Link>
        <h1 className="text-2xl font-semibold mt-1">New invoice</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Record an invoice</CardTitle>
        </CardHeader>
        <CardContent>
          <NewInvoiceClient
            projects={projectOptions}
            defaultCurrency={company.currency}
            invoices={invoices.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, projectId: i.projectId }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
