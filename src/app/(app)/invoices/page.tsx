import Link from "next/link";
import { format } from "date-fns";
import { ReceiptIcon, WalletIcon, CheckCircle2Icon, AlertTriangleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LinkButton } from "@/components/link-button";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { formatMoney } from "@/lib/format";
import { invoiceTotals, outstanding, isRecognized, INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, INVOICE_TYPE_LABEL } from "@/lib/invoice";

export default async function InvoicesPage() {
  const user = await requirePermission("invoices:manage");

  const [company, invoices] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: user.companyId } }),
    prisma.invoice.findMany({
      where: { companyId: user.companyId },
      include: { client: true, project: { select: { name: true } }, lines: true, payments: true },
      orderBy: { issueDate: "desc" },
    }),
  ]);

  const rows = invoices.map((inv) => {
    const sign = inv.type === "CREDIT_NOTE" ? -1 : 1;
    const t = invoiceTotals(inv.lines.map((l) => ({ amount: Number(l.amount) })), inv.vatRate == null ? null : Number(inv.vatRate));
    const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
    return { inv, net: t.net * sign, gross: t.gross * sign, out: outstanding(t.gross, inv.payments.map((p) => ({ amount: Number(p.amount) }))), paid };
  });

  const recognizedNet = rows.filter((r) => isRecognized(r.inv.status)).reduce((s, r) => s + r.net, 0);
  const outstandingTotal = rows.filter((r) => r.inv.status !== "VOID" && r.inv.status !== "DRAFT").reduce((s, r) => s + r.out, 0);
  const paidTotal = rows.reduce((s, r) => s + r.paid, 0);
  const needsReconcile = rows.filter((r) => r.inv.status === "ISSUED" && !r.inv.fiscalNumber);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Invoice register</h1>
          <p className="text-sm text-muted-foreground">
            Records what was billed and reconciles it against your fiscal app — no documents are generated here.
          </p>
        </div>
        <LinkButton href="/invoices/new">New invoice</LinkButton>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Recognized (net)" value={formatMoney(recognizedNet, company.currency)} icon={ReceiptIcon} sublabel="issued + reconciled + paid" />
        <StatCard label="Outstanding" value={formatMoney(outstandingTotal, company.currency)} icon={WalletIcon} tone={outstandingTotal > 0 ? "warning" : "default"} sublabel="unpaid gross" />
        <StatCard label="Collected" value={formatMoney(paidTotal, company.currency)} icon={CheckCircle2Icon} sublabel="payments recorded" />
      </div>

      {needsReconcile.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangleIcon className="size-4 text-amber-500" /> Needs reconciliation ({needsReconcile.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">Issued here but missing the fiscal app&apos;s invoice number.</p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Project / Client</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {needsReconcile.map((r) => (
                  <TableRow key={r.inv.id} className="cursor-pointer">
                    <TableCell className="font-medium">
                      <Link href={`/invoices/${r.inv.id}`} className="hover:underline">{r.inv.invoiceNumber}</Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.inv.project?.name ?? r.inv.client.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.net, r.inv.currency)}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/invoices/${r.inv.id}`} className="text-sm text-primary hover:underline">Reconcile →</Link>
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
          <CardTitle className="text-base">All entries</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Project / Client</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Fiscal #</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ inv, net, gross, out }) => (
                  <TableRow key={inv.id} className="cursor-pointer">
                    <TableCell className="font-medium">
                      <Link href={`/invoices/${inv.id}`} className="hover:underline">{inv.invoiceNumber}</Link>
                      {inv.selfBilled && <span className="block text-[10px] text-muted-foreground">self-billed</span>}
                    </TableCell>
                    <TableCell>{INVOICE_TYPE_LABEL[inv.type]}</TableCell>
                    <TableCell className="text-muted-foreground">{inv.project?.name ?? inv.client.name}</TableCell>
                    <TableCell className="text-muted-foreground">{format(inv.issueDate, "MMM d, yyyy")}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(net, inv.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(gross, inv.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {inv.status === "VOID" ? "—" : formatMoney(out, inv.currency)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{inv.fiscalNumber ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={INVOICE_STATUS_TONE[inv.status]}>{INVOICE_STATUS_LABEL[inv.status]}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground">No invoices yet.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
