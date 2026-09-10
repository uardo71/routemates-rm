import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, type SessionUser } from "@/lib/permissions";
import { diffFields, redactDiff, summarize, hasMoneyChange, type AuditAction, type AuditDiff, type AuditPayload } from "@/lib/audit-diff";

// Server half of the audit log. `recordAudit` takes the caller's transaction client so the log
// row commits — or rolls back — together with the change it describes. Rows are never updated or
// deleted: the table carries a DB trigger that rejects both (migration `audit_log`).

type Db = PrismaClient | Prisma.TransactionClient;

export type AuditEntityType =
  | "Invoice"
  | "InvoiceLine"
  | "InvoicePayment"
  | "Milestone"
  | "MilestoneAdjustment"
  | "Assignment"
  | "Salary"
  | "Employment"
  | "TimeCard"
  | "LeaveRequest"
  | "Expense"
  | "Opportunity"
  | "Project";

export const AUDIT_ENTITY_TYPES: AuditEntityType[] = [
  "Invoice", "InvoiceLine", "InvoicePayment", "Milestone", "MilestoneAdjustment", "Assignment",
  "Salary", "Employment", "TimeCard", "LeaveRequest", "Expense", "Opportunity", "Project",
];

export type RecordAuditInput = {
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  actor: Pick<SessionUser, "id" | "companyId">;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Restrict the diff to these fields (default: every scalar on either side). */
  fields?: readonly string[];
  /** Human handle for the record in the summary, e.g. "INV-0003" or "Rollout Colombia". */
  label?: string | null;
  /** The record whose History card lists this entry (an invoice line → its invoice). */
  parent?: { entityType: AuditEntityType; entityId: string } | null;
  /** Free text appended to the summary, e.g. the approval comment. */
  note?: string | null;
};

/** Writes one audit row on `tx`. An update with no field changes (and no note) writes nothing. */
export async function recordAudit(tx: Db, input: RecordAuditInput): Promise<void> {
  const fields = diffFields(
    input.action === "create" ? null : input.before ?? null,
    input.action === "delete" ? null : input.after ?? null,
    input.fields,
  );
  if (input.action === "update" && Object.keys(fields).length === 0 && !input.note) return;
  const payload: AuditPayload = { label: input.label ?? null, parent: input.parent ?? null, fields };
  await tx.auditLog.create({
    data: {
      companyId: input.actor.companyId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorId: input.actor.id,
      summary: summarize({ entityType: input.entityType, action: input.action, label: input.label, diff: fields, note: input.note }),
      diff: payload as unknown as Prisma.InputJsonValue,
    },
  });
}

export type AuditEntry = {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  entityType: string;
  entityId: string;
  action: string;
  label: string | null;
  summary: string;
  fields: AuditDiff;
  /** True when money fields were hidden from this reader. */
  redacted: boolean;
};

function parsePayload(raw: unknown): AuditPayload {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<AuditPayload>;
  return { label: p.label ?? null, parent: p.parent ?? null, fields: (p.fields && typeof p.fields === "object" ? p.fields : {}) as AuditDiff };
}

export type AuditRow = { id: string; at: Date; actorId: string; entityType: string; entityId: string; action: string; summary: string; diff: unknown };

/** Shapes rows for a reader: resolves actor names and redacts money unless they hold rates:view:any. */
export async function presentAudit(rows: AuditRow[], reader: SessionUser): Promise<AuditEntry[]> {
  const canSeeMoney = can(reader, "rates:view:any");
  const actorIds = [...new Set(rows.map((r) => r.actorId))];
  const users = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => {
    const payload = parsePayload(r.diff);
    const redacted = !canSeeMoney && hasMoneyChange(payload.fields);
    const fields = canSeeMoney ? payload.fields : redactDiff(payload.fields);
    return {
      id: r.id,
      at: r.at.toISOString(),
      actorId: r.actorId,
      actorName: nameById.get(r.actorId) ?? "Deleted user",
      entityType: r.entityType,
      entityId: r.entityId,
      action: r.action,
      label: payload.label ?? null,
      // The stored summary carries real amounts; rebuild it from the redacted diff for this reader.
      summary: redacted ? summarize({ entityType: r.entityType, action: r.action, label: payload.label, diff: fields }) : r.summary,
      fields,
      redacted,
    };
  });
}

const ROW_SELECT = { id: true, at: true, actorId: true, entityType: true, entityId: true, action: true, summary: true, diff: true } as const;

/** Every entry for one record plus the entries of its children (lines, payments, milestones…),
 *  newest first. The parent link lives in the Json payload so removed children stay listed. */
export async function loadAuditFor(reader: SessionUser, entityType: AuditEntityType, entityId: string, limit = 200): Promise<AuditEntry[]> {
  const rows = await prisma.auditLog.findMany({
    where: {
      companyId: reader.companyId,
      OR: [
        { entityType, entityId },
        { AND: [{ diff: { path: ["parent", "entityType"], equals: entityType } }, { diff: { path: ["parent", "entityId"], equals: entityId } }] },
      ],
    },
    orderBy: { at: "desc" },
    take: limit,
    select: ROW_SELECT,
  });
  return presentAudit(rows, reader);
}

export type AuditFilter = { entityType?: string | null; actorId?: string | null; from?: Date | null; to?: Date | null; q?: string | null };

/** The /admin/audit query: company-wide, filtered, newest first. */
export async function loadAuditLog(reader: SessionUser, filter: AuditFilter, limit = 500): Promise<AuditEntry[]> {
  const rows = await prisma.auditLog.findMany({
    where: {
      companyId: reader.companyId,
      ...(filter.entityType ? { entityType: filter.entityType } : {}),
      ...(filter.actorId ? { actorId: filter.actorId } : {}),
      ...(filter.from || filter.to ? { at: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } } : {}),
      ...(filter.q ? { summary: { contains: filter.q, mode: "insensitive" } } : {}),
    },
    orderBy: { at: "desc" },
    take: limit,
    select: ROW_SELECT,
  });
  return presentAudit(rows, reader);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Shared with the export route so both read the same query string the same way. */
export function parseAuditFilter(sp: Record<string, string | string[] | undefined>): AuditFilter & { fromStr: string; toStr: string } {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]) ?? "";
  const fromStr = DATE_RE.test(one("from")) ? one("from") : "";
  const toStr = DATE_RE.test(one("to")) ? one("to") : "";
  const entityType = one("entity");
  return {
    entityType: (AUDIT_ENTITY_TYPES as string[]).includes(entityType) ? entityType : null,
    actorId: one("actor") || null,
    from: fromStr ? new Date(`${fromStr}T00:00:00.000Z`) : null,
    to: toStr ? new Date(`${toStr}T23:59:59.999Z`) : null,
    q: one("q").trim().slice(0, 200) || null,
    fromStr,
    toStr,
  };
}
