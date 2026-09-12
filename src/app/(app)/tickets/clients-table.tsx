"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownIcon, ArrowUpIcon, SearchIcon, UsersIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { InitialsAvatar } from "@/components/initials-avatar";
import { cn } from "@/lib/utils";
import {
  OVERVIEW_FOCUS_LABEL, filterClients, lastActivityLabel, needsAttention, sortClients, summarize,
  type ClientRow, type ClientSortKey, type OverviewFocus,
} from "@/lib/support-overview";

// The Support landing table. This replaced a card grid that was unusable past a couple of dozen
// accounts - the same call already made for /portfolio. Dense, worst first, every chip a filter and
// every number a link into exactly those tickets.

const COLS: { key: ClientSortKey; label: string; align?: "right"; hide?: string }[] = [
  { key: "name", label: "Client" },
  { key: "open", label: "Open", align: "right" },
  { key: "breached", label: "Breached", align: "right" },
  { key: "unassigned", label: "Unassigned", align: "right" },
  { key: "critical", label: "Critical", align: "right" },
  { key: "oldest", label: "Oldest open", align: "right", hide: "hidden lg:table-cell" },
  { key: "resolved7d", label: "Resolved 7d", align: "right", hide: "hidden xl:table-cell" },
  { key: "lastActivity", label: "Last activity", hide: "hidden md:table-cell" },
];

const FOCUSES: OverviewFocus[] = ["attention", "breached", "unassigned", "critical", "quiet"];

export function ClientsTable({ rows, nowMs }: { rows: ClientRow[]; nowMs: number }) {
  const router = useRouter();
  // Seeded from the URL at first render, so a shared or bookmarked link opens the same view.
  const params = useSearchParams();
  const seedFocus = params.get("focus") as OverviewFocus | null;
  const seedSort = params.get("sort") as ClientSortKey | null;
  const [focus, setFocus] = React.useState<OverviewFocus | null>(seedFocus && FOCUSES.includes(seedFocus) ? seedFocus : null);
  const [q, setQ] = React.useState(params.get("q") ?? "");
  const [sort, setSort] = React.useState<{ key: ClientSortKey; dir: "asc" | "desc" }>(
    seedSort ? { key: seedSort, dir: params.get("dir") === "asc" ? "asc" : "desc" } : { key: "attention", dir: "desc" },
  );

  // Mirror the view into the URL so opening an account and coming back lands you where you were.
  React.useEffect(() => {
    const p = new URLSearchParams();
    if (focus) p.set("focus", focus);
    if (q.trim()) p.set("q", q.trim());
    if (sort.key !== "attention" || sort.dir !== "desc") { p.set("sort", sort.key); p.set("dir", sort.dir); }
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `/tickets?${qs}` : "/tickets");
  }, [focus, q, sort]);

  const summary = React.useMemo(() => summarize(rows), [rows]);
  const shown = React.useMemo(() => sortClients(filterClients(rows, { focus, q }), sort.key, sort.dir), [rows, focus, q, sort]);

  const head = (c: (typeof COLS)[number]) => {
    const on = sort.key === c.key;
    return (
      <th key={c.key} className={cn("px-3 py-2 font-medium", c.align === "right" && "text-right", c.hide)}>
        <button
          onClick={() => setSort((s) => s.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: c.key === "name" ? "asc" : "desc" })}
          className={cn("inline-flex items-center gap-1 hover:text-foreground", on && "text-foreground")}
        >
          {c.label}
          {on && (sort.dir === "asc" ? <ArrowUpIcon className="size-3" /> : <ArrowDownIcon className="size-3" />)}
        </button>
      </th>
    );
  };

  const num = (v: number, href: string, tone?: string) =>
    v > 0
      ? <Link href={href} onClick={(e) => e.stopPropagation()} className={cn("tabular-nums hover:underline", tone)}>{v}</Link>
      : <span className="tabular-nums text-muted-foreground/40">0</span>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client or team member..." className="h-9 pl-8" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FOCUSES.map((f) => {
            const n = summary.counts[f];
            const on = focus === f;
            return (
              <button
                key={f} onClick={() => setFocus(on ? null : f)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  on ? "border-primary bg-primary/10 font-medium text-primary"
                     : n > 0 ? "text-foreground hover:bg-muted" : "text-muted-foreground/50 hover:bg-muted",
                )}
              >
                {OVERVIEW_FOCUS_LABEL[f]} <span className="tabular-nums">{n}</span>
              </button>
            );
          })}
          {(focus || q) && (
            <button onClick={() => { setFocus(null); setQ(""); }} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive">
              <XIcon className="size-3" /> Clear
            </button>
          )}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">{shown.length} of {rows.length} accounts</span>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          {rows.length === 0
            ? "You are not staffed on any client account yet. Ask an admin to add you to a client's support team."
            : "No account matches this filter."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="sticky top-0 z-10 bg-card text-left text-xs text-muted-foreground">
              <tr className="border-b">{COLS.map(head)}<th className="hidden px-3 py-2 font-medium xl:table-cell">Team</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => router.push(`/tickets/c/${r.id}`)}
                  className={cn("cursor-pointer border-b last:border-none hover:bg-muted/40", needsAttention(r) && "bg-danger-soft/30")}
                >
                  <td className="px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <InitialsAvatar name={r.name} size="sm" />
                      <span className="truncate font-medium">{r.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">{num(r.open, `/tickets/c/${r.id}?focus=open`)}</td>
                  <td className="px-3 py-2 text-right">{num(r.breached, `/tickets/c/${r.id}?focus=breached`, "font-medium text-destructive")}</td>
                  <td className="px-3 py-2 text-right">{num(r.unassigned, `/tickets/c/${r.id}?focus=unassigned`, "font-medium text-warning")}</td>
                  <td className="px-3 py-2 text-right">{num(r.critical, `/tickets/c/${r.id}?focus=critical`, "font-medium text-destructive")}</td>
                  <td className="hidden px-3 py-2 text-right tabular-nums lg:table-cell">
                    {r.oldestOpenDays === null ? <span className="text-muted-foreground/40">-</span> : <span className={cn(r.oldestOpenDays >= 30 && "font-medium text-warning")}>{r.oldestOpenDays}d</span>}
                  </td>
                  <td className="hidden px-3 py-2 text-right xl:table-cell">{num(r.resolved7d, `/tickets/c/${r.id}?focus=resolved7d`, "text-muted-foreground")}</td>
                  <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">{lastActivityLabel(r.lastActivity, nowMs)}</td>
                  <td className="hidden px-3 py-2 xl:table-cell">
                    {r.team.length === 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs text-warning"><UsersIcon className="size-3.5" /> no team</span>
                    ) : (
                      <span className="truncate text-xs text-muted-foreground" title={r.team.join(", ")}>
                        {r.team.slice(0, 2).join(", ")}{r.team.length > 2 && ` +${r.team.length - 2}`}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
