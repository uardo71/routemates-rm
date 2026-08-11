"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { WalletIcon, TrendingUpIcon, CoinsIcon, ClockIcon, BanknoteIcon, ReceiptIcon, ScaleIcon, Building2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/stat-card";
import { MiniBarChart } from "@/components/charts/mini-bar-chart";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProjectBillingType } from "@prisma/client";

export type RevenueRow = {
  projectId: string;
  projectName: string;
  clientName: string;
  billingType: ProjectBillingType;
  currency: string;
  contractValue: number;
  budgetHours: number;
  plannedHours: number;
  approvedHours: number;
  unplannedHours: number;
  forecastRevenue: number;
  earnedRevenue: number;
  recognizedRevenue: number;
  cost: number;
  margin: number;
  /** Projected cost of the whole plan (planned hours × current cost rate). */
  forecastCost: number;
  /** Projected margin if the plan is delivered (forecast revenue − forecast cost). */
  forecastMargin: number;
  /** Time-phased forecast revenue for the next 4 quarters (index-aligned to quarterLabels). */
  quarterly: number[];
};

// Internal / non-revenue projects: pure cost (overhead), shown separately with no margin.
export type OverheadRow = {
  projectId: string;
  projectName: string;
  clientName: string;
  billingType: ProjectBillingType;
  currency: string;
  isInternal: boolean;
  plannedHours: number;
  approvedHours: number;
  cost: number;
};

const TYPE_LABEL: Record<ProjectBillingType, string> = {
  TIME_AND_MATERIALS: "T&M",
  FIXED_PRICE: "Fixed price",
  RETAINER: "Retainer",
};

export function RevenueClient({
  rows,
  overhead,
  quarterLabels,
  defaultCurrency,
}: {
  rows: RevenueRow[];
  overhead: OverheadRow[];
  quarterLabels: string[];
  defaultCurrency: string;
}) {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState<"ALL" | ProjectBillingType>("ALL");
  const [clientFilter, setClientFilter] = useState("ALL");

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
      cost: sum((r) => r.cost),
      margin: sum((r) => r.margin),
      forecastCost: sum((r) => r.forecastCost),
      forecastMargin: sum((r) => r.forecastMargin),
    };
  }, [filtered]);

  const overheadCost = useMemo(() => filteredOverhead.reduce((s, r) => s + r.cost, 0), [filteredOverhead]);
  const operatingMargin = t.margin - overheadCost;

  // Time-phased forecast, aggregated across the filtered revenue projects.
  const forecastData = useMemo(
    () => quarterLabels.map((label, i) => ({ label, value: Math.round(filtered.reduce((s, r) => s + (r.quarterly[i] ?? 0), 0) * 100) / 100 })),
    [filtered, quarterLabels],
  );

  const mixedCurrency = new Set([...filtered, ...filteredOverhead].map((r) => r.currency)).size > 1;
  const m = (v: number) => formatMoney(v, defaultCurrency);
  // Gross margin % against earned revenue (undefined when nothing earned yet).
  const marginPct = t.earned > 0 ? (t.margin / t.earned) * 100 : null;
  const rowMarginPct = (r: RevenueRow) => (r.earnedRevenue > 0 ? (r.margin / r.earnedRevenue) * 100 : null);
  // Forecast (projected) margin % against forecast revenue.
  const forecastMarginPct = t.forecast > 0 ? (t.forecastMargin / t.forecast) * 100 : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Revenue &amp; forecast</h1>
          <p className="text-sm text-muted-foreground">
            Backlog, plan-based forecast, and earned revenue from client work — with internal cost shown separately.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
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
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All clients</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Revenue metrics (client work only) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Contract / backlog value" value={m(t.contract)} icon={WalletIcon} />
        <StatCard label="Forecast revenue" value={m(t.forecast)} sublabel="expected from plan / contract" icon={TrendingUpIcon} />
        <StatCard label="Earned revenue (accrued)" value={m(t.earned)} sublabel="approved time / % completion" icon={CoinsIcon} />
        <StatCard label="Recognized revenue" value={m(t.recognized)} sublabel="net of issued invoices" icon={ReceiptIcon} />
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

      {/* Time-phased forecast */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Forecast by quarter</CardTitle>
          <p className="text-xs text-muted-foreground">
            Expected revenue from the current delivery plan over the next 4 quarters — scheduled hours × rate (T&amp;M/Retainer),
            fixed-price spread by planned-hours share. Internal work excluded.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <MiniBarChart data={forecastData} height={120} valueFormatter={m} />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {forecastData.map((f) => (
              <div key={f.label} className="flex flex-col rounded-md border p-2">
                <span className="text-xs text-muted-foreground">{f.label}</span>
                <span className="text-sm font-medium tabular-nums">{m(f.value)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By project</CardTitle>
          <p className="text-xs text-muted-foreground">
            Forecast = planned hours × rate (T&amp;M/Retainer) or contract value (fixed price). Fcst margin = forecast
            revenue − projected cost (planned hours × current cost rate). Earned = approved hours × rate, or % completion
            for fixed price. Recognized = net of issued invoices in the register (credit notes subtract). The earned
            Margin uses each entry&apos;s historical cost rate (EUR).
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
                  <TableHead className="text-right">Forecast</TableHead>
                  <TableHead className="text-right">Fcst margin</TableHead>
                  <TableHead className="text-right">Earned</TableHead>
                  <TableHead className="text-right">Recognized</TableHead>
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
                    <TableCell className="text-right tabular-nums">{formatMoney(r.forecastRevenue, r.currency)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", r.forecastMargin < 0 && "text-destructive")}>
                      {formatMoney(r.forecastMargin, r.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.earnedRevenue, r.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.recognizedRevenue, r.currency)}</TableCell>
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
                    <TableCell colSpan={13} className="text-center text-muted-foreground">
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
