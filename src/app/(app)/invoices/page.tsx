import Link from "next/link";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LinkButton } from "@/components/link-button";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { formatMoney } from "@/lib/format";

export default async function InvoicesPage() {
  const user = await requirePermission("invoices:manage");

  const [company, invoices, readyToBill] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: user.companyId } }),
    prisma.invoice.findMany({
      where: { companyId: user.companyId },
      include: { client: true, lines: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.milestone.findMany({
      where: {
        status: "COMPLETE",
        billable: true,
        project: { companyId: user.companyId, billingType: "FIXED_PRICE" },
      },
      include: { project: { include: { client: true } } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <LinkButton href="/invoices/new">Generate T&amp;M invoice</LinkButton>
      </div>

      {readyToBill.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ready to bill (fixed-price)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Milestone</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {readyToBill.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      {m.project.name} — {m.name}
                    </TableCell>
                    <TableCell>{m.project.client.name}</TableCell>
                    <TableCell>{formatMoney(m.salesPrice, company.currency)}</TableCell>
                    <TableCell>
                      <Link
                        href={`/projects/${m.projectId}/milestones/${m.id}`}
                        className="text-sm text-primary hover:underline"
                      >
                        Bill from milestone →
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => {
                const total = invoice.lines.reduce((s, l) => s + Number(l.amount), 0);
                return (
                  <TableRow key={invoice.id}>
                    <TableCell>
                      <Link href={`/invoices/${invoice.id}`} className="font-medium hover:underline">
                        {invoice.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{invoice.client.name}</TableCell>
                    <TableCell>
                      {format(invoice.periodStart, "MMM d")} – {format(invoice.periodEnd, "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>{formatMoney(total, invoice.currency)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{invoice.status}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {invoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No invoices yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
