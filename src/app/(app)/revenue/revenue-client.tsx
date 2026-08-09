"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { WalletIcon, TrendingUpIcon, CoinsIcon, ClockIcon, BanknoteIcon, ReceiptIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/stat-card";
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
};

const TYPE_LABEL: Record<ProjectBillingType, string> = {
  TIME_AND_MATERIALS: "T&M",
  FIXED_PRICE: "Fixed price",
  RETAINER: "Retainer",
};

export function RevenueClient({ rows, defaultCurrency }: { rows: RevenueRow[]; defaultCurrency: string }) {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState<"ALL" | ProjectBillingType>("ALL");
  const [clientFilter, setClientFilter] = useState("ALL");

  const clients = useMemo(() => Array.from(new Set(rows.map((r) => r.clientName))).sort(), [rows]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (typeFilter !== "ALL" && r.billingType !== typeFilter) return false;
        if (clientFilter !== "ALL" && r.clientName !== clientFilter) return false;
        return true;
      }),
    [rows, typeFilter, clientFilter],
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
    };
  }, [filtered]);

  const mixedCurrency = new Set(filtered.map((r) => r.currency)).size > 1;
  const m = (v: number) => formatMoney(v, defaultCurrency);
  // Gross margin % against earned revenue (undefined when nothing earned yet).
  const marginPct = t.earned > 0 ? (t.margin / t.earned) * 100 : null;
  const rowMarginPct = (r: RevenueRow) => (r.earnedRevenue > 0 ? (r.margin / r.earnedRevenue) * 100 : null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Revenue &amp; forecast</h1>
          <p className="text-sm text-muted-foreground">
            Backlog, plan-based forecast, and earned revenue from approved time — across your projects.
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Contract / backlog value" value={m(t.contract)} icon={WalletIcon} />
        <StatCard label="Forecast revenue" value={m(t.forecast)} sublabel="expected from plan / contract" icon={TrendingUpIcon} />
        <StatCard label="Earned revenue (accrued)" value={m(t.earned)} sublabel="approved time / % completion" icon={CoinsIcon} />
        <StatCard label="Recognized revenue" value={m(t.recognized)} sublabel="billing-complete work" icon={ReceiptIcon} />
        <StatCard label="Unplanned capacity" value={`${formatNumber(t.unplanned)}h`} sublabel="budget hours not yet scheduled" icon={ClockIcon} />
        <StatCard
          label="Margin (earned − cost)"
          value={m(t.margin)}
          sublabel={`${marginPct != null ? `${formatNumber(marginPct)}% margin · ` : ""}cost ${m(t.cost)}`}
          icon={BanknoteIcon}
          tone={t.margin < 0 ? "destructive" : "default"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By project</CardTitle>
          <p className="text-xs text-muted-foreground">
            Forecast = planned hours × rate (T&amp;M/Retainer) or contract value (fixed price). Earned = approved hours ×
            rate, or % completion for fixed price. Recognized = net of issued invoices in the register (credit notes
            subtract). Cost uses snapshot cost rates (EUR).
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
                    <TableCell colSpan={12} className="text-center text-muted-foreground">
                      No projects match these filters.
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
    </div>
  );
}
