import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { formatMoney } from "@/lib/format";
import { updateInvoiceStatusAction } from "../actions";
import { EditInvoiceForm } from "./edit-invoice-form";

const NEXT_STATUS: Record<string, "SENT" | "PAID" | null> = {
  DRAFT: "SENT",
  SENT: "PAID",
  PAID: null,
  VOID: null,
};

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("invoices:manage");

  const invoice = await prisma.invoice.findFirst({
    where: { id, companyId: user.companyId },
    include: { client: true, lines: true },
  });
  if (!invoice) notFound();

  const total = invoice.lines.reduce((s, l) => s + Number(l.amount), 0);
  const next = NEXT_STATUS[invoice.status];
  const canVoid = invoice.status === "DRAFT" || invoice.status === "SENT";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/invoices" className="text-sm text-muted-foreground hover:underline">
          ← Invoices
        </Link>
        <div className="flex items-center justify-between mt-1">
          <h1 className="text-2xl font-semibold">
            {invoice.invoiceNumber} · {invoice.client.name}
          </h1>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{invoice.status}</Badge>
            {next && (
              <form action={updateInvoiceStatusAction}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <input type="hidden" name="status" value={next} />
                <Button type="submit" size="sm" variant="outline">
                  Mark {next.toLowerCase()}
                </Button>
              </form>
            )}
            {canVoid && (
              <form action={updateInvoiceStatusAction}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <input type="hidden" name="status" value="VOID" />
                <Button type="submit" size="sm" variant="destructive">
                  Void
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="text-sm text-muted-foreground flex flex-wrap gap-x-6">
            <span>
              {format(invoice.periodStart, "MMM d, yyyy")} – {format(invoice.periodEnd, "MMM d, yyyy")}
            </span>
            {invoice.poNumber && <span>PO: {invoice.poNumber}</span>}
            {invoice.referenceNumber && <span>Ref: {invoice.referenceNumber}</span>}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>{line.description}</TableCell>
                  <TableCell>{line.quantity.toString()}</TableCell>
                  <TableCell>{formatMoney(line.rate, invoice.currency)}</TableCell>
                  <TableCell>{formatMoney(line.amount, invoice.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="text-right font-medium">
            Total: {formatMoney(total, invoice.currency)}
          </div>
        </CardContent>
      </Card>

      {invoice.status === "DRAFT" && (
        <Card>
          <CardHeader>
            <CardTitle>Edit invoice</CardTitle>
          </CardHeader>
          <CardContent>
            <EditInvoiceForm
              key={invoice.updatedAt.toISOString()}
              invoice={{
                id: invoice.id,
                periodStart: invoice.periodStart.toISOString().slice(0, 10),
                periodEnd: invoice.periodEnd.toISOString().slice(0, 10),
                poNumber: invoice.poNumber,
                referenceNumber: invoice.referenceNumber,
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
