import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePortalUser } from "@/lib/portal";
import { loadTicketConfig, fieldsForType } from "@/lib/ticket-config.server";
import { STATUS_CATEGORY_LABEL } from "@/lib/ticket-config";
import { buildThread, COMMENT_INCLUDE } from "@/lib/ticket-thread";
import { PortalTicketClient, type PortalTicket } from "./portal-ticket-client";

export const metadata = { title: "Ticket" };
const iso = (d: Date | null) => (d ? d.toISOString() : "");

// System events a customer sees (assignment/priority/internal status churn stays hidden).
const CUSTOMER_HISTORY = new Set(["CREATED", "RESOLVED", "REOPENED"]);

export default async function PortalTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requirePortalUser();

  const t = await prisma.ticket.findFirst({
    where: { id, companyId: u.companyId, clientId: u.clientId },
    include: {
      typeDef: { select: { name: true, color: true, icon: true } },
      statusDef: { select: { name: true, color: true, category: true, customerVisible: true } },
      comments: COMMENT_INCLUDE,
      fieldValues: { select: { fieldId: true, value: true } },
    },
  });
  if (!t) notFound();

  const cfg = await loadTicketConfig(u.companyId);
  const type = cfg.types.find((x) => x.id === t.typeId);
  const visibleFields = fieldsForType(cfg, t.typeId).filter((f) => f.customerVisible);
  const valueByField = new Map(t.fieldValues.map((v) => [v.fieldId, v.value]));

  const settable = (type?.statuses ?? []).filter((s) => s.customerVisible && s.customerCanSet && s.id !== t.statusId)
    .map((s) => ({ id: s.id, name: s.name, color: s.color }));

  const { conversation, history } = buildThread(t.comments, u.id, { hideInternal: true, canManage: false });

  const ticket: PortalTicket = {
    id: t.id, number: t.number, title: t.title, description: t.description ?? "",
    typeName: t.typeDef.name, typeColor: t.typeDef.color, typeIcon: t.typeDef.icon,
    statusName: t.statusDef.customerVisible ? t.statusDef.name : STATUS_CATEGORY_LABEL[t.statusDef.category],
    statusColor: t.statusDef.customerVisible ? t.statusDef.color : null,
    createdAt: iso(t.createdAt),
    fields: visibleFields.map((f) => ({ name: f.name, display: display(f.kind, valueByField.get(f.id) ?? null) })).filter((f) => f.display),
    settable,
    history: history.filter((h) => CUSTOMER_HISTORY.has(h.kind)).map((h) => ({ id: h.id, kind: h.kind, authorName: h.authorName, createdAt: h.createdAt })),
  };

  return <PortalTicketClient t={ticket} conversation={conversation} />;
}

function display(kind: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (kind === "CHECKBOX") return value ? "Yes" : "No";
  if (kind === "MULTISELECT") return Array.isArray(value) ? value.join(", ") : String(value);
  if (kind === "USER") return "";
  return String(value);
}
