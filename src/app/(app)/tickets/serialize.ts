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
  typeDef: { id: string; name: string; color: string | null; icon: string | null };
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
  const fields: Record<string, string> = {};
  for (const v of t.fieldValues) {
    const def = fieldDefs.get(v.fieldId);
    if (def) fields[def.key] = formatFieldValue(def.kind, v.value, userName);
  }
  return {
    id: t.id, number: t.number, title: t.title, priority: t.priority,
    typeId: t.typeDef.id, typeName: t.typeDef.name, typeColor: t.typeDef.color, typeIcon: t.typeDef.icon,
    statusId: t.statusDef.id, statusName: t.statusDef.name, statusColor: t.statusDef.color, statusCategory: t.statusDef.category,
    requesterName: t.requester.name, assigneeName: t.assignee?.name ?? null, clientName: t.client?.name ?? null, projectName: t.project?.name ?? null,
    category: t.category ?? "", systemRef: t.systemRef ?? "", moduleRef: t.moduleRef ?? "",
    dueDate: d10(t.dueDate), respondBy: iso(t.respondBy), resolveBy: iso(t.resolveBy), firstResponseAt: iso(t.firstResponseAt), resolvedAt: iso(t.resolvedAt), createdAt: iso(t.createdAt),
    fields,
  };
}

export const TICKET_ROW_SELECT = {
  id: true, number: true, title: true, priority: true,
  typeDef: { select: { id: true, name: true, color: true, icon: true } },
  statusDef: { select: { id: true, name: true, color: true, category: true } },
  requester: { select: { name: true } }, assignee: { select: { name: true } }, client: { select: { name: true } }, project: { select: { name: true } },
  category: true, systemRef: true, moduleRef: true, dueDate: true, respondBy: true, resolveBy: true, firstResponseAt: true, resolvedAt: true, createdAt: true,
  fieldValues: { select: { fieldId: true, value: true } },
} as const;
