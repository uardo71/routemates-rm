import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePortalUser } from "@/lib/portal";
import { loadTicketConfig, fieldsForType, isStageMode } from "@/lib/ticket-config.server";
import { STATUS_CATEGORY_LABEL } from "@/lib/ticket-config";
import { buildThread, COMMENT_INCLUDE } from "@/lib/ticket-thread";
import { isChangeRequestType, asCrStage, customerCrView } from "@/lib/change-request";
import { customerStageView } from "@/lib/ticket-stages";
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
      typeDef: { select: { key: true, name: true, color: true, icon: true, lifecycleMode: true } },
      statusDef: { select: { key: true, name: true, color: true, category: true, customerVisible: true } },
      stageDef: { select: { key: true } },
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

  // STAGE-mode tickets (Bug on the generic stage system, or a change request on its own) carry no
  // customer-facing status of their own — settable above is always empty for them — so without this
  // the portal showed one frozen chip for the ticket's whole life. Same rule either way: the
  // customer sees the nearest customer-visible stage, never a stage marked internal-only.
  const stage = isChangeRequestType(t.typeDef.key)
    ? customerCrView(asCrStage(t.statusDef.key))
    : type && isStageMode(type)
      ? customerStageView(type.stages, t.stageDef?.key ?? null)
      : null;

  const { conversation, history } = buildThread(t.comments, u.id, { hideInternal: true, canManage: false });

  const ticket: PortalTicket = {
    id: t.id, number: t.number, title: t.title, description: t.description ?? "",
    typeName: t.typeDef.name, typeColor: t.typeDef.color, typeIcon: t.typeDef.icon,
    statusName: t.statusDef.customerVisible ? t.statusDef.name : STATUS_CATEGORY_LABEL[t.statusDef.category],
    statusColor: t.statusDef.customerVisible ? t.statusDef.color : null,
    createdAt: iso(t.createdAt),
    stage: stage
      ? {
          name: stage.current?.name ?? null, description: stage.current?.description ?? null,
          index: stage.index, total: stage.total, rejected: "rejected" in stage && stage.rejected === true,
        }
      : null,
    fields: [
      ...visibleFields.map((f) => ({ name: f.name, display: display(f.kind, valueByField.get(f.id) ?? null), archived: false })),
      // Archived fields the customer could see: shown read-only where this ticket already has a value.
      ...cfg.archivedFields
        .filter((f) => f.customerVisible && valueByField.has(f.id))
        .map((f) => ({ name: f.name, display: display(f.kind, valueByField.get(f.id) ?? null), archived: true })),
    ].filter((f) => f.display),
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
