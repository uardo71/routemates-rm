import Link from "next/link";
import { format } from "date-fns";
import { ReceiptIcon, WalletIcon, CheckCircle2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LinkButton } from "@/components/link-button";
import { StatCard } from "@/components/stat-card";
import { InitialsAvatar } from "@/components/initials-avatar";
import { MiniBarChart } from "@/components/charts/mini-bar-chart";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { formatMoney } from "@/lib/format";

type Tone = "secondary" | "default" | "outline" | "destructive";
const INVOICE_STATUS_TONE: Record<string, Tone> = {
  DRAFT: "secondary",
  SENT: "default",
  PAID: "outline",
  VOID: "destructive",
};

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

  const totals = invoices.map((inv) => ({ inv, total: inv.lines.reduce((s, l) => s + Number(l.amount), 0) }));
  const grandTotal = totals.reduce((s, t) => s + t.total, 0);
  const openTotal = totals.filter((t) => t.inv.status === "DRAFT" || t.inv.status === "SENT").reduce((s, t) => s + t.total, 0);
  const paidTotal = totals.filter((t) => t.inv.status === "PAID").reduce((s, t) => s + t.total, 0);

  // Last 6 calendar months by issue date, oldest first — a quick trend read on billing volume.
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const monthlyMap = new Map<string, number>();
  for (const { inv, total } of totals) monthlyMap.set(monthKey(inv.issueDate), (monthlyMap.get(monthKey(inv.issueDate)) ?? 0) + total);
  const now = new Date();
  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return { label: format(d, "MMM"), value: Math.round((monthlyMap.get(monthKey(d)) ?? 0) * 100) / 100 };
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Invoices</h1>
          <p className="text-sm text-muted-foreground">Billing across every client.</p>
        </div>
        <LinkButton href="/invoices/new">Generate T&amp;M invoice</LinkButton>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total invoiced" value={formatMoney(grandTotal, company.currency)} icon={ReceiptIcon} sublabel={`${invoices.length} invoices`} />
        <StatCard label="Open" value={formatMoney(openTotal, company.currency)} icon={WalletIcon} tone={openTotal > 0 ? "warning" : "default"} sublabel="draft + sent" />
        <StatCard label="Paid" value={formatMoney(paidTotal, company.currency)} icon={CheckCircle2Icon} sublabel="collected" />
      </div>

      {grandTotal > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Invoiced value, last 6 months</CardTitle>
          </CardHeader>
          <CardContent>
            <MiniBarChart data={monthlyData} valueFormatter={(v) => formatMoney(v, company.currency)} />
          </CardContent>
        </Card>
      )}

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
              {totals.map(({ inv: invoice, total }) => (
                <TableRow key={invoice.id}>
                  <TableCell>
                    <Link href={`/invoices/${invoice.id}`} className="flex items-center gap-2.5 font-medium hover:underline">
                      <InitialsAvatar name={invoice.client.name} className="size-6 text-[10px]" />
                      {invoice.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{invoice.client.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(invoice.periodStart, "MMM d")} – {format(invoice.periodEnd, "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatMoney(total, invoice.currency)}</TableCell>
                  <TableCell>
                    <Badge variant={INVOICE_STATUS_TONE[invoice.status] ?? "secondary"}>{invoice.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
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
