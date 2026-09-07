"use client";

import { Fragment, useMemo, useState } from "react";
import { WalletIcon, ClockIcon, PiggyBankIcon, CoinsIcon, AlertTriangleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/stat-card";
import { formatMoney, formatNumber } from "@/lib/format";
import { budgetMetrics, type BudgetInput } from "@/lib/budget";
import { cn } from "@/lib/utils";
import type { ProjectBillingType } from "@prisma/client";

export type MilestoneNode = { id: string; name: string; budgetHours: number; actualHours: number; budgetCost: number; actualCost: number;
  /** Of `actualCost`, the part that is subcontractor bills rather than our own people's time. */
  externalCost: number };
export type ProjectNode = {
  id: string;
  name: string;
  billingType: ProjectBillingType;
  budgetHours: number;
  actualHours: number;
  budgetCost: number;
  actualCost: number;
  /** Of `actualCost`, the part that is subcontractor bills rather than our own people's time. */
  externalCost: number;
  milestones: MilestoneNode[];
};
export type ClientNode = { id: string; name: string; projects: ProjectNode[] };

const TYPE_LABEL: Record<ProjectBillingType, string> = {
  TIME_AND_MATERIALS: "T&M",
  FIXED_PRICE: "Fixed price",
  RETAINER: "Retainer",
};

function sumInputs(rows: BudgetInput[]): BudgetInput {
  return rows.reduce(
    (a, r) => ({
      budgetHours: a.budgetHours + r.budgetHours,
      actualHours: a.actualHours + r.actualHours,
      budgetCost: a.budgetCost + r.budgetCost,
      actualCost: a.actualCost + r.actualCost,
    }),
    { budgetHours: 0, actualHours: 0, budgetCost: 0, actualCost: 0 },
  );
}

// The budget/actual/variance/used% cells shared by every row level (client/project/milestone).
function MetricCells({ row, currency, externalCost = 0 }: { row: BudgetInput; currency: string; externalCost?: number }) {
  const m = budgetMetrics(row);
  return (
    <>
      <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(m.budgetHours)}</TableCell>
      <TableCell className={cn("text-right tabular-nums", m.overHours && "text-destructive font-medium")}>{formatNumber(m.actualHours)}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{formatMoney(m.budgetCost, currency)}</TableCell>
      <TableCell
        className={cn("text-right tabular-nums", m.overCost && "text-destructive font-medium")}
        title={externalCost > 0 ? `Includes ${formatMoney(externalCost, currency)} of subcontractor bills` : undefined}
      >
        {formatMoney(m.actualCost, currency)}
        {externalCost > 0 && (
          <span className="ml-1 text-[10px] font-normal text-violet-700 dark:text-violet-400">
            (+{formatMoney(externalCost, currency)} ext.)
          </span>
        )}
      </TableCell>
      <TableCell
        className={cn(
          "text-right tabular-nums",
          m.costVariance == null ? "text-muted-foreground" : m.costVariance < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {m.costVariance == null ? "—" : formatMoney(m.costVariance, currency)}
      </TableCell>
      <TableCell className={cn("text-right tabular-nums", m.overCost && "text-destructive font-medium")}>
        {m.costUsedPct == null ? <span className="text-muted-foreground">—</span> : `${formatNumber(m.costUsedPct)}%`}
      </TableCell>
    </>
  );
}

export function BudgetsClient({ clients, currency }: { clients: ClientNode[]; currency: string }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [typeFilter, setTypeFilter] = useState<"ALL" | ProjectBillingType>("ALL");
  const [clientFilter, setClientFilter] = useState("ALL");

  const filtered = useMemo(() => {
    return clients
      .filter((c) => clientFilter === "ALL" || c.id === clientFilter)
      .map((c) => ({ ...c, projects: c.projects.filter((p) => typeFilter === "ALL" || p.billingType === typeFilter) }))
      .filter((c) => c.projects.length > 0);
  }, [clients, clientFilter, typeFilter]);

  const allProjects = useMemo(() => filtered.flatMap((c) => c.projects), [filtered]);
  const totals = useMemo(() => budgetMetrics(sumInputs(allProjects)), [allProjects]);
  const overBudgetCount = useMemo(() => allProjects.filter((p) => p.budgetCost > 0 && p.actualCost > p.budgetCost).length, [allProjects]);

  const m = (v: number) => formatMoney(v, currency);
  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
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
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            <SelectItem value="TIME_AND_MATERIALS">T&amp;M</SelectItem>
            <SelectItem value="FIXED_PRICE">Fixed price</SelectItem>
            <SelectItem value="RETAINER">Retainer</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={clientFilter}
          items={[{ value: "ALL", label: "All clients" }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
          onValueChange={(v) => setClientFilter(v ?? "ALL")}
        >
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All clients</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Budgeted cost" value={m(totals.budgetCost)} icon={PiggyBankIcon} />
        <StatCard
          label="Actual cost"
          value={m(totals.actualCost)}
          sublabel={totals.costUsedPct == null ? "no cost budget set" : `${formatNumber(totals.costUsedPct)}% of budget`}
          icon={CoinsIcon}
          tone={totals.overCost ? "destructive" : "default"}
        />
        <StatCard
          label="Remaining budget"
          value={totals.costVariance == null ? "—" : m(totals.costVariance)}
          sublabel={totals.costVariance == null ? "no cost budget set" : "budget − actual"}
          icon={WalletIcon}
          tone={totals.costVariance != null && totals.costVariance < 0 ? "destructive" : "default"}
        />
        <StatCard label="Budgeted hours" value={`${formatNumber(totals.budgetHours)}h`} icon={ClockIcon} />
        <StatCard
          label="Actual hours"
          value={`${formatNumber(totals.actualHours)}h`}
          sublabel={totals.hoursUsedPct == null ? "no hour budget set" : `${formatNumber(totals.hoursUsedPct)}% of budget`}
          icon={ClockIcon}
          tone={totals.overHours ? "warning" : "default"}
        />
        <StatCard
          label="Over-budget projects"
          value={overBudgetCount}
          sublabel="actual cost exceeds budget"
          icon={AlertTriangleIcon}
          tone={overBudgetCount > 0 ? "warning" : "default"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By client → project → milestone</CardTitle>
          <p className="text-xs text-muted-foreground">
            Budget cost is each milestone&apos;s entered budgeted cost, or — when none is set — an implied projection
            (allocated hours × current cost rate). Actual cost is approved hours × the cost rate in effect when each
            entry was worked. Rows in red are over budget. Click a client or project to expand.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Budget h</TableHead>
                  <TableHead className="text-right">Actual h</TableHead>
                  <TableHead className="text-right">Budget cost</TableHead>
                  <TableHead className="text-right">Actual cost</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead className="text-right">Used %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => {
                  const cOpen = expanded[c.id] ?? false;
                  const cTotals = sumInputs(c.projects);
                  return (
                    <Fragment key={c.id}>
                      <TableRow className="cursor-pointer bg-muted/30" onClick={() => toggle(c.id)}>
                        <TableCell className="font-semibold">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={cn("text-muted-foreground text-xs transition-transform", cOpen && "rotate-90")}>▸</span>
                            {c.name}
                            <span className="font-normal text-muted-foreground">({c.projects.length})</span>
                          </span>
                        </TableCell>
                        <MetricCells row={cTotals} currency={currency} />
                      </TableRow>

                      {cOpen &&
                        c.projects.map((p) => {
                          const pOpen = expanded[p.id] ?? false;
                          return (
                            <Fragment key={p.id}>
                              <TableRow className="cursor-pointer" onClick={() => toggle(p.id)}>
                                <TableCell className="pl-6 font-medium">
                                  <span className="inline-flex items-center gap-1.5">
                                    <span className={cn("text-muted-foreground text-xs transition-transform", p.milestones.length > 0 && pOpen && "rotate-90", p.milestones.length === 0 && "opacity-0")}>▸</span>
                                    {p.name}
                                    <Badge variant="outline" className="text-[10px]">{TYPE_LABEL[p.billingType]}</Badge>
                                  </span>
                                </TableCell>
                                <MetricCells row={p} currency={currency} externalCost={p.externalCost} />
                              </TableRow>

                              {pOpen &&
                                p.milestones.map((ms) => (
                                  <TableRow key={ms.id}>
                                    <TableCell className="pl-12 text-muted-foreground">{ms.name}</TableCell>
                                    <MetricCells row={ms} currency={currency} externalCost={ms.externalCost} />
                                  </TableRow>
                                ))}
                              {pOpen && p.milestones.length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={7} className="pl-12 text-xs text-muted-foreground">No milestones.</TableCell>
                                </TableRow>
                              )}
                            </Fragment>
                          );
                        })}
                    </Fragment>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No projects match these filters.</TableCell>
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
