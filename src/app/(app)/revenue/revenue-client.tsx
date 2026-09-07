"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { WalletIcon, TrendingUpIcon, CoinsIcon, ClockIcon, BanknoteIcon, ReceiptIcon, ScaleIcon, Building2Icon, HourglassIcon, ArrowDownLeftIcon, SearchIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/stat-card";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProjectBillingType } from "@prisma/client";
import type { RevenueRow, OverheadRow } from "@/lib/revenue-data";

export type { RevenueRow, OverheadRow };

const TYPE_LABEL: Record<ProjectBillingType, string> = {
  TIME_AND_MATERIALS: "T&M",
  FIXED_PRICE: "Fixed price",
  RETAINER: "Retainer",
};

export function RevenueClient({
  rows,
  overhead,
  monthKeys,
  monthLabels,
  defaultCurrency,
}: {
  rows: RevenueRow[];
  overhead: OverheadRow[];
  monthKeys: string[];
  monthLabels: string[];
  defaultCurrency: string;
}) {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState<"ALL" | ProjectBillingType>("ALL");
  const [clientFilter, setClientFilter] = useState("ALL");
  // Forecast period window: indices into monthKeys (0 = current month). Default = current month.
  const [fromIdx, setFromIdx] = useState(0);
  const [toIdx, setToIdx] = useState(0);

  const clients = useMemo(
    () => Array.from(new Set([...rows, ...overhead].map((r) => r.clientName))).sort(),
    [rows, overhead],
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (typeFilter !== "ALL" && r.billingType !== typeFilter) return false;
        if (clientFilter !== "ALL" && r.clientName !== clientFilter) return false;
        return true;
      }),
    [rows, typeFilter, clientFilter],
  );

  const filteredOverhead = useMemo(
    () =>
      overhead.filter((r) => {
        if (typeFilter !== "ALL" && r.billingType !== typeFilter) return false;
        if (clientFilter !== "ALL" && r.clientName !== clientFilter) return false;
        return true;
      }),
    [overhead, typeFilter, clientFilter],
  );

  const t = useMemo(() => {
    const sum = (f: (r: RevenueRow) => number) => filtered.reduce((s, r) => s + f(r), 0);
    return {
      contract: sum((r) => r.contractValue),
      forecast: sum((r) => r.forecastRevenue),
      earned: sum((r) => r.earnedRevenue),
      recognized: sum((r) => r.recognizedRevenue),
      unplanned: sum((r) => r.unplannedHours),
      internalCost: sum((r) => r.internalCost),
      externalCost: sum((r) => r.externalCost),
      totalCost: sum((r) => r.totalCost),
      margin: sum((r) => r.margin),
      unbilled: sum((r) => r.unbilled),
      overBilled: sum((r) => r.overBilled),
      unbilledHours: sum((r) => r.unbilledHours),
      forecastCost: sum((r) => r.forecastCost),
      forecastMargin: sum((r) => r.forecastMargin),
    };
  }, [filtered]);

  const overheadCost = useMemo(() => filteredOverhead.reduce((s, r) => s + r.cost, 0), [filteredOverhead]);
  const operatingMargin = t.margin - overheadCost;

  // Monthly time-phased forecast, aggregated across the filtered revenue projects.
  const monthAgg = useMemo(
    () => monthLabels.map((label, i) => ({ label, key: monthKeys[i], value: Math.round(filtered.reduce((s, r) => s + (r.monthly[i] ?? 0), 0) * 100) / 100 })),
    [filtered, monthLabels, monthKeys],
  );
  const lo = Math.min(fromIdx, toIdx);
  const hi = Math.max(fromIdx, toIdx);
  const windowTotal = useMemo(() => monthAgg.slice(lo, hi + 1).reduce((s, mo) => s + mo.value, 0), [monthAgg, lo, hi]);
  // Per-project expected revenue within the selected window (largest first).
  const windowProjects = useMemo(
    () =>
      filtered
        .map((r) => ({ projectId: r.projectId, name: r.projectName, client: r.clientName, value: Math.round(r.monthly.slice(lo, hi + 1).reduce((s, v) => s + v, 0) * 100) / 100 }))
        .filter((p) => p.value > 0)
        .sort((a, b) => b.value - a.value),
    [filtered, lo, hi],
  );
  const windowLabel = lo === hi ? monthLabels[lo] : `${monthLabels[lo]} – ${monthLabels[hi]}`;
  const winVal = (r: RevenueRow) => Math.round(r.monthly.slice(lo, hi + 1).reduce((s, v) => s + v, 0) * 100) / 100;
  const maxMonth = Math.max(1, ...monthAgg.map((mo) => mo.value));

  // Presets computed from the month keys (index 0 = current month).
  const monthNum = (i: number) => parseInt(monthKeys[i].slice(5), 10) - 1; // 0–11
  let quarterEnd = 0;
  while (quarterEnd < monthKeys.length - 1 && monthNum(quarterEnd) % 3 !== 2) quarterEnd++;
  let yearEnd = 0;
  while (yearEnd < monthKeys.length - 1 && monthNum(yearEnd) !== 11) yearEnd++;
  const presets: { label: string; from: number; to: number }[] = [
    { label: "This month", from: 0, to: 0 },
    { label: "This quarter", from: 0, to: quarterEnd },
    { label: "Rest of year", from: 0, to: yearEnd },
    { label: "Next 6 months", from: 0, to: 5 },
    { label: "Next 12 months", from: 0, to: 11 },
  ];
  const setWindow = (from: number, to: number) => { setFromIdx(from); setToIdx(to); };

  const mixedCurrency = new Set([...filtered, ...filteredOverhead].map((r) => r.currency)).size > 1;
  const m = (v: number) => formatMoney(v, defaultCurrency);
  // Gross margin % against earned revenue (undefined when nothing earned yet).
  const marginPct = t.earned > 0 ? (t.margin / t.earned) * 100 : null;
  const rowMarginPct = (r: RevenueRow) => (r.earnedRevenue > 0 ? (r.margin / r.earnedRevenue) * 100 : null);
  // Forecast (projected) margin % against forecast revenue.
  const forecastMarginPct = t.forecast > 0 ? (t.forecastMargin / t.forecast) * 100 : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Revenue &amp; forecast</h1>
        <p className="text-sm text-muted-foreground">
          Backlog, plan-based forecast, and earned revenue from client work — with internal (our people) and subcontractor cost shown separately.
        </p>
      </div>

      {/* Global filter bar — type, client and period drive every number, table and chart below. */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card/95 px-3 py-2.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <Select
          value={typeFilter}
          items={[
            { value: "ALL", label: "All types" },
            { value: "TIME_AND_MATERIALS", label: "T&M" },
            { value: "FIXED_PRICE", label: "Fixed price" },
            { value: "RETAINER", label: "Retainer" },
          ]}
          onValueChange={(v) => setTypeFilter((v as typeof typeFilter) ?? "ALL")}
        >
          <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            <SelectItem value="TIME_AND_MATERIALS">T&amp;M</SelectItem>
            <SelectItem value="FIXED_PRICE">Fixed price</SelectItem>
            <SelectItem value="RETAINER">Retainer</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={clientFilter}
          items={[{ value: "ALL", label: "All clients" }, ...clients.map((c) => ({ value: c, label: c }))]}
          onValueChange={(v) => setClientFilter(v ?? "ALL")}
        >
          <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All clients</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Forecast period</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {presets.map((p) => {
            const active = lo === p.from && hi === p.to;
            return (
              <button
                key={p.label}
                onClick={() => setWindow(p.from, p.to)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  active ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <Select value={String(fromIdx)} items={monthLabels.map((l, i) => ({ value: String(i), label: l }))} onValueChange={(v) => setFromIdx(Math.min(Number(v), toIdx))}>
            <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
            <SelectContent>{monthLabels.map((l, i) => <SelectItem key={i} value={String(i)}>{l}</SelectItem>)}</SelectContent>
          </Select>
          <span className="text-muted-foreground">→</span>
          <Select value={String(toIdx)} items={monthLabels.map((l, i) => ({ value: String(i), label: l }))} onValueChange={(v) => setToIdx(Math.max(Number(v), fromIdx))}>
            <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
            <SelectContent>{monthLabels.map((l, i) => <SelectItem key={i} value={String(i)}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {/* Revenue metrics (client work only) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Contract / backlog value" value={m(t.contract)} icon={WalletIcon} />
        <StatCard label={`Expected · ${windowLabel}`} value={m(windowTotal)} sublabel={`from plan · ${m(t.forecast)} over 12 mo`} icon={TrendingUpIcon} />
        <StatCard label="Earned revenue (accrued)" value={m(t.earned)} sublabel="approved time / % completion" icon={CoinsIcon} />
        <StatCard label="Recognized revenue" value={m(t.recognized)} sublabel="net of issued invoices" icon={ReceiptIcon} />
      </div>

      {/* Earned − invoiced: the month-end accrual and the leakage signal. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Unbilled (WIP)"
          value={m(t.unbilled)}
          sublabel={`earned − invoiced · ${formatNumber(t.unbilledHours)}h approved, not on an invoice`}
          icon={HourglassIcon}
          tone={t.unbilled > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Over-billed"
          value={m(t.overBilled)}
          sublabel="invoiced ahead of delivery (deposits / prepaid)"
          icon={ArrowDownLeftIcon}
        />
        <button onClick={() => router.push("/revenue/unbilled")} className="text-left">
          <StatCard label="Unbilled detail" value="Review →" sublabel="by project, milestone, month & age" icon={SearchIcon} />
        </button>
      </div>

      {/* Operating view: billable gross margin, less overhead, equals operating margin */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Billable gross margin"
          value={m(t.margin)}
          sublabel={`${marginPct != null ? `${formatNumber(marginPct)}% · ` : ""}earned − cost`}
          icon={BanknoteIcon}
          tone={t.margin < 0 ? "destructive" : "default"}
        />
        <StatCard
          label="Forecast margin"
          value={m(t.forecastMargin)}
          sublabel={`${forecastMarginPct != null ? `${formatNumber(forecastMarginPct)}% · ` : ""}if plan delivered`}
          icon={TrendingUpIcon}
          tone={t.forecastMargin < 0 ? "destructive" : "default"}
        />
        <StatCard label="Internal / overhead cost" value={m(overheadCost)} sublabel="non-billable, financed by margin" icon={Building2Icon} tone={overheadCost > 0 ? "warning" : "default"} />
        <StatCard
          label="Operating margin"
          value={m(operatingMargin)}
          sublabel="gross margin − overhead"
          icon={ScaleIcon}
          tone={operatingMargin < 0 ? "destructive" : "default"}
        />
        <StatCard label="Unplanned capacity" value={`${formatNumber(t.unplanned)}h`} sublabel="budget hours not yet scheduled" icon={ClockIcon} />
      </div>

      {/* Time-phased forecast — driven by the global period filter above. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expected revenue over time</CardTitle>
          <p className="text-xs text-muted-foreground">
            From the current delivery plan. The highlighted bars are your selected period (change it in the filter bar,
            or click a month) — scheduled hours × rate (T&amp;M/Retainer), fixed price spread by planned-hours share. Internal work excluded.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border bg-muted/30 px-4 py-3">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Expected · {windowLabel}</span>
            <span className="font-mono text-2xl font-semibold tabular-nums">{m(windowTotal)}</span>
            <span className="text-xs text-muted-foreground">across {windowProjects.length} project{windowProjects.length === 1 ? "" : "s"}</span>
          </div>

          {/* 12-month strip — click a month to focus it; selected window highlighted. */}
          <div>
            <div className="flex items-end gap-1" style={{ height: 96 }}>
              {monthAgg.map((mo, i) => {
                const inWin = i >= lo && i <= hi;
                return (
                  <button
                    key={mo.key}
                    onClick={() => setWindow(i, i)}
                    title={`${mo.label}: ${m(mo.value)}`}
                    className="group flex h-full flex-1 flex-col items-center justify-end gap-1"
                  >
                    <div
                      className={cn("w-full rounded-t transition-colors", inWin ? "bg-primary" : "bg-primary/25 group-hover:bg-primary/40")}
                      style={{ height: `${Math.max(2, (mo.value / maxMonth) * 100)}%` }}
                    />
                  </button>
                );
              })}
            </div>
            <div className="mt-1 flex gap-1">
              {monthAgg.map((mo, i) => (
                <span key={mo.key} className={cn("flex-1 truncate text-center text-[10px]", i >= lo && i <= hi ? "font-medium text-foreground" : "text-muted-foreground")}>
                  {mo.label.slice(0, 3)}
                </span>
              ))}
            </div>
          </div>

          {/* Per-project expected in the selected window */}
          {windowProjects.length > 0 && (
            <div className="overflow-hidden rounded-md border">
              {windowProjects.slice(0, 8).map((p) => (
                <button
                  key={p.projectId}
                  onClick={() => router.push(`/projects/${p.projectId}?tab=overview`)}
                  className="flex w-full items-center gap-3 border-b px-3 py-2 text-left last:border-none hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{p.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{p.client}</div>
                  </div>
                  <span className="shrink-0 font-mono text-sm tabular-nums">{m(p.value)}</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By project</CardTitle>
          <p className="text-xs text-muted-foreground">
            Forecast = planned hours × rate (T&amp;M/Retainer) or contract value (fixed price). Fcst margin = forecast
            revenue − projected cost (planned hours × current cost rate). Earned = approved hours × rate, or % completion
            for fixed price. Recognized = net of issued invoices in the register (credit notes subtract). The earned
            Margin uses each entry&apos;s historical cost rate (EUR) plus any vendor bills booked to the project.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Contract</TableHead>
                  <TableHead className="text-right">Budget h</TableHead>
                  <TableHead className="text-right">Planned h</TableHead>
                  <TableHead className="text-right">Unplanned h</TableHead>
                  <TableHead className="text-right">Approved h</TableHead>
                  <TableHead className="text-right whitespace-nowrap text-primary">Exp. {windowLabel}</TableHead>
                  <TableHead className="text-right">Forecast 12mo</TableHead>
                  <TableHead className="text-right">Fcst margin</TableHead>
                  <TableHead className="text-right">Earned</TableHead>
                  <TableHead className="text-right">Recognized</TableHead>
                  <TableHead className="text-right">Unbilled</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Internal cost</TableHead>
                  <TableHead className="text-right whitespace-nowrap" title="Vendor bills attributed to this project (to pay + paid)">
                    Subcontractor
                  </TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.projectId} className="cursor-pointer" onClick={() => router.push(`/projects/${r.projectId}`)}>
                    <TableCell className="font-medium">
                      {r.projectName}
                      <span className="block text-xs text-muted-foreground">{r.clientName}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{TYPE_LABEL[r.billingType]}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.contractValue, r.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(r.budgetHours)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(r.plannedHours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(r.unplannedHours)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(r.approvedHours)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium text-primary">{formatMoney(winVal(r), r.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatMoney(r.forecastRevenue, r.currency)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", r.forecastMargin < 0 && "text-destructive")}>
                      {formatMoney(r.forecastMargin, r.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.earnedRevenue, r.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.recognizedRevenue, r.currency)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", r.unbilled > 0 && "font-medium text-amber-600")} title={r.unbilledHours > 0 ? `${formatNumber(r.unbilledHours)}h approved, not on an invoice` : undefined}>
                      {formatMoney(r.unbilled, r.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatMoney(r.internalCost, r.currency)}</TableCell>
                    <TableCell
                      className={cn("text-right tabular-nums", r.externalCost > 0 ? "font-medium text-violet-700 dark:text-violet-400" : "text-muted-foreground/50")}
                      title={r.externalCost > 0 ? "Partner / subcontractor bills booked to this project — included in margin" : undefined}
                    >
                      {r.externalCost > 0 ? formatMoney(r.externalCost, r.currency) : "—"}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums font-medium", r.margin < 0 && "text-destructive")}>
                      {formatMoney(r.margin, r.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {(() => {
                        const p = rowMarginPct(r);
                        return p != null ? `${formatNumber(p)}%` : "—";
                      })()}
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={17} className="text-center text-muted-foreground">
                      No revenue projects match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {mixedCurrency && (
            <p className="mt-3 text-xs text-muted-foreground">
              Projects span multiple currencies; the summary totals above add nominal amounts in {defaultCurrency}.
            </p>
          )}
        </CardContent>
      </Card>

      {filteredOverhead.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2Icon className="size-4 text-muted-foreground" /> Internal &amp; overhead
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Internal / non-billable projects — pure cost, no revenue. Financed out of billable gross margin; shown here
              so the overhead is visible, not to imply a per-project loss.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Planned h</TableHead>
                    <TableHead className="text-right">Approved h</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOverhead.map((r) => (
                    <TableRow key={r.projectId} className="cursor-pointer" onClick={() => router.push(`/projects/${r.projectId}`)}>
                      <TableCell className="font-medium">
                        {r.projectName}
                        <span className="block text-xs text-muted-foreground">{r.clientName}</span>
                      </TableCell>
                      <TableCell>
                        {r.isInternal ? <Badge variant="secondary">Internal</Badge> : <Badge variant="outline">Non-billable</Badge>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(r.plannedHours)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(r.approvedHours)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{formatMoney(r.cost, r.currency)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={4} className="text-right font-medium">Total overhead cost</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{m(overheadCost)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
