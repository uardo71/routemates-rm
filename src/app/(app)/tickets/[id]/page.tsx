import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canManageClientTickets } from "@/lib/permissions";
import { loadTicketConfig, fieldsForType } from "@/lib/ticket-config.server";
import { buildThread, COMMENT_INCLUDE } from "@/lib/ticket-thread";
import { TicketDetailClient, type DetailConfig } from "./ticket-detail-client";

export const metadata = { title: "Ticket" };
const iso = (d: Date | null) => (d ? d.toISOString() : "");
const d10 = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const t = await prisma.ticket.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      typeDef: { select: { id: true, name: true, color: true, icon: true } },
      statusDef: { select: { id: true, name: true, color: true, category: true } },
      requester: { select: { name: true } },
      assignee: { select: { name: true } },
      client: { select: { name: true } },
      project: { select: { name: true } },
      comments: COMMENT_INCLUDE,
      worklogs: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } },
      fieldValues: { select: { fieldId: true, value: true } },
    },
  });
  if (!t) notFound();
  const involved = t.requesterId === user.id || t.assigneeId === user.id || t.createdById === user.id;
  // Being on the client's team is what opens the ticket AND what allows triage. 404 (not 403) when
  // neither applies, so a ticket's existence isn't leaked across accounts.
  const manage = await canManageClientTickets(user, t.clientId);
  if (!manage && !involved) notFound();

  const cfg = await loadTicketConfig(user.companyId);
  const type = cfg.types.find((x) => x.id === t.typeId);
  const typeFields = fieldsForType(cfg, t.typeId);

  const [clients, projects, users] = await Promise.all([
    manage ? prisma.client.findMany({ where: { companyId: user.companyId }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    manage ? prisma.project.findMany({ where: { companyId: user.companyId, isInternal: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    prisma.user.findMany({ where: { companyId: user.companyId, active: true, role: { not: "CUSTOMER" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  const pubField = (f: { id: string; key: string; name: string; kind: string; options: string[]; required: boolean }) =>
    ({ id: f.id, key: f.key, name: f.name, kind: f.kind, options: f.options, required: f.required });
  const config: DetailConfig = {
    statuses: (type?.statuses ?? []).map((s) => ({ id: s.id, name: s.name, color: s.color, category: s.category })),
    types: cfg.types.map((ty) => ({ id: ty.id, name: ty.name, icon: ty.icon })),
    fields: typeFields.map(pubField),
  };

  const valueByField = new Map(t.fieldValues.map((v) => [v.fieldId, v.value]));
  const { conversation, history } = buildThread(t.comments, user.id, { canManage: manage });

  return (
    <TicketDetailClient
      canManage={manage}
      users={users}
      clients={clients}
      projects={projects}
      config={config}
      conversation={conversation}
      history={history}
      t={{
        id: t.id, number: t.number, title: t.title, description: t.description ?? "",
        typeId: t.typeId, typeName: t.typeDef.name, typeColor: t.typeDef.color, typeIcon: t.typeDef.icon,
        priority: t.priority,
        statusId: t.statusId, statusName: t.statusDef.name, statusColor: t.statusDef.color, statusCategory: t.statusDef.category,
        requesterName: t.requester.name, assigneeId: t.assigneeId, assigneeName: t.assignee?.name ?? null,
        clientId: t.clientId, clientName: t.client?.name ?? null, projectId: t.projectId, projectName: t.project?.name ?? null,
        category: t.category ?? "", systemRef: t.systemRef ?? "", moduleRef: t.moduleRef ?? "",
        dueDate: d10(t.dueDate), resolution: t.resolution ?? "",
        respondBy: iso(t.respondBy), resolveBy: iso(t.resolveBy), firstResponseAt: iso(t.firstResponseAt), resolvedAt: iso(t.resolvedAt), closedAt: iso(t.closedAt), createdAt: iso(t.createdAt),
        worklogs: t.worklogs.map((w) => ({ id: w.id, userName: w.user.name, minutes: w.minutes, workedOn: d10(w.workedOn), note: w.note ?? "", mine: w.userId === user.id })),
        fields: config.fields.map((f) => ({ ...f, value: valueByField.get(f.id) ?? null, display: displayValue(f, valueByField.get(f.id) ?? null, nameById) })),
      }}
    />
  );
}

function displayValue(f: { kind: string }, value: unknown, nameById: Map<string, string>): string {
  if (value === null || value === undefined || value === "") return "";
  if (f.kind === "CHECKBOX") return value ? "Yes" : "No";
  if (f.kind === "MULTISELECT") return Array.isArray(value) ? value.join(", ") : String(value);
  if (f.kind === "USER") return typeof value === "string" ? nameById.get(value) ?? "—" : "";
  return String(value);
}
