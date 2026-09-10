import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { assignedClientIds, visibleTicketWhere } from "@/lib/permissions";
import { loadTicketConfig } from "@/lib/ticket-config.server";
import { serializeTicketRow, TICKET_ROW_SELECT } from "../serialize";
import { TicketsClient, type ClientConfig } from "../tickets-client";
import type { TicketFocus } from "../filters";

export const metadata = { title: "All tickets" };

const FOCUS = new Set(["open", "breached", "unassigned", "critical", "resolved7d"]);
function parseFocus(v: string | undefined): TicketFocus | null {
  return v && FOCUS.has(v) ? (v as TicketFocus) : null;
}


// The cross-client queue. `/tickets` itself is now the per-client overview; this is the flat list
// for people who want every account in one table (still scoped to what they may see).
export default async function AllTicketsPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const focus = parseFocus((await searchParams).focus);
  const user = await requireUser();
  const cfg = await loadTicketConfig(user.companyId);

  const ticketWhere = await visibleTicketWhere(user);
  const myClients = await assignedClientIds(user);
  // Triage controls appear for anyone staffed on at least one account; each action re-checks the
  // specific ticket's client on the server.
  const canManage = myClients === "ALL" || myClients.length > 0;

  const [tickets, users, views] = await Promise.all([
    prisma.ticket.findMany({ where: ticketWhere, select: TICKET_ROW_SELECT, orderBy: { createdAt: "desc" } }),
    prisma.user.findMany({ where: { companyId: user.companyId }, select: { id: true, name: true } }),
    prisma.ticketView.findMany({
      where: { companyId: user.companyId, OR: [{ ownerId: user.id }, { shared: true }] },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const userName = (id: string) => nameById.get(id) ?? "—";
  const rows = tickets.map((t) => serializeTicketRow(t, cfg, userName));

  const seen = new Set<string>();
  const customColumns: { key: string; label: string }[] = [];
  for (const t of cfg.types) for (const f of [...t.fields, ...cfg.globalFields]) {
    if (!seen.has(f.key)) { seen.add(f.key); customColumns.push({ key: f.key, label: f.name }); }
  }

  const config: ClientConfig = {
    types: cfg.types.map((t) => ({
      id: t.id, name: t.name, color: t.color, icon: t.icon,
      statuses: t.statuses.map((s) => ({ id: s.id, name: s.name, color: s.color, category: s.category })),
    })),
    customColumns,
  };

  return (
    <TicketsClient
      key={focus ?? "all"}
      initialFocus={focus}
      rows={rows}
      config={config}
      canManage={canManage}
      currentUserName={nameById.get(user.id) ?? ""}
      views={views.map((v) => ({
        id: v.id, name: v.name, shared: v.shared, mine: v.ownerId === user.id,
        filters: v.filters as Record<string, unknown>,
        columns: Array.isArray(v.columns) ? (v.columns as string[]) : [],
        sort: (v.sort as { key: string; dir: "asc" | "desc" } | null) ?? null,
      }))}
    />
  );
}
