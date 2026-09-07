"use client";

import * as React from "react";
import Link from "next/link";
import { PlusIcon, SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TicketStatusCategory } from "@prisma/client";
import { isOpenCategory } from "@/lib/ticket-config";
import { TypeChip, StatusChip } from "../(app)/tickets/ticket-visuals";

export type PortalRow = {
  id: string; number: string; title: string;
  typeName: string; typeColor: string | null; typeIcon: string | null;
  statusName: string; statusColor: string | null; statusCategory: TicketStatusCategory;
  createdAt: string; updatedAt: string;
};

export function PortalList({ rows, clientName }: { rows: PortalRow[]; clientName: string }) {
  const [tab, setTab] = React.useState<"open" | "all">("open");
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (tab === "open" && !isOpenCategory(r.statusCategory)) return false;
    if (needle && !`${r.number} ${r.title} ${r.typeName}`.toLowerCase().includes(needle)) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Support tickets</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Raise and track requests for {clientName}.</p>
        </div>
        <Link href="/portal/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:bg-foreground/90"><PlusIcon className="size-4" /> New ticket</Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border p-0.5">
          {(["open", "all"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn("rounded px-3 py-1 text-sm capitalize", tab === t ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>{t}</button>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your tickets…" className="h-9 pl-8" />
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? <>No tickets yet. <Link href="/portal/new" className="text-primary hover:underline">Raise your first one</Link>.</> : "Nothing here."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {shown.map((r) => (
            <Link key={r.id} href={`/portal/${r.id}`} className="flex items-center gap-3 border-b px-3 py-3 last:border-none hover:bg-muted/40">
              <span className="font-mono text-xs text-muted-foreground">{r.number}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.title}</div>
                <div className="mt-0.5"><TypeChip name={r.typeName} color={r.typeColor} icon={r.typeIcon} /></div>
              </div>
              <StatusChip name={r.statusName} color={r.statusColor} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
