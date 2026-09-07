import Link from "next/link";
import { ReceiptIcon, WalletIcon, CheckCircle2Icon, AlertTriangleIcon, CalendarRangeIcon, ClockIcon, TimerIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LinkButton } from "@/components/link-button";
import { StatCard } from "@/components/stat-card";
import { MiniBarChart } from "@/components/charts/mini-bar-chart";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  invoiceTotals, outstanding, isRecognized, countsTowardAR, effectiveDueDate, agingBucket, daysOverdue, dso,
  AGING_BUCKETS, type AgingBucket,
} from "@/lib/invoice";
import { convertWith, loadRateResolver, type ExcludedGroup } from "@/lib/fx";
import { FxWarning } from "@/components/fx-warning";
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

  // Each invoice is billed in its OWN currency (inv.currency). Aggregates convert every invoice to
  // the reporting currency at its economic date (recognition date, else issue date); a per-invoice
  // conversion factor (rate for 1 unit; null when no rate) then scales net/gross/out/paid linearly.
  const resolve = await loadRateResolver();
  const factors = await Promise.all(
    invoices.map((inv) => {
      if (inv.currency === cur) return 1 as number | null;
      const date = inv.recognitionDate ?? inv.issueDate;
      return convertWith(1, inv.currency, cur, (f, t) => resolve(f, t, date));
    }),
  );

  const rows = invoices.map((inv, i) => {
    const sign = inv.type === "CREDIT_NOTE" ? -1 : 1;
    const t = invoiceTotals(inv.lines.map((l) => ({ amount: Number(l.amount) })), inv.vatRate == null ? null : Number(inv.vatRate));
    const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
    const factor = factors[i]; // number | null
    const conv = (v: number) => (factor == null ? null : Math.round(v * factor * 100) / 100);
    const net = t.net * sign;
    return {
      inv,
      net,
      gross: t.gross * sign,
      out: outstanding(t.gross, inv.payments.map((p) => ({ amount: Number(p.amount), bankFee: Number(p.bankFee) }))),
      paid,
      period: servicePeriodLabel(inv.periodStart, inv.periodEnd),
      factor,
      baseNet: conv(net),
      baseOut: conv(outstanding(t.gross, inv.payments.map((p) => ({ amount: Number(p.amount), bankFee: Number(p.bankFee) })))),
      basePaid: conv(paid),
    };
  });

  const sum = (arr: (number | null)[]) => Math.round(arr.reduce<number>((s, v) => s + (v ?? 0), 0) * 100) / 100;
  const recognizedNet = sum(rows.filter((r) => isRecognized(r.inv.status)).map((r) => r.baseNet));
  const paidTotal = sum(rows.map((r) => r.basePaid));

  // ---------- accounts receivable: aging, overdue, DSO ----------
  // AR counts only issued/reconciled/paid invoices (never DRAFT or VOID). A credit note's balance is
  // negative, so it subtracts from what the client owes. Amounts are the FX-converted (reporting
  // currency) outstanding; an invoice with no rate contributes nothing and is already reported above.
  const asOf = new Date();
  const ar = rows
    .filter((r) => countsTowardAR(r.inv.status))
    .map((r) => {
      const sign = r.inv.type === "CREDIT_NOTE" ? -1 : 1;
      const due = effectiveDueDate(r.inv.dueDate, r.inv.issueDate, r.inv.client.paymentTermsDays);
      return {
        clientName: r.inv.client.name,
        amount: (r.baseOut ?? 0) * sign,
        bucket: agingBucket(due, asOf),
        overdueDays: daysOverdue(due, asOf),
        // Only a positive balance can actually be "overdue" — a fully paid invoice owes nothing.
        isOpen: (r.baseOut ?? 0) > 0,
      };
    })
    .filter((r) => r.amount !== 0);

  const outstandingTotal = Math.round(ar.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const overdueTotal = Math.round(
    ar.filter((r) => r.isOpen && r.overdueDays != null && r.overdueDays > 0).reduce((s, r) => s + r.amount, 0) * 100,
  ) / 100;
  const oldestOverdue = ar.reduce((mx, r) => (r.isOpen && r.overdueDays != null ? Math.max(mx, r.overdueDays) : mx), 0);

  // Per-client aging matrix + a company total row.
  const agingByClient = new Map<string, { clientName: string; buckets: Record<AgingBucket, number>; total: number }>();
  const emptyBuckets = (): Record<AgingBucket, number> =>
    Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0])) as Record<AgingBucket, number>;
  for (const r of ar) {
    const row = agingByClient.get(r.clientName) ?? { clientName: r.clientName, buckets: emptyBuckets(), total: 0 };
    row.buckets[r.bucket] += r.amount;
    row.total += r.amount;
    agingByClient.set(r.clientName, row);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const agingRows = [...agingByClient.values()]
    .map((row) => ({
      ...row,
      total: r2(row.total),
      buckets: Object.fromEntries(Object.entries(row.buckets).map(([k, v]) => [k, r2(v)])) as Record<AgingBucket, number>,
    }))
    .sort((a, b) => b.total - a.total);
  const agingTotals = AGING_BUCKETS.reduce(
    (acc, b) => ({ ...acc, [b.key]: r2(agingRows.reduce((s, row) => s + row.buckets[b.key], 0)) }),
    {} as Record<AgingBucket, number>,
  );

  // Rolling 90-day DSO: receivables ÷ revenue recognized in the last 90 days × 90.
  const ninetyDaysAgo = new Date(asOf.getTime() - 90 * 86_400_000);
  const revenue90 = sum(
    rows
      .filter((r) => isRecognized(r.inv.status) && (r.inv.recognitionDate ?? r.inv.issueDate) >= ninetyDaysAgo)
      .map((r) => r.baseNet),
  );
  const dso90 = dso(revenue90, outstandingTotal, 90);
  const draftCount = rows.filter((r) => r.inv.status === "DRAFT").length;
  const needsReconcile = rows.filter((r) => r.inv.status === "ISSUED" && !r.inv.fiscalNumber);

  // Invoices that feed a money KPI but have no exchange rate — reported, never summed at 1:1.
  const exMap = new Map<string, ExcludedGroup>();
  for (const r of rows) {
    if (r.factor != null || r.inv.status === "VOID" || r.inv.status === "DRAFT") continue;
    const date = (r.inv.recognitionDate ?? r.inv.issueDate).toISOString().slice(0, 10);
    const k = `${r.inv.currency}|${date}`;
    const g = exMap.get(k) ?? { currency: r.inv.currency, date, count: 0 };
    g.count++;
    exMap.set(k, g);
  }
  const excluded = [...exMap.values()];

  // Recognized net (converted) by SERVICE month (falls back to issue month), last 6 months.
  const now = new Date();
  const monthKeys = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - i), 1)));
  const key = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
  const byMonth = new Map(monthKeys.map((d) => [key(d), 0]));
  for (const r of rows) {
    if (!isRecognized(r.inv.status) || r.baseNet == null) continue;
    const svc = r.inv.periodStart ?? r.inv.issueDate;
    const k = key(svc);
    if (byMonth.has(k)) byMonth.set(k, byMonth.get(k)! + r.baseNet);
  }
  const billedBars = monthKeys.map((d) => ({ label: MONTHS[d.getUTCMonth()], value: Math.round((byMonth.get(key(d)) ?? 0) * 100) / 100 }));

  const tableRows: InvoiceRow[] = rows.map(({ inv, net, gross, out, period, baseNet }) => {
    // "Overdue" = still owed (outstanding > 0) on an issued/reconciled invoice whose effective due
    // date has passed. Paid and draft/void invoices are never overdue.
    const due = effectiveDueDate(inv.dueDate, inv.issueDate, inv.client.paymentTermsDays);
    const overdueDays = daysOverdue(due, asOf);
    const isOverdue =
      (inv.status === "ISSUED" || inv.status === "RECONCILED") && out > 0 && overdueDays != null && overdueDays > 0;
    return {
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
    baseNet,
    status: inv.status,
    fiscalNumber: inv.fiscalNumber,
      period,
      periodStart: iso(inv.periodStart),
      periodEnd: iso(inv.periodEnd),
      currency: inv.currency,
      dueDate: iso(due),
      overdueDays,
      isOverdue,
    };
  });
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

      {/* Register KPIs. Outstanding lives in the AR section below, where it's aged. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Recognized (net)" value={m(recognizedNet)} icon={ReceiptIcon} sublabel="issued + reconciled + paid" />
        <StatCard label="Collected" value={m(paidTotal)} icon={CheckCircle2Icon} sublabel="payments recorded" />
        <StatCard
          label="To reconcile"
          value={needsReconcile.length}
          icon={AlertTriangleIcon}
          tone={needsReconcile.length > 0 ? "warning" : "default"}
          sublabel={draftCount > 0 ? `${draftCount} draft${draftCount === 1 ? "" : "s"} too` : "issued, no fiscal #"}
        />
      </div>

      <FxWarning excluded={excluded} noun="invoices" reporting={cur} />

      {/* Accounts receivable — who owes us what, and how late. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="AR outstanding" value={m(outstandingTotal)} icon={WalletIcon} tone={outstandingTotal > 0 ? "warning" : "default"} sublabel={`${agingRows.length} client${agingRows.length === 1 ? "" : "s"} with a balance`} />
        <StatCard label="Overdue" value={m(overdueTotal)} icon={AlertTriangleIcon} tone={overdueTotal > 0 ? "destructive" : "default"} sublabel="past the due date, still unpaid" />
        <StatCard label="Oldest overdue" value={oldestOverdue > 0 ? `${oldestOverdue} days` : "—"} icon={ClockIcon} tone={oldestOverdue > 60 ? "destructive" : oldestOverdue > 0 ? "warning" : "default"} sublabel="longest-waiting unpaid invoice" />
        <StatCard label="DSO (90-day)" value={dso90 > 0 ? `${formatNumber(dso90)} days` : "—"} icon={TimerIcon} sublabel="receivables ÷ 90d revenue × 90" />
      </div>

      {agingRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AR aging by client</CardTitle>
            <p className="text-xs text-muted-foreground">
              Outstanding balance by how far past its due date each invoice is, in {cur}. Draft and void invoices are
              excluded; credit notes subtract. Invoices with no due date and no client payment terms are shown separately
              rather than assumed current — set terms on the client to age them.
            </p>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    {AGING_BUCKETS.map((b) => (
                      <TableHead key={b.key} className={cn("text-right whitespace-nowrap", b.key === "D90_PLUS" && "text-destructive")}>{b.short}</TableHead>
                    ))}
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agingRows.map((row) => (
                    <TableRow key={row.clientName}>
                      <TableCell className="font-medium">{row.clientName}</TableCell>
                      {AGING_BUCKETS.map((b) => (
                        <TableCell
                          key={b.key}
                          className={cn(
                            "text-right tabular-nums",
                            row.buckets[b.key] === 0 && "text-muted-foreground/40",
                            row.buckets[b.key] !== 0 && b.key === "D90_PLUS" && "font-medium text-destructive",
                            row.buckets[b.key] !== 0 && b.key === "D61_90" && "text-amber-600",
                            row.buckets[b.key] !== 0 && b.key === "NO_DUE_DATE" && "text-muted-foreground italic",
                          )}
                        >
                          {row.buckets[b.key] === 0 ? "—" : m(row.buckets[b.key])}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-medium tabular-nums">{m(row.total)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2">
                    <TableCell className="font-semibold">All clients</TableCell>
                    {AGING_BUCKETS.map((b) => (
                      <TableCell key={b.key} className={cn("text-right font-medium tabular-nums", b.key === "D90_PLUS" && agingTotals[b.key] !== 0 && "text-destructive")}>
                        {agingTotals[b.key] === 0 ? "—" : m(agingTotals[b.key])}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-semibold tabular-nums">{m(outstandingTotal)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

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
                <span className="tabular-nums shrink-0">{formatMoney(r.net, r.inv.currency)}</span>
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
          <InvoicesTable rows={tableRows} clients={clientNames} reportingCurrency={cur} />
        </CardContent>
      </Card>
    </div>
  );
}
