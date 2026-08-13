"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { SearchIcon, CalendarRangeIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE } from "@/lib/invoice";
import type { InvoiceStatus } from "@prisma/client";

export type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  isCredit: boolean;
  selfBilled: boolean;
  clientName: string;
  projectName: string | null;
  issueDate: string; // ISO yyyy-MM-dd
  net: number;
  gross: number;
  out: number;
  status: InvoiceStatus;
  fiscalNumber: string | null;
  period: string | null; // display label
  periodStart: string | null; // yyyy-MM-dd
  periodEnd: string | null;
  currency: string;
};

const STATUS_ORDER: InvoiceStatus[] = ["DRAFT", "ISSUED", "RECONCILED", "PAID", "VOID"];

export function InvoicesTable({ rows, clients }: { rows: InvoiceRow[]; clients: string[] }) {
  const [q, setQ] = useState("");
  const [client, setClient] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [month, setMonth] = useState(""); // yyyy-MM — filter by service period overlap

  const statuses = useMemo(() => STATUS_ORDER.filter((s) => rows.some((r) => r.status === s)), [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (client !== "ALL" && r.clientName !== client) return false;
      if (status !== "ALL" && r.status !== status) return false;
      if (month) {
        // Keep invoices whose service period overlaps the chosen month (string compare on ISO dates).
        if (!r.periodStart || !r.periodEnd) return false;
        if (!(r.periodStart <= `${month}-31` && r.periodEnd >= `${month}-01`)) return false;
      }
      if (needle) {
        const hay = [
          r.invoiceNumber,
          r.fiscalNumber ?? "",
          r.clientName,
          r.projectName ?? "",
          r.period ?? "",
          INVOICE_STATUS_LABEL[r.status],
          String(r.net),
          String(r.gross),
          String(Math.abs(r.net)),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, client, status, month]);

  const m = (v: number, cur: string) => formatMoney(v, cur);
  const cur = rows[0]?.currency ?? "EUR";
  const filteredNet = filtered.reduce((s, r) => s + r.net, 0);
  const active = client !== "ALL" || status !== "ALL" || month !== "" || q.trim() !== "";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-56">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search number, fiscal #, client, amount…"
            className="pl-8"
          />
        </div>
        <Select value={client} items={[{ value: "ALL", label: "All clients" }, ...clients.map((c) => ({ value: c, label: c }))]} onValueChange={(v) => setClient(v ?? "ALL")}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All clients</SelectItem>
            {clients.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} items={[{ value: "ALL", label: "All statuses" }, ...statuses.map((s) => ({ value: s, label: INVOICE_STATUS_LABEL[s] }))]} onValueChange={(v) => setStatus(v ?? "ALL")}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {statuses.map((s) => <SelectItem key={s} value={s}>{INVOICE_STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <CalendarRangeIcon className="size-4 text-muted-foreground" />
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" title="Service period month" />
        </div>
        {active && (
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); setClient("ALL"); setStatus("ALL"); setMonth(""); }}>
            <XIcon className="size-3.5 mr-1" /> Clear
          </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Service period</TableHead>
              <TableHead>Client / Project</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead>Fiscal #</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id} className="hover:bg-muted/40">
                <TableCell>
                  <Link href={`/invoices/${r.id}`} className="font-medium hover:underline">{r.invoiceNumber}</Link>
                  <div className="flex items-center gap-1 mt-0.5">
                    {r.isCredit && <Badge variant="destructive" className="text-[9px] px-1 py-0">Credit</Badge>}
                    {r.selfBilled && <span className="text-[10px] text-muted-foreground">self-billed</span>}
                  </div>
                </TableCell>
                <TableCell>
                  {r.period ? (
                    <span className="inline-flex items-center gap-1 text-sm"><CalendarRangeIcon className="size-3.5 text-muted-foreground shrink-0" />{r.period}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="text-sm">{r.clientName}</div>
                  {r.projectName && <div className="text-[11px] text-muted-foreground truncate max-w-56">{r.projectName}</div>}
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">{format(parseISO(r.issueDate), "MMM d, yyyy")}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">{m(r.net, r.currency)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{m(r.gross, r.currency)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.status === "VOID" ? <span className="text-muted-foreground">—</span> : r.out > 0 ? <span className="text-amber-600">{m(r.out, r.currency)}</span> : <span className="text-muted-foreground">{m(0, r.currency)}</span>}
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{r.fiscalNumber ?? "—"}</TableCell>
                <TableCell><Badge variant={INVOICE_STATUS_TONE[r.status]}>{INVOICE_STATUS_LABEL[r.status]}</Badge></TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  {rows.length === 0 ? "No invoices yet." : "No invoices match these filters."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{filtered.length} of {rows.length} {rows.length === 1 ? "invoice" : "invoices"}</span>
        {active && <span className="tabular-nums">Filtered net: <span className="font-medium text-foreground">{m(filteredNet, cur)}</span></span>}
      </div>
    </div>
  );
}
