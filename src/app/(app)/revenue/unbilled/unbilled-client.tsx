"use client";

import { Fragment, useMemo, useState } from "react";
import { BackLink } from "@/components/back-link";
import { DownloadIcon, XIcon, TriangleAlertIcon, HourglassIcon, ClockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/stat-card";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { groupUnbilled, summarizeAge, type UnbilledEntry } from "@/lib/wip";
import { RematchButton } from "./rematch-button";

const BUCKET_TONE: Record<string, string> = {
  "0-30": "text-muted-foreground",
  "31-60": "text-foreground",
  "61-90": "text-amber-600",
  "90+": "text-destructive",
};

/** Rows older than this are the ones this view exists to surface. */
const STALE_DAYS = 90;

export function UnbilledClient({ entries, currency, canRematch }: { entries: UnbilledEntry[]; currency: string; canRematch: boolean }) {
  const [client, setClient] = useState("ALL");
  const [projectId, setProjectId] = useState("ALL");
  const [month, setMonth] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const clients = useMemo(() => Array.from(new Set(entries.map((e) => e.clientName))).sort(), [entries]);
  const projects = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entries) if (client === "ALL" || e.clientName === client) m.set(e.projectId, e.projectName);
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, client]);

  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (client !== "ALL" && e.clientName !== client) return false;
        if (projectId !== "ALL" && e.projectId !== projectId) return false;
        if (month && e.month !== month) return false;
        return true;
      }),
    [entries, client, projectId, month],
  );

  const groups = useMemo(() => groupUnbilled(filtered), [filtered]);
  const buckets = useMemo(() => summarizeAge(filtered), [filtered]);
  const totalValue = filtered.reduce((s, e) => s + e.value, 0);
  const totalHours = filtered.reduce((s, e) => s + e.hours, 0);
  const stale = filtered.filter((e) => e.ageDays > STALE_DAYS);
  const staleValue = stale.reduce((s, e) => s + e.value, 0);
  const oldest = filtered.reduce((mx, e) => Math.max(mx, e.ageDays), 0);
  const active = client !== "ALL" || projectId !== "ALL" || month !== "";
  const m = (v: number) => formatMoney(v, currency);

  const exportUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (client !== "ALL") p.set("client", client);
    if (projectId !== "ALL") p.set("projectId", projectId);
    if (month) p.set("month", month);
    const qs = p.toString();
    return `/api/revenue/unbilled/export${qs ? `?${qs}` : ""}`;
  }, [client, projectId, month]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const maxBucket = Math.max(1, ...buckets.map((b) => b.value));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <BackLink href="/revenue" label="Revenue" />
          <h1 className="mt-1 text-2xl font-semibold">Unbilled work (WIP)</h1>
          <p className="text-sm text-muted-foreground">
            Approved, billable time that isn&apos;t on an invoice yet — valued at the bill rate frozen at approval. This is
            the month-end accrual, and anything old here is revenue quietly leaking. Time-billed work only (T&amp;M and
            retainer): fixed-price milestones are a lump sum, not an hourly rate, so their unbilled value shows on the
            Revenue report as earned minus invoiced instead.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canRematch && <RematchButton />}
          <a href={exportUrl}>
            <Button size="sm" variant="outline"><DownloadIcon className="size-3.5" /> Export XLSX</Button>
          </a>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Unbilled value" value={m(totalValue)} icon={HourglassIcon} tone={totalValue > 0 ? "warning" : "default"} sublabel={`${formatNumber(totalHours)}h across ${groups.length} project${groups.length === 1 ? "" : "s"}`} />
        <StatCard label={`Older than ${STALE_DAYS} days`} value={m(staleValue)} icon={TriangleAlertIcon} tone={staleValue > 0 ? "destructive" : "default"} sublabel={`${stale.length} entr${stale.length === 1 ? "y" : "ies"}`} />
        <StatCard label="Oldest entry" value={oldest > 0 ? `${oldest} days` : "—"} icon={ClockIcon} tone={oldest > STALE_DAYS ? "destructive" : "default"} sublabel="age of the longest-waiting hour" />
        <StatCard label="Entries" value={filtered.length} icon={ClockIcon} sublabel="approved, not invoiced" />
      </div>

      {/* Age of unbilled work */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Age of unbilled work</CardTitle>
          <p className="text-xs text-muted-foreground">By entry date. Work sitting past {STALE_DAYS} days is at real risk of never being billed.</p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            {buckets.map((b) => (
              <div key={b.key} className="flex items-center gap-3">
                <span className={cn("w-24 shrink-0 text-sm", BUCKET_TONE[b.key])}>{b.label}</span>
                <div className="h-5 min-w-0 flex-1 overflow-hidden rounded bg-muted">
                  <div
                    className={cn("h-full rounded", b.key === "90+" ? "bg-destructive" : b.key === "61-90" ? "bg-amber-500" : "bg-primary/50")}
                    style={{ width: `${Math.max(b.value > 0 ? 2 : 0, (b.value / maxBucket) * 100)}%` }}
                  />
                </div>
                <span className="w-28 shrink-0 text-right font-mono text-sm tabular-nums">{m(b.value)}</span>
                <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{formatNumber(b.hours)}h</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
        <Select value={client} items={[{ value: "ALL", label: "All clients" }, ...clients.map((c) => ({ value: c, label: c }))]} onValueChange={(v) => { setClient(v ?? "ALL"); setProjectId("ALL"); }}>
          <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All clients</SelectItem>
            {clients.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={projectId} items={[{ value: "ALL", label: "All projects" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} onValueChange={(v) => setProjectId(v ?? "ALL")}>
          <SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All projects</SelectItem>
            {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-8 w-40" title="Entry month" />
        {active && <Button variant="ghost" size="sm" onClick={() => { setClient("ALL"); setProjectId("ALL"); setMonth(""); }}><XIcon className="mr-1 size-3.5" /> Clear</Button>}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} of {entries.length} entries</span>
      </div>

      {/* Project → milestone → month */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">By project, milestone &amp; month</CardTitle>
          <p className="text-xs text-muted-foreground">Click a project to expand its milestones. &ldquo;Oldest&rdquo; is the age of the longest-waiting entry in that group.</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project / milestone / month</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Oldest</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((p) => {
                  const open = expanded.has(p.projectId);
                  return (
                    <Fragment key={p.projectId}>
                      <TableRow className="cursor-pointer bg-muted/30 hover:bg-muted/50" onClick={() => toggle(p.projectId)}>
                        <TableCell className="font-medium">
                          <span className="mr-1.5 inline-block w-3 text-muted-foreground">{open ? "▾" : "▸"}</span>
                          {p.projectName}
                          <span className="block pl-[1.125rem] text-xs text-muted-foreground">{p.clientName}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(p.hours)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{m(p.value)}</TableCell>
                        <TableCell className={cn("text-right tabular-nums", p.oldestAgeDays > STALE_DAYS && "font-medium text-destructive")}>{p.oldestAgeDays}d</TableCell>
                      </TableRow>
                      {open &&
                        p.milestones.map((ms) => (
                          <Fragment key={`${p.projectId}-${ms.milestoneId}`}>
                            <TableRow>
                              <TableCell className="pl-10 text-sm">{ms.milestoneName}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(ms.hours)}</TableCell>
                              <TableCell className="text-right tabular-nums">{m(ms.value)}</TableCell>
                              <TableCell className={cn("text-right tabular-nums text-muted-foreground", ms.oldestAgeDays > STALE_DAYS && "font-medium text-destructive")}>{ms.oldestAgeDays}d</TableCell>
                            </TableRow>
                            {ms.months.map((mo) => (
                              <TableRow key={`${p.projectId}-${ms.milestoneId}-${mo.month}`}>
                                <TableCell className="pl-16 text-xs text-muted-foreground">{mo.month} · {mo.entries} entr{mo.entries === 1 ? "y" : "ies"}</TableCell>
                                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{formatNumber(mo.hours)}</TableCell>
                                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{m(mo.value)}</TableCell>
                                <TableCell className={cn("text-right text-xs tabular-nums text-muted-foreground", mo.oldestAgeDays > STALE_DAYS && "font-medium text-destructive")}>{mo.oldestAgeDays}d</TableCell>
                              </TableRow>
                            ))}
                          </Fragment>
                        ))}
                    </Fragment>
                  );
                })}
                {groups.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                      {entries.length === 0 ? "Nothing unbilled — every approved hour is on an invoice. 🎉" : "No unbilled work matches these filters."}
                    </TableCell>
                  </TableRow>
                )}
                {groups.length > 0 && (
                  <TableRow className="border-t-2">
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatNumber(Math.round(totalHours * 100) / 100)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{m(Math.round(totalValue * 100) / 100)}</TableCell>
                    <TableCell />
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
