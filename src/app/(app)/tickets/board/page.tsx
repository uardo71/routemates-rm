import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can, visibleTicketWhere } from "@/lib/permissions";
import { loadTicketConfig } from "@/lib/ticket-config.server";
import { serializeTicketRow, TICKET_ROW_SELECT } from "../serialize";
import { TicketsBoard, type BoardConfig } from "./tickets-board";

export const metadata = { title: "Ticket board" };

export default async function TicketBoardPage() {
  const user = await requireUser();
  const cfg = await loadTicketConfig(user.companyId);
  const [tickets, users] = await Promise.all([
    prisma.ticket.findMany({ where: visibleTicketWhere(user), select: TICKET_ROW_SELECT, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] }),
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
  return <TicketsBoard rows={rows} config={config} canManage={can(user, "tickets:manage")} />;
}
