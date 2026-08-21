"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PlusIcon, TargetIcon, TrendingUpIcon, TrophyIcon, GaugeIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/stat-card";
import { formatMoney } from "@/lib/format";
import { STAGE_LABELS, STAGE_TONE, PIPELINE_ORDER, TERMINAL_STAGES } from "@/lib/opportunity";
import type { OpportunityStage, ProjectBillingType } from "@prisma/client";

export type OppRow = {
  id: string;
  name: string;
  number: string | null;
  clientName: string;
  ownerName: string;
  stage: OpportunityStage;
  billingType: ProjectBillingType;
  currency: string;
  probability: number | null;
  expectedCloseDate: string | null;
  gross: number;
  net: number;
  lineCount: number;
  revisionCount: number;
  isWon: boolean;
  projectId: string | null;
};

const OPEN_PIPELINE: OpportunityStage[] = ["QUALIFYING", "PROPOSAL_SENT", "NEGOTIATION", "PENDING_APPROVAL"];

export function OpportunitiesClient({
  rows,
  canManage,
  defaultCurrency,
}: {
  rows: OppRow[];
  canManage: boolean;
  defaultCurrency: string;
}) {
  const router = useRouter();
  const [stageFilter, setStageFilter] = useState<"ALL" | "OPEN" | OpportunityStage>("ALL");
  const [ownerFilter, setOwnerFilter] = useState("ALL");

  const owners = useMemo(() => Array.from(new Set(rows.map((r) => r.ownerName))).sort(), [rows]);

  const filtered = useMemo(() => {
    const byStage = rows.filter((r) => {
      if (stageFilter === "ALL") return true;
      if (stageFilter === "OPEN") return OPEN_PIPELINE.includes(r.stage);
      return r.stage === stageFilter;
    });
    return byStage
      .filter((r) => ownerFilter === "ALL" || r.ownerName === ownerFilter)
      .sort((a, b) => PIPELINE_ORDER.indexOf(a.stage) - PIPELINE_ORDER.indexOf(b.stage) || b.net - a.net);
  }, [rows, stageFilter, ownerFilter]);

  // Pipeline stats (in company currency — mixed-currency deals are summed nominally for an at-a-glance view).
  const openRows = rows.filter((r) => OPEN_PIPELINE.includes(r.stage));
  const openValue = openRows.reduce((s, r) => s + r.net, 0);
  const weighted = openRows.reduce((s, r) => s + (r.net * (r.probability ?? 0)) / 100, 0);
  const wonValue = rows.filter((r) => r.stage === "WON").reduce((s, r) => s + r.net, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Opportunities</h1>
          <p className="text-sm text-muted-foreground">Sales pipeline — quotes convert to projects on win.</p>
        </div>
        {canManage && (
          <Link href="/opportunities/new">
            <Button size="sm">
              <PlusIcon /> New opportunity
            </Button>
          </Link>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open opportunities" value={openRows.length} icon={TargetIcon} />
        <StatCard label="Open pipeline" value={formatMoney(openValue, defaultCurrency)} icon={TrendingUpIcon} />
        <StatCard
          label="Weighted forecast"
          value={formatMoney(weighted, defaultCurrency)}
          sublabel="Σ value × win probability"
          icon={GaugeIcon}
        />
        <StatCard label="Won (all-time)" value={formatMoney(wonValue, defaultCurrency)} icon={TrophyIcon} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">Pipeline</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={stageFilter}
              items={[
                { value: "ALL", label: "All stages" },
                { value: "OPEN", label: "Open only" },
                ...PIPELINE_ORDER.map((s) => ({ value: s, label: STAGE_LABELS[s] })),
              ]}
              onValueChange={(v) => setStageFilter((v as typeof stageFilter) ?? "ALL")}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All stages</SelectItem>
                <SelectItem value="OPEN">Open only</SelectItem>
                {PIPELINE_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={ownerFilter}
              items={[{ value: "ALL", label: "All owners" }, ...owners.map((o) => ({ value: o, label: o }))]}
              onValueChange={(v) => setOwnerFilter(v ?? "ALL")}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All owners</SelectItem>
                {owners.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Value (net)</TableHead>
                <TableHead className="text-right">Win %</TableHead>
                <TableHead>Close</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/opportunities/${r.id}`)}
                >
                  <TableCell className="font-medium">
                    {r.name}
                    {r.number && <span className="block font-mono text-xs font-normal text-muted-foreground">{r.number}</span>}
                  </TableCell>
                  <TableCell>{r.clientName}</TableCell>
                  <TableCell>
                    <Badge variant={STAGE_TONE[r.stage]}>{STAGE_LABELS[r.stage]}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.ownerName}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.net, r.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {TERMINAL_STAGES.includes(r.stage) ? "—" : r.probability != null ? `${r.probability}%` : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.expectedCloseDate ?? "—"}</TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No opportunities match these filters.
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
