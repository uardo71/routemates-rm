import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canManageClientTickets } from "@/lib/permissions";
import { loadTicketConfig, fieldsForType } from "@/lib/ticket-config.server";
import { buildThread, COMMENT_INCLUDE } from "@/lib/ticket-thread";
import { asCrStage, isChangeRequestType, timeInStages, type CrStageKey } from "@/lib/change-request";
import { crDraftFrom } from "@/lib/change-request.server";
import { createDropNotices } from "@/lib/ticket";
import { TicketDetailClient, type DetailConfig } from "./ticket-detail-client";
import type { CrView } from "./change-request-panel";
import type { TicketFile } from "./ticket-files";

export const metadata = { title: "Ticket" };
const iso = (d: Date | null) => (d ? d.toISOString() : "");
const d10 = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function TicketDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  /** Set by createTicketAction when it didn't keep a requester/assignee the person entered. */
  searchParams: Promise<{ dropped?: string; why?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const notices = createDropNotices((sp.dropped ?? "").split(","), sp.why);
  const user = await requireUser();

  const t = await prisma.ticket.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      typeDef: { select: { id: true, key: true, name: true, color: true, icon: true, slaExempt: true } },
      statusDef: { select: { id: true, key: true, name: true, color: true, category: true } },
      requester: { select: { name: true } },
      assignee: { select: { name: true } },
      client: { select: { name: true } },
      project: { select: { name: true } },
      comments: COMMENT_INCLUDE,
      worklogs: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } },
      fieldValues: { select: { fieldId: true, value: true } },
      attachments: {
        orderBy: { uploadedAt: "desc" },
        select: {
          id: true, fileName: true, originalName: true, mimeType: true, sizeBytes: true, uploadedById: true, uploadedAt: true,
          stageKey: true, commentId: true, comment: { select: { internal: true } }, uploadedBy: { select: { name: true } },
        },
      },
      changeRequest: true,
      crStageEvents: { orderBy: { at: "asc" } },
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

  const files: TicketFile[] = t.attachments.map((a) => ({
    id: a.id, url: `/api/tickets/attachments/${a.fileName}`, name: a.originalName, mime: a.mimeType, size: a.sizeBytes,
    uploadedByName: a.uploadedBy.name, uploadedAt: iso(a.uploadedAt), stageKey: a.stageKey,
    fromComment: !!a.commentId, internal: !!a.comment?.internal, canDelete: manage || a.uploadedById === user.id,
  }));

  let cr: CrView | null = null;
  if (isChangeRequestType(t.typeDef.key)) {
    // Moves may be by anyone who ever touched the ticket (a portal user started it, a leaver moved it).
    const people = new Map((await prisma.user.findMany({ where: { companyId: user.companyId }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const now = new Date();
    const events = t.crStageEvents.map((e) => ({
      id: e.id, fromKey: e.fromKey, toKey: e.toKey, move: e.move, note: e.note ?? "", overrideReason: e.overrideReason ?? "",
      byName: people.get(e.byId) ?? "Deleted user", at: iso(e.at),
    }));
    const timeline = events.length > 0 ? events : [{ toKey: t.statusDef.key, at: iso(t.createdAt) }];
    const evidence: Partial<Record<CrStageKey, number>> = {};
    for (const a of t.attachments) {
      const k = asCrStage(a.stageKey);
      if (k) evidence[k] = (evidence[k] ?? 0) + 1;
    }
    cr = {
      stage: asCrStage(t.statusDef.key), statusName: t.statusDef.name,
      // The panel's values are the type's stage-scoped fields; the next step stays on the record row.
      saved: crDraftFrom(t.changeRequest, type?.stageFields ?? [], valueByField),
      events, timeInStage: timeInStages(timeline, now.toISOString()), stageSince: timeline[timeline.length - 1].at,
      loggedMinutes: t.worklogs.reduce((s, w) => s + w.minutes, 0),
      evidence, todayIso: now.toISOString().slice(0, 10),
    };
  }

  return (
    <TicketDetailClient
      canManage={manage}
      involved={involved}
      users={users}
      clients={clients}
      projects={projects}
      config={config}
      conversation={conversation}
      history={history}
      notices={notices}
      t={{
        id: t.id, number: t.number, title: t.title, description: t.description ?? "",
        typeId: t.typeId, typeName: t.typeDef.name, typeColor: t.typeDef.color, typeIcon: t.typeDef.icon, slaExempt: t.typeDef.slaExempt,
        priority: t.priority,
        statusId: t.statusId, statusName: t.statusDef.name, statusColor: t.statusDef.color, statusCategory: t.statusDef.category,
        requesterName: t.requester.name, assigneeId: t.assigneeId, assigneeName: t.assignee?.name ?? null,
        clientId: t.clientId, clientName: t.client?.name ?? null, projectId: t.projectId, projectName: t.project?.name ?? null,
        category: t.category ?? "", systemRef: t.systemRef ?? "", moduleRef: t.moduleRef ?? "",
        dueDate: d10(t.dueDate), resolution: t.resolution ?? "",
        respondBy: iso(t.respondBy), resolveBy: iso(t.resolveBy), firstResponseAt: iso(t.firstResponseAt), resolvedAt: iso(t.resolvedAt), closedAt: iso(t.closedAt), createdAt: iso(t.createdAt),
        worklogs: t.worklogs.map((w) => ({ id: w.id, userName: w.user.name, minutes: w.minutes, workedOn: d10(w.workedOn), note: w.note ?? "", mine: w.userId === user.id })),
        fields: config.fields.map((f) => ({ ...f, value: valueByField.get(f.id) ?? null, display: displayValue(f, valueByField.get(f.id) ?? null, nameById) })),
        // Archived fields: only where this ticket already has a value; read-only, never in the draft.
        archivedFields: cfg.archivedFields
          .filter((f) => valueByField.has(f.id))
          .map((f) => ({ id: f.id, name: f.name, display: displayValue(f, valueByField.get(f.id) ?? null, nameById) }))
          .filter((f) => f.display !== ""),
        files,
        cr,
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
