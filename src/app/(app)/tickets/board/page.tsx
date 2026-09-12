import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { assignedClientIds, visibleTicketWhere } from "@/lib/permissions";
import { loadTicketConfig } from "@/lib/ticket-config.server";
import { serializeTicketRow, TICKET_ROW_SELECT } from "../serialize";
import { TicketsBoard, type BoardConfig } from "./tickets-board";
import { SupportShell } from "../support-shell";

export const metadata = { title: "Ticket board" };

export default async function TicketBoardPage() {
  const user = await requireUser();
  const cfg = await loadTicketConfig(user.companyId);
  const ticketWhere = await visibleTicketWhere(user);
  const myClients = await assignedClientIds(user);
  const canManage = myClients === "ALL" || myClients.length > 0;
  const [tickets, users] = await Promise.all([
    prisma.ticket.findMany({ where: ticketWhere, select: TICKET_ROW_SELECT, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] }),
    prisma.user.findMany({ where: { companyId: user.companyId }, select: { id: true, name: true } }),
  ]);
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const rows = tickets.map((t) => serializeTicketRow(t, cfg, (id) => nameById.get(id) ?? "—"));

  const config: BoardConfig = {
    types: cfg.types.map((t) => ({
      id: t.id, name: t.name, color: t.color, icon: t.icon,
      statuses: t.statuses.map((s) => ({ id: s.id, name: s.name, color: s.color, category: s.category })),
    })),
  };
  return (
    <SupportShell active="board" title="Board" subtitle="Drag a ticket to change its status. Stage-run types move from their own panel." canManage={canManage}>
      <TicketsBoard rows={rows} config={config} canManage={canManage} />
    </SupportShell>
  );
}
