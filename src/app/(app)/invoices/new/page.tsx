import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { GenerateInvoiceForm } from "./generate-invoice-form";

export default async function NewInvoicePage() {
  const user = await requirePermission("invoices:manage");

  const clients = await prisma.client.findMany({ where: { companyId: user.companyId }, orderBy: { name: "asc" } });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/invoices" className="text-sm text-muted-foreground hover:underline">
          ← Invoices
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Generate T&amp;M / Retainer invoice</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Invoice details</CardTitle>
        </CardHeader>
        <CardContent>
          <GenerateInvoiceForm clients={clients.map((c) => ({ id: c.id, name: c.name }))} />
        </CardContent>
      </Card>
    </div>
  );
}
