"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListIcon, PlusIcon, AlertTriangleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TICKET_PRIORITY_LABEL, TICKET_PRIORITY_DOT } from "@/lib/ticket";
import { statusColor } from "@/lib/ticket-config";
import type { TicketStatusCategory } from "@prisma/client";
import type { TicketRow } from "../serialize";
import { slaState, SlaPill } from "../sla";
import { TypeIcon } from "../ticket-visuals";
import { setTicketStatusAction } from "../actions";

type BoardStatus = { id: string; name: string; color: string | null; category: TicketStatusCategory };
type BoardType = { id: string; name: string; color: string | null; icon: string | null; statuses: BoardStatus[] };
export type BoardConfig = { types: BoardType[] };

export function TicketsBoard({ rows, config, canManage }: { rows: TicketRow[]; config: BoardConfig; canManage: boolean }) {
  const router = useRouter();
  const [, start] = React.useTransition();
  const [typeId, setTypeId] = React.useState<string>(config.types[0]?.id ?? "");
  const [status, setStatus] = React.useState<Record<string, string>>({});
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overCol, setOverCol] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const type = config.types.find((t) => t.id === typeId) ?? config.types[0];
  const statusOf = (r: TicketRow) => status[r.id] ?? r.statusId;
  const rowsForType = rows.filter((r) => r.typeId === type?.id);
  const countByType = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.typeId, (m.get(r.typeId) ?? 0) + 1);
    return m;
  }, [rows]);

  function drop(col: BoardStatus) {
    const id = dragId;
    setDragId(null); setOverCol(null);
    if (!id) return;
    const row = rows.find((r) => r.id === id);
    if (!row || statusOf(row) === col.id) return;
    const prev = statusOf(row);
    setStatus((s) => ({ ...s, [id]: col.id }));
    setErr(null);
    start(async () => {
      const r = await setTicketStatusAction(id, col.id);
      if (r?.error) { setStatus((s) => ({ ...s, [id]: prev })); setErr(r.error); }
      else router.refresh();
    });
  }

  if (!type) {
    return <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">No ticket types configured.</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ticket board</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Drag a card through the workflow for the selected type.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/tickets" className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:border-primary/50 hover:text-primary"><ListIcon className="size-4" /> List</Link>
          <Link href="/tickets/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:bg-foreground/90"><PlusIcon className="size-4" /> New ticket</Link>
        </div>
      </div>

      {/* Type selector */}
      <div className="flex flex-wrap items-center gap-1.5">
        {config.types.map((t) => (
          <button key={t.id} onClick={() => setTypeId(t.id)} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors", t.id === type.id ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted")}>
            <TypeIcon icon={t.icon} className="size-3" /> {t.name}
            <span className="rounded-full bg-muted px-1 tabular-nums">{countByType.get(t.id) ?? 0}</span>
          </button>
        ))}
      </div>

      {err && <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</p>}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {type.statuses.map((col) => {
          const cards = rowsForType.filter((r) => statusOf(r) === col.id);
          return (
            <div
              key={col.id}
              onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverCol(col.id); } }}
              onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
              onDrop={() => drop(col)}
              className={cn("flex min-h-32 w-64 shrink-0 flex-col gap-2 rounded-lg border border-t-2 bg-muted/20 p-2 transition-colors", statusColor(col.color).column, overCol === col.id && dragId ? "bg-primary/5 ring-1 ring-primary/40" : "")}
            >
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{col.name}</span>
                <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{cards.length}</span>
              </div>
              {cards.map((r) => {
                const sla = slaState({ ...r, statusCategory: col.category });
                return (
                  <Link key={r.id} href={`/tickets/${r.id}`} draggable onDragStart={() => setDragId(r.id)} onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    className={cn("block cursor-grab rounded-md border bg-card p-2.5 shadow-sm transition-shadow hover:shadow active:cursor-grabbing", dragId === r.id && "opacity-50")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[0.65rem] text-muted-foreground">{r.number}</span>
                      <span className={cn("size-2 shrink-0 rounded-full", TICKET_PRIORITY_DOT[r.priority])} title={TICKET_PRIORITY_LABEL[r.priority]} />
                    </div>
                    <div className="mt-1 line-clamp-2 text-sm font-medium leading-snug">{r.title}</div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">{r.assigneeName ?? "Unassigned"}</span>
                      {sla.breached ? <AlertTriangleIcon className="size-3.5 shrink-0 text-rose-500" /> : <SlaPill state={sla} />}
                    </div>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
      {!canManage && <p className="text-xs text-muted-foreground">You see tickets you raised or are assigned to. PMs and admins see and triage all.</p>}
    </div>
  );
}
