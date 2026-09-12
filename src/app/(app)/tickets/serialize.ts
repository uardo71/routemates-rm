import type { TicketPriority, TicketStatusCategory, TicketFieldKind, Prisma } from "@prisma/client";
import type { TicketConfig } from "@/lib/ticket-config.server";

const iso = (d: Date | null) => (d ? d.toISOString() : "");
const d10 = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export type TicketRow = {
  id: string;
  number: string;
  title: string;
  typeId: string;
  typeName: string;
  typeColor: string | null;
  typeIcon: string | null;
  priority: TicketPriority;
  statusId: string;
  statusName: string;
  statusColor: string | null;
  statusCategory: TicketStatusCategory;
  /** False = this type has no response/resolution targets: no pill, no bar, never "breached". */
  slaApplicable: boolean;
  // Ids are what filters match on ("Assigned to me", saved views, the workspace export) — names
  // are for display only, since two people or two clients can share a name.
  requesterId: string;
  assigneeId: string | null;
  clientId: string | null;
  requesterName: string;
  assigneeName: string | null;
  clientName: string | null;
  projectName: string | null;
  category: string;
  systemRef: string;
  moduleRef: string;
  dueDate: string; // yyyy-mm-dd
  respondBy: string; // ISO
  resolveBy: string; // ISO
  firstResponseAt: string;
  resolvedAt: string;
  createdAt: string;
  // Custom field display strings, keyed by field key (for optional overview columns / export).
  fields: Record<string, string>;
};

type DbRow = {
  id: string; number: string; title: string; priority: TicketPriority;
  requesterId: string; assigneeId: string | null; clientId: string | null;
  typeDef: { id: string; name: string; color: string | null; icon: string | null; slaApplicable: boolean };
  statusDef: { id: string; name: string; color: string | null; category: TicketStatusCategory };
  requester: { name: string }; assignee: { name: string } | null; client: { name: string } | null; project: { name: string } | null;
  category: string | null; systemRef: string | null; moduleRef: string | null;
  dueDate: Date | null; respondBy: Date | null; resolveBy: Date | null; firstResponseAt: Date | null; resolvedAt: Date | null; createdAt: Date;
  fieldValues: { fieldId: string; value: Prisma.JsonValue }[];
};

export function formatFieldValue(kind: TicketFieldKind, value: Prisma.JsonValue, userName: (id: string) => string): string {
  if (value === null || value === undefined) return "";
  switch (kind) {
    case "CHECKBOX": return value ? "Yes" : "No";
    case "MULTISELECT": return Array.isArray(value) ? value.join(", ") : String(value);
    case "USER": return typeof value === "string" ? userName(value) : "";
    default: return String(value);
  }
}

export function serializeTicketRow(t: DbRow, cfg: TicketConfig, userName: (id: string) => string): TicketRow {
  const fieldDefs = new Map<string, { key: string; kind: TicketFieldKind }>();
  for (const ty of cfg.types) for (const f of ty.fields) fieldDefs.set(f.id, { key: f.key, kind: f.kind });
  for (const f of cfg.globalFields) fieldDefs.set(f.id, { key: f.key, kind: f.kind });
  // Archived fields still display the values tickets already carry (read-only, "(archived)" column).
  for (const f of cfg.archivedFields) fieldDefs.set(f.id, { key: f.key, kind: f.kind });
  const fields: Record<string, string> = {};
  for (const v of t.fieldValues) {
    const def = fieldDefs.get(v.fieldId);
    if (def) fields[def.key] = formatFieldValue(def.kind, v.value, userName);
  }
  return {
    id: t.id, number: t.number, title: t.title, priority: t.priority,
    typeId: t.typeDef.id, typeName: t.typeDef.name, typeColor: t.typeDef.color, typeIcon: t.typeDef.icon,
    statusId: t.statusDef.id, statusName: t.statusDef.name, statusColor: t.statusDef.color, statusCategory: t.statusDef.category,
    slaApplicable: t.typeDef.slaApplicable,
    requesterId: t.requesterId, assigneeId: t.assigneeId, clientId: t.clientId,
    requesterName: t.requester.name, assigneeName: t.assignee?.name ?? null, clientName: t.client?.name ?? null, projectName: t.project?.name ?? null,
    category: t.category ?? "", systemRef: t.systemRef ?? "", moduleRef: t.moduleRef ?? "",
    dueDate: d10(t.dueDate), respondBy: iso(t.respondBy), resolveBy: iso(t.resolveBy), firstResponseAt: iso(t.firstResponseAt), resolvedAt: iso(t.resolvedAt), createdAt: iso(t.createdAt),
    fields,
  };
}

export const TICKET_ROW_SELECT = {
  id: true, number: true, title: true, priority: true,
  requesterId: true, assigneeId: true, clientId: true,
  typeDef: { select: { id: true, name: true, color: true, icon: true, slaApplicable: true } },
  statusDef: { select: { id: true, name: true, color: true, category: true } },
  requester: { select: { name: true } }, assignee: { select: { name: true } }, client: { select: { name: true } }, project: { select: { name: true } },
  category: true, systemRef: true, moduleRef: true, dueDate: true, respondBy: true, resolveBy: true, firstResponseAt: true, resolvedAt: true, createdAt: true,
  fieldValues: { select: { fieldId: true, value: true } },
} as const;

/** Column pickers offer only live fields; archived ones get a label (for saved views that already
 *  show them) but are never offered to add. Both de-duplicated by field key across types. */
export function customColumnsOf(cfg: TicketConfig): { customColumns: { key: string; label: string }[]; archivedColumns: { key: string; label: string }[] } {
  const seen = new Set<string>();
  const customColumns: { key: string; label: string }[] = [];
  for (const t of cfg.types) for (const f of [...t.fields, ...cfg.globalFields]) {
    if (!seen.has(f.key)) { seen.add(f.key); customColumns.push({ key: f.key, label: f.name }); }
  }
  const archivedColumns: { key: string; label: string }[] = [];
  for (const f of cfg.archivedFields) {
    if (!seen.has(f.key)) { seen.add(f.key); archivedColumns.push({ key: f.key, label: `${f.name} (archived)` }); }
  }
  return { customColumns, archivedColumns };
}
