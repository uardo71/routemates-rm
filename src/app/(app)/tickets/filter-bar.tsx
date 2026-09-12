"use client";

import * as React from "react";
import { Columns3Icon, DownloadIcon, FilterIcon, SearchIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TicketStatusCategory } from "@prisma/client";
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABEL } from "@/lib/ticket";
import { STATUS_CATEGORIES, STATUS_CATEGORY_LABEL } from "@/lib/ticket-config";
import { FOCUS_LABEL, type TicketFilters, type TicketFocus } from "./filters";

// One filter bar for every way of looking at tickets — the list, the board, a client workspace.
//
// It replaced three rows of always-open chip groups (Type x7, "Stage" x4, Priority x4, plus a
// "More filters" drawer holding Assignee and Client) that filled the screen whether or not you were
// filtering, and never showed what was actually applied. Now: search and the quick focus chips stay
// out in the open, everything else lives behind one Filters button, and whatever is ON is listed
// back to you as a chip you can click off.
//
// The group that used to be labelled "Stage" is called Status here: it filters status CATEGORIES
// (Open / In progress / Done / Cancelled). Since the lifecycle work, "stage" means something else
// in this product and the two must not share a word.

export type Opt = { v: string; l: string };

export type FilterBarConfig = {
  types: Opt[];
  assignees: Opt[];
  clients: Opt[];
};

type GroupKey = "typeIds" | "statusCategories" | "priorities" | "assigneeIds" | "clientIds";

const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "typeIds", label: "Type" },
  { key: "statusCategories", label: "Status" },
  { key: "priorities", label: "Priority" },
  { key: "assigneeIds", label: "Assignee" },
  { key: "clientIds", label: "Client" },
];

function listOf(f: TicketFilters, key: GroupKey): string[] {
  return (f[key] as string[] | undefined) ?? [];
}

/** How many filters are actually on — the number on the Filters button. */
export function activeFilterCount(f: TicketFilters): number {
  let n = GROUPS.reduce((a, g) => a + listOf(f, g.key).length, 0);
  if (f.focus) n++;
  if (f.mine) n++;
  if (f.onlyOpen) n++;
  return n;
}

