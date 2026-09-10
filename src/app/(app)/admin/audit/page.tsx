import Link from "next/link";
import { format } from "date-fns";
import { DownloadIcon, HistoryIcon, LockIcon, SearchIcon } from "lucide-react";
import { requirePermission } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { AUDIT_ENTITY_TYPES, loadAuditLog, parseAuditFilter } from "@/lib/audit";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FieldLine } from "@/components/audit-history-card";

// /admin/audit — the company-wide change log. Gated on audit:view (Admin). Filters are plain GET
// params so a filtered view is a shareable URL and the XLSX export takes the same query string.
// Rows are read-only by design: there is no action on this page, and the table's DB trigger
// rejects UPDATE/DELETE anyway.

const ACTION_TONE: Record<string, string> = {
  create: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  update: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  delete: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
};
const ACTION_LABEL: Record<string, string> = { create: "Created", update: "Changed", delete: "Removed" };

const ENTITY_HREF: Record<string, (id: string) => string> = {
  Invoice: (id) => `/invoices/${id}`,
  Project: (id) => `/projects/${id}`,
  Opportunity: (id) => `/opportunities/${id}`,
};

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission("audit:view");
  const sp = await searchParams;
  const filter = parseAuditFilter(sp);

  const [entries, actors] = await Promise.all([
    loadAuditLog(user, filter, 500),
    // Anyone who has ever written an audit row, plus active users — a deleted actor still filters.
    prisma.user.findMany({ where: { companyId: user.companyId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const anyRedacted = entries.some((e) => e.redacted);

  const qs = new URLSearchParams();
  if (filter.entityType) qs.set("entity", filter.entityType);
  if (filter.actorId) qs.set("actor", filter.actorId);
  if (filter.fromStr) qs.set("from", filter.fromStr);
  if (filter.toStr) qs.set("to", filter.toStr);
  if (filter.q) qs.set("q", filter.q);
  const exportHref = `/api/admin/audit/export${qs.size ? `?${qs.toString()}` : ""}`;

  const control =
    "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <HistoryIcon className="size-5 text-muted-foreground" /> Audit log
          </h1>
          <p className="text-sm text-muted-foreground">
            Who changed what, when, and from what. Entries are written in the same transaction as the change and can never be edited or removed.
            {anyRedacted && (
              <span className="ml-1 inline-flex items-center gap-1"><LockIcon className="size-3" /> Amounts are hidden for your role.</span>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" render={<a href={exportHref} />}>
          <DownloadIcon className="size-4" /> Export XLSX
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Entity
              <select name="entity" defaultValue={filter.entityType ?? ""} className={control}>
                <option value="">All</option>
                {AUDIT_ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Actor
              <select name="actor" defaultValue={filter.actorId ?? ""} className={control}>
                <option value="">Anyone</option>
                {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              From
              <input type="date" name="from" defaultValue={filter.fromStr} className={control} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              To
              <input type="date" name="to" defaultValue={filter.toStr} className={control} />
            </label>
            <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-muted-foreground">
              Search summary
              <input type="search" name="q" defaultValue={filter.q ?? ""} placeholder="INV-0003, status, Rollout…" className={control} />
            </label>
            <Button type="submit" size="sm"><SearchIcon className="size-4" /> Apply</Button>
            {(filter.entityType || filter.actorId || filter.fromStr || filter.toStr || filter.q) && (
              <Button variant="ghost" size="sm" render={<Link href="/admin/audit" />}>Clear</Button>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Record</TableHead>
                <TableHead>Changes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No entries match these filters.</TableCell>
                </TableRow>
              )}
              {entries.map((e) => {
                const href = ENTITY_HREF[e.entityType]?.(e.entityId);
                const fields = Object.entries(e.fields);
                return (
                  <TableRow key={e.id} className="align-top">
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">{format(new Date(e.at), "MMM d, yyyy HH:mm:ss")}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{e.actorName}</TableCell>
                    <TableCell><Badge variant="outline" className={ACTION_TONE[e.action] ?? ""}>{ACTION_LABEL[e.action] ?? e.action}</Badge></TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium">{e.entityType}</div>
                      {e.label && (
                        href ? <Link href={href} className="text-xs text-muted-foreground hover:underline">{e.label}</Link>
                             : <div className="text-xs text-muted-foreground">{e.label}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {fields.length === 0 ? (
                        <span className="text-muted-foreground">{e.summary}</span>
                      ) : (
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                          {fields.map(([name, c]) => (
                            <FieldLine key={name} name={name} from={c.from} to={c.to} action={e.action} />
                          ))}
                        </dl>
                      )}
                      {e.redacted && <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground"><LockIcon className="size-3" /> amounts hidden</div>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {entries.length >= 500 && (
            <p className="px-6 py-3 text-xs text-muted-foreground">Showing the latest 500 entries — narrow the filters or export to see everything.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
