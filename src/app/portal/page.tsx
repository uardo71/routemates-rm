import { prisma } from "@/lib/prisma";
import { requirePortalUser } from "@/lib/portal";
import { loadTicketConfig } from "@/lib/ticket-config.server";
import { STATUS_CATEGORY_LABEL } from "@/lib/ticket-config";
import { PortalList, type PortalRow } from "./portal-list";

export const metadata = { title: "My tickets" };

export default async function PortalHome() {
  const u = await requirePortalUser();
  await loadTicketConfig(u.companyId); // ensure config seeded
  const tickets = await prisma.ticket.findMany({
    where: { companyId: u.companyId, clientId: u.clientId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, number: true, title: true, createdAt: true, updatedAt: true,
      typeDef: { select: { name: true, color: true, icon: true } },
      statusDef: { select: { name: true, color: true, category: true, customerVisible: true } },
    },
  });

  const rows: PortalRow[] = tickets.map((t) => ({
    id: t.id, number: t.number, title: t.title,
    typeName: t.typeDef.name, typeColor: t.typeDef.color, typeIcon: t.typeDef.icon,
    statusName: t.statusDef.customerVisible ? t.statusDef.name : STATUS_CATEGORY_LABEL[t.statusDef.category],
    statusColor: t.statusDef.customerVisible ? t.statusDef.color : null,
    statusCategory: t.statusDef.category,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));

  return <PortalList rows={rows} clientName={u.clientName} />;
}
