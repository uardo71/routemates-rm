import Link from "next/link";
import { ReceiptIcon, WalletIcon, CheckCircle2Icon, AlertTriangleIcon, CalendarRangeIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LinkButton } from "@/components/link-button";
import { StatCard } from "@/components/stat-card";
import { MiniBarChart } from "@/components/charts/mini-bar-chart";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { formatMoney } from "@/lib/format";
import { invoiceTotals, outstanding, isRecognized } from "@/lib/invoice";
import { InvoicesTable, type InvoiceRow } from "./invoices-table";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Service period stored at UTC midnight — read with UTC accessors so the month is right in any tz.
function servicePeriodLabel(start: Date | null, end: Date | null): string | null {
  if (!start) return null;
  const e = end ?? start;
  if (start.getUTCFullYear() === e.getUTCFullYear() && start.getUTCMonth() === e.getUTCMonth()) {
    return `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
  }
  return `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()} – ${MONTHS[e.getUTCMonth()]} ${e.getUTCDate()}, ${e.getUTCFullYear()}`;
}

export default async function InvoicesPage() {
  const user = await requirePermission("invoices:manage");

  const [company, invoices] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: user.companyId } }),
    prisma.invoice.findMany({
      where: { companyId: user.companyId },
      include: { client: true, project: { select: { name: true } }, lines: true, payments: true },
      orderBy: [{ issueDate: "desc" }, { invoiceNumber: "desc" }],
    }),
  ]);
  const cur = company.currency;
  const m = (v: number) => formatMoney(v, cur);

  const rows = invoices.map((inv) => {
    const sign = inv.type === "CREDIT_NOTE" ? -1 : 1;
    const t = invoiceTotals(inv.lines.map((l) => ({ amount: Number(l.amount) })), inv.vatRate == null ? null : Number(inv.vatRate));
    const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
    return {
      inv,
      net: t.net * sign,
      gross: t.gross * sign,
      out: outstanding(t.gross, inv.payments.map((p) => ({ amount: Number(p.amount) }))),
      paid,
      period: servicePeriodLabel(inv.periodStart, inv.periodEnd),
    };
  });

  const recognizedNet = rows.filter((r) => isRecognized(r.inv.status)).reduce((s, r) => s + r.net, 0);
  const outstandingTotal = rows.filter((r) => r.inv.status !== "VOID" && r.inv.status !== "DRAFT").reduce((s, r) => s + r.out, 0);
  const paidTotal = rows.reduce((s, r) => s + r.paid, 0);
  const draftCount = rows.filter((r) => r.inv.status === "DRAFT").length;
  const needsReconcile = rows.filter((r) => r.inv.status === "ISSUED" && !r.inv.fiscalNumber);

  // Recognized net by SERVICE month (falls back to issue month when no period is set), last 6 months.
  const now = new Date();
  const monthKeys = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - i), 1)));
  const key = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
  const byMonth = new Map(monthKeys.map((d) => [key(d), 0]));
  for (const r of rows) {
    if (!isRecognized(r.inv.status)) continue;
    const svc = r.inv.periodStart ?? r.inv.issueDate;
    const k = key(svc);
    if (byMonth.has(k)) byMonth.set(k, byMonth.get(k)! + r.net);
  }
  const billedBars = monthKeys.map((d) => ({ label: MONTHS[d.getUTCMonth()], value: Math.round((byMonth.get(key(d)) ?? 0) * 100) / 100 }));

  const tableRows: InvoiceRow[] = rows.map(({ inv, net, gross, out, period }) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    isCredit: inv.type === "CREDIT_NOTE",
    selfBilled: inv.selfBilled,
    clientName: inv.client.name,
    projectName: inv.project?.name ?? null,
    issueDate: iso(inv.issueDate)!,
    net,
    gross,
    out,
    status: inv.status,
    fiscalNumber: inv.fiscalNumber,
    period,
    periodStart: iso(inv.periodStart),
    periodEnd: iso(inv.periodEnd),
    currency: cur,
  }));
  const clientNames = Array.from(new Set(invoices.map((i) => i.client.name))).sort((a, b) => a.localeCompare(b));

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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Recognized (net)" value={m(recognizedNet)} icon={ReceiptIcon} sublabel="issued + reconciled + paid" />
        <StatCard label="Outstanding" value={m(outstandingTotal)} icon={WalletIcon} tone={outstandingTotal > 0 ? "warning" : "default"} sublabel="unpaid gross" />
        <StatCard label="Collected" value={m(paidTotal)} icon={CheckCircle2Icon} sublabel="payments recorded" />
        <StatCard
          label="To reconcile"
          value={needsReconcile.length}
          icon={AlertTriangleIcon}
          tone={needsReconcile.length > 0 ? "warning" : "default"}
          sublabel={draftCount > 0 ? `${draftCount} draft${draftCount === 1 ? "" : "s"} too` : "issued, no fiscal #"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><CalendarRangeIcon className="size-4 text-muted-foreground" /> Billed by service month</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Recognized net by the month the work relates to — last 6 months.</p>
            </div>
          </CardHeader>
          <CardContent>
            {billedBars.some((b) => b.value !== 0) ? <MiniBarChart data={billedBars} height={120} valueFormatter={m} /> : <p className="text-sm text-muted-foreground py-6 text-center">No recognized invoices yet.</p>}
          </CardContent>
        </Card>

        <Card className={needsReconcile.length > 0 ? "border-amber-300" : undefined}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {needsReconcile.length > 0 && <AlertTriangleIcon className="size-4 text-amber-500" />} Needs reconciliation
            </CardTitle>
            <p className="text-xs text-muted-foreground">Issued here but missing the fiscal app&apos;s number.</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {needsReconcile.length === 0 && <p className="text-sm text-muted-foreground py-2">All caught up — nothing to reconcile. 🎉</p>}
            {needsReconcile.map((r) => (
              <Link key={r.inv.id} href={`/invoices/${r.inv.id}`} className="flex items-center justify-between gap-2 rounded-md hover:bg-muted/50 p-1.5 -mx-1.5 text-sm">
                <span className="font-medium">{r.inv.invoiceNumber}</span>
                <span className="text-muted-foreground truncate flex-1 min-w-0">{r.inv.project?.name ?? r.inv.client.name}</span>
                <span className="tabular-nums shrink-0">{m(r.net)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All entries <span className="font-normal text-muted-foreground">({rows.length})</span></CardTitle>
        </CardHeader>
        <CardContent>
          <InvoicesTable rows={tableRows} clients={clientNames} />
        </CardContent>
      </Card>
    </div>
  );
}