export function TicketFilterBar({ filters, setFilters, config, lockedClient, onColumns, exportPayload, onReset }: {
  filters: TicketFilters;
  setFilters: React.Dispatch<React.SetStateAction<TicketFilters>>;
  config: FilterBarConfig;
  lockedClient?: { id: string; name: string } | null;
  /** Left out on the board, which has no columns to pick and nothing to export. */
  onColumns?: () => void;
  exportPayload?: string;
  onReset: () => void;
}) {
  const [open, setOpen] = React.useState(false);

  const options = (key: GroupKey): Opt[] => {
    switch (key) {
      case "typeIds": return config.types;
      case "statusCategories": return STATUS_CATEGORIES.map((c) => ({ v: c, l: STATUS_CATEGORY_LABEL[c] }));
      case "priorities": return TICKET_PRIORITIES.map((p) => ({ v: p, l: TICKET_PRIORITY_LABEL[p] }));
      case "assigneeIds": return config.assignees;
      case "clientIds": return lockedClient ? [] : config.clients;
    }
  };

  function toggle(key: GroupKey, value: string) {
    setFilters((f) => {
      const cur = listOf(f, key);
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...f, [key]: next as TicketStatusCategory[] & string[] };
    });
  }

  const count = activeFilterCount(filters);

  // Everything that is ON, as chips you can switch off one at a time.
  const chips: { label: string; clear: () => void }[] = [];
  if (filters.focus) chips.push({ label: FOCUS_LABEL[filters.focus], clear: () => setFilters((f) => ({ ...f, focus: null })) });
  if (filters.mine) chips.push({
    label: filters.mine === "assigned" ? "Assigned to me" : "Raised by me",
    clear: () => setFilters((f) => ({ ...f, mine: null })),
  });
  if (filters.onlyOpen) chips.push({ label: "Open only", clear: () => setFilters((f) => ({ ...f, onlyOpen: false })) });
  for (const g of GROUPS) {
    const opts = options(g.key);
    for (const v of listOf(filters, g.key)) {
      chips.push({
        label: `${g.label}: ${opts.find((o) => o.v === v)?.l ?? v}`,
        clear: () => toggle(g.key, v),
      });
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.text ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, text: e.target.value }))}
            placeholder="Search number, title, client, system..."
            className="h-9 pl-8"
          />
        </div>

        <button
          onClick={() => setFilters((f) => ({ ...f, mine: f.mine === "assigned" ? null : "assigned" }))}
          className={cn("h-9 rounded-md border px-3 text-sm", filters.mine === "assigned" ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}
        >
          Assigned to me
        </button>

        <div className="relative">
          <button
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm", count > 0 ? "border-primary/50 text-primary" : "text-muted-foreground hover:bg-muted")}
          >
            <FilterIcon className="size-4" /> Filters
            {count > 0 && <span className="rounded-full bg-primary/15 px-1.5 text-xs tabular-nums">{count}</span>}
          </button>

          {open && (
            <>
              <button className="fixed inset-0 z-20 cursor-default" aria-label="Close filters" onClick={() => setOpen(false)} />
              <div className="absolute right-0 z-30 mt-1 max-h-[70vh] w-80 overflow-y-auto rounded-lg border bg-card p-3 shadow-paper">
                <div className="flex items-center justify-between pb-2">
                  <span className="text-sm font-semibold">Filters</span>
                  <button onClick={onReset} className="text-xs text-muted-foreground hover:text-destructive">Clear all</button>
                </div>

                <label className="flex items-center gap-2 border-b pb-2 text-sm">
                  <input type="checkbox" checked={filters.onlyOpen ?? false} onChange={(e) => setFilters((f) => ({ ...f, onlyOpen: e.target.checked }))} className="accent-primary" />
                  Open only
                </label>

                <label className="flex items-center gap-2 border-b py-2 text-sm">
                  <input
                    type="checkbox" checked={filters.mine === "requested"}
                    onChange={(e) => setFilters((f) => ({ ...f, mine: e.target.checked ? "requested" : null }))}
                    className="accent-primary"
                  />
                  Raised by me
                </label>

                {GROUPS.map((g) => {
                  const opts = options(g.key);
                  if (opts.length === 0) return null;
                  const on = listOf(filters, g.key);
                  return (
                    <div key={g.key} className="border-b py-2 last:border-none">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</span>
                        {on.length > 0 && (
                          <button onClick={() => setFilters((f) => ({ ...f, [g.key]: [] }))} className="text-[11px] text-muted-foreground hover:text-destructive">clear</button>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {opts.map((o) => (
                          <button
                            key={o.v} onClick={() => toggle(g.key, o.v)}
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-xs transition-colors",
                              on.includes(o.v) ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {o.l}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {onColumns && (
          <button onClick={onColumns} className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm text-muted-foreground hover:bg-muted">
            <Columns3Icon className="size-4" /> Columns
          </button>
        )}
        {exportPayload !== undefined && (
          <form method="post" action="/api/tickets/export">
            {/* Inside a workspace the export is pinned to this client by ID - a same-named client never mixes in. */}
            <input type="hidden" name="payload" value={exportPayload} />
            <button type="submit" className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm text-muted-foreground hover:bg-muted">
              <DownloadIcon className="size-4" /> Export
            </button>
          </form>
        )}
      </div>

      {/* Quick triage: the five questions worth one click. */}
      <div className="flex flex-wrap items-center gap-1">
        {(Object.keys(FOCUS_LABEL) as TicketFocus[]).map((k) => (
          <button
            key={k}
            onClick={() => setFilters((f) => f.focus === k ? { ...f, focus: null } : { ...f, focus: k, onlyOpen: k !== "resolved7d" })}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              filters.focus === k ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {FOCUS_LABEL[k]}
          </button>
        ))}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-t pt-2">
          <span className="text-[11px] text-muted-foreground">Filtering by</span>
          {chips.map((c) => (
            <button
              key={c.label} onClick={c.clear}
              className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-xs text-primary hover:bg-primary/10"
              title="Remove this filter"
            >
              {c.label} <XIcon className="size-3" />
            </button>
          ))}
          <button onClick={onReset} className="ml-1 text-xs text-muted-foreground hover:text-destructive">Clear all</button>
        </div>
      )}
    </div>
  );
}
