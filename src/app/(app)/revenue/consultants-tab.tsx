"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ConsultantRow, RealizationPeriodMeta } from "@/lib/realization-data";

export function ConsultantsTab({
  periods,
  byPeriod,
  currency,
}: {
  periods: RealizationPeriodMeta[];
  byPeriod: Record<string, ConsultantRow[]>;
  currency: string;
}) {
  const [periodKey, setPeriodKey] = useState(periods[0]?.key ?? "month");
  const rows = byPeriod[periodKey] ?? [];
  const m = (v: number) => formatMoney(v, currency);
  const h = (v: number) => `${formatNumber(v)}h`;

  const totals = rows.reduce(
    (s, r) => ({ worked: s.worked + r.workedHours, billable: s.billable + r.billableHours, billed: s.billed + r.billedHours, cost: s.cost + r.cost, revenue: s.revenue + r.revenue, margin: s.margin + r.margin }),
    { worked: 0, billable: 0, billed: 0, cost: 0, revenue: 0, margin: 0 },
  );
  const totalRealization = totals.worked > 0 ? (totals.billed / totals.worked) * 100 : 0;
  const totalEffRate = totals.worked > 0 ? totals.revenue / totals.worked : 0;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base">Per consultant</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Realization = billed ÷ worked hours; effective rate = revenue ÷ all worked hours (non-billable &amp; unbilled
            time drags it down). Cost uses each entry&apos;s frozen cost rate; revenue uses the frozen bill rate. All amounts in {currency}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {periods.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriodKey(p.key)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                periodKey === p.key ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Consultant</TableHead>
                <TableHead className="text-right">Worked h</TableHead>
                <TableHead className="text-right">Billable h</TableHead>
                <TableHead className="text-right">Billed h</TableHead>
                <TableHead className="text-right">Realization</TableHead>
                <TableHead className="text-right">Effective rate</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.userId}>
                  <TableCell className="font-medium">{r.userName}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{h(r.workedHours)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{h(r.billableHours)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{h(r.billedHours)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums font-medium", r.realizationPct < 60 ? "text-amber-600" : r.realizationPct >= 85 ? "text-emerald-600" : undefined)}>
                    {formatNumber(r.realizationPct)}%
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m(r.effectiveHourlyRate)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{m(r.cost)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums font-medium", r.margin < 0 && "text-destructive")}>{m(r.margin)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No approved time in this period.</TableCell>
                </TableRow>
              )}
              {rows.length > 0 && (
                <TableRow className="border-t-2">
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{h(Math.round(totals.worked * 100) / 100)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{h(Math.round(totals.billable * 100) / 100)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{h(Math.round(totals.billed * 100) / 100)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{formatNumber(totalRealization)}%</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{m(totalEffRate)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{m(Math.round(totals.cost * 100) / 100)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums font-semibold", totals.margin < 0 && "text-destructive")}>{m(Math.round(totals.margin * 100) / 100)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
