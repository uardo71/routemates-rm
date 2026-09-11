// Pure half of the audit log (no Prisma): field-level diffs, money redaction and the one-line
// summary. `src/lib/audit.ts` is the server half that writes rows inside a transaction.

export type Scalar = string | number | boolean | null;
export type FieldChange = { from: Scalar; to: Scalar };
export type AuditDiff = Record<string, FieldChange>;
export type AuditAction = "create" | "update" | "delete";

/** What the `diff` Json column holds. `label` names the record for the summary (e.g. "INV-0003");
 *  `parent` is the record whose History card should list this entry (an invoice line's invoice). */
export type AuditPayload = {
  label?: string | null;
  parent?: { entityType: string; entityId: string } | null;
  fields: AuditDiff;
};

export const REDACTED = "•••";

/** Never worth diffing: identity, timestamps Prisma maintains, and anything secret-shaped. */
const SKIP_FIELDS = new Set(["id", "createdAt", "updatedAt", "companyId", "passwordHash"]);

/** Fields whose values are confidential to readers without `rates:view:any`. Matched by name so a
 *  new money column on any audited model is redacted by default rather than leaked by omission. */
const MONEY_RE = /(amount|price|rate|cost|fee|value|salary|commission|margin)/i;
const NOT_MONEY_RE = /(hours|date|type|currency|id|name|number|reference|note|open)$/i;
export function isMoneyField(name: string): boolean {
  return MONEY_RE.test(name) && !NOT_MONEY_RE.test(name);
}

function isDecimalLike(v: unknown): v is { toNumber(): number } {
  return typeof v === "object" && v !== null && typeof (v as { toNumber?: unknown }).toNumber === "function";
}

/** Collapses a Prisma scalar to something JSON-safe and comparable. `undefined` ⇒ not a scalar
 *  (relation, array, Json blob) — the caller skips those keys. */
export function normalizeValue(v: unknown): Scalar | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (isDecimalLike(v)) return v.toNumber();
  return undefined;
}

function same(a: Scalar, b: Scalar): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  return a === b;
}

/** Field-level diff of two records. Only keys present on either side are compared; relations and
 *  Json blobs are ignored; `fields` restricts the comparison to an allow-list. A create is
 *  `diffFields(null, after)` (only non-null values appear), a delete is `diffFields(before, null)`. */
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  fields?: readonly string[],
): AuditDiff {
  const keys = fields ? [...fields] : [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  const out: AuditDiff = {};
  for (const key of keys) {
    if (SKIP_FIELDS.has(key)) continue;
    const from = before ? normalizeValue(before[key]) : null;
    const to = after ? normalizeValue(after[key]) : null;
    if (from === undefined && to === undefined) continue;
    const f = from ?? null;
    const t = to ?? null;
    if (!before && t === null) continue; // create: don't list every unset column
    if (!after && f === null) continue; // delete: same
    // On a create/delete the parent/foreign keys are just plumbing (an invoice line's invoiceId);
    // on an update a changed key (managerId, approverId) is the point, so those stay.
    if ((!before || !after) && /Id$/.test(key)) continue;
    if (before && after && same(f, t)) continue;
    out[key] = { from: f, to: t };
  }
  return out;
}

/** Hides money values while keeping the fact that the field changed. */
export function redactDiff(diff: AuditDiff): AuditDiff {
  const out: AuditDiff = {};
  for (const [k, v] of Object.entries(diff)) {
    out[k] = isMoneyField(k) ? { from: v.from === null ? null : REDACTED, to: v.to === null ? null : REDACTED } : v;
  }
  return out;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export const AUDIT_VALUE_PREVIEW = 40;
/** Human form of a value; long text is cut at `max` chars (pass Infinity for the full text). */
export function formatAuditValue(v: Scalar, max = AUDIT_VALUE_PREVIEW): string {
  if (v === null) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000);
  if (ISO_DATE_RE.test(v)) return v.slice(0, 10);
  return v.length > max ? `${v.slice(0, max - 3)}…` : v;
}
/** True when the preview would hide part of the value — the UI offers "show full" then. */
export function isTruncatedValue(v: Scalar, max = AUDIT_VALUE_PREVIEW): boolean {
  return typeof v === "string" && !ISO_DATE_RE.test(v) && v.length > max;
}

// ---------- fields that point at another record ----------

export type ReferenceKind = "user" | "contact" | "client" | "project" | "milestone" | "opportunity" | "task" | "engagement" | "planTask" | "invoice";

/** Fields holding another record's id. The history shows that record's NAME, labelled by what it
 *  is ("sponsor", not "sponsor contact id"). Resolved when read, so old entries read right too. */
const REFERENCE_FIELDS: Record<string, { kind: ReferenceKind; label: string }> = {
  sponsorContactId: { kind: "contact", label: "sponsor" },
  contactId: { kind: "contact", label: "contact" },
  managerId: { kind: "user", label: "manager" },
  ownerId: { kind: "user", label: "owner" },
  ownerUserId: { kind: "user", label: "owner" },
  userId: { kind: "user", label: "person" },
  approverId: { kind: "user", label: "approver" },
  submittedById: { kind: "user", label: "submitted by" },
  decidedById: { kind: "user", label: "decided by" },
  createdById: { kind: "user", label: "created by" },
  completedById: { kind: "user", label: "completed by" },
  doneById: { kind: "user", label: "done by" },
  writtenOffById: { kind: "user", label: "written off by" },
  activationOverrideById: { kind: "user", label: "start override by" },
  closureOverrideById: { kind: "user", label: "close override by" },
  uatRecordedById: { kind: "user", label: "UAT recorded by" },
  clientId: { kind: "client", label: "client" },
  projectId: { kind: "project", label: "project" },
  parentProjectId: { kind: "project", label: "programme" },
  milestoneId: { kind: "milestone", label: "milestone" },
  opportunityId: { kind: "opportunity", label: "opportunity" },
  taskId: { kind: "task", label: "task" },
  engagementId: { kind: "engagement", label: "end customer" },
  dependsOnId: { kind: "planTask", label: "starts after" },
  creditNoteForId: { kind: "invoice", label: "credit note for" },
};

export function referenceKind(name: string): ReferenceKind | null {
  return REFERENCE_FIELDS[name]?.kind ?? null;
}

/** The label summaries used before reference fields had names ("sponsor contact id"). */
export function legacyFieldLabel(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

/** camelCase → words: "recognitionDate" → "recognition date"; a link to another record is named by
 *  what it points at ("sponsorContactId" → "sponsor", "invoiceLineId" → "invoice line"). */
export function fieldLabel(name: string): string {
  const ref = REFERENCE_FIELDS[name];
  if (ref) return ref.label;
  return legacyFieldLabel(name.replace(/([a-z0-9])Id$/, "$1"));
}

/** Every referenced id in these diffs, grouped by the kind of record it points at. */
export function referenceIds(diffs: AuditDiff[]): Map<ReferenceKind, Set<string>> {
  const out = new Map<ReferenceKind, Set<string>>();
  for (const diff of diffs) {
    for (const [name, change] of Object.entries(diff)) {
      const kind = referenceKind(name);
      if (!kind) continue;
      for (const v of [change.from, change.to]) {
        if (typeof v !== "string" || v === REDACTED) continue;
        (out.get(kind) ?? out.set(kind, new Set()).get(kind)!).add(v);
      }
    }
  }
  return out;
}

export function hasReferences(diff: AuditDiff): boolean {
  return Object.keys(diff).some((k) => referenceKind(k) !== null);
}

/** The diff with referenced ids swapped for names. An id that no longer resolves reads "(deleted)". */
export function resolveReferences(diff: AuditDiff, names: Map<string, string>): AuditDiff {
  if (!hasReferences(diff)) return diff;
  const swap = (v: Scalar): Scalar => (typeof v === "string" && v !== REDACTED ? names.get(v) ?? "(deleted)" : v);
  const out: AuditDiff = {};
  for (const [name, change] of Object.entries(diff)) {
    out[name] = referenceKind(name) ? { from: swap(change.from), to: swap(change.to) } : change;
  }
  return out;
}

const SUMMARY_MAX_FIELDS = 3;

/** One line a person can read in a list: "Invoice INV-0003: status DRAFT → ISSUED, due date — → 2026-10-01". */
export function summarize(input: { entityType: string; action: AuditAction | string; label?: string | null; diff: AuditDiff; note?: string | null }, labelOf: (name: string) => string = fieldLabel): string {
  const fieldLabel = labelOf;
  const subject = input.label ? `${input.entityType} ${input.label}` : input.entityType;
  const entries = Object.entries(input.diff);
  const tail = input.note ? ` — ${input.note}` : "";
  if (input.action === "create") {
    const shown = entries.slice(0, SUMMARY_MAX_FIELDS).map(([k, v]) => `${fieldLabel(k)} ${formatAuditValue(v.to)}`);
    const rest = entries.length - shown.length;
    return `${subject} created${shown.length ? ` (${shown.join(", ")}${rest > 0 ? `, +${rest} more` : ""})` : ""}${tail}`;
  }
  if (input.action === "delete") return `${subject} deleted${tail}`;
  const shown = entries.slice(0, SUMMARY_MAX_FIELDS).map(([k, v]) => `${fieldLabel(k)} ${formatAuditValue(v.from)} → ${formatAuditValue(v.to)}`);
  const rest = entries.length - shown.length;
  const body = shown.length ? `${shown.join(", ")}${rest > 0 ? `, +${rest} more` : ""}` : "no field changes";
  return `${subject}: ${body}${tail}`;
}

/** The note a stored summary carried (" — why"), recovered by re-summarising the stored diff without
 *  it — in today's wording or the legacy one. "" when there was no note; null when the stored text
 *  doesn't match either (then the caller keeps it as it is). */
export function summaryTail(stored: string, input: { entityType: string; action: AuditAction | string; label?: string | null; diff: AuditDiff }): string | null {
  for (const labelOf of [fieldLabel, legacyFieldLabel]) {
    const plain = summarize(input, labelOf);
    if (stored.startsWith(plain)) return stored.slice(plain.length);
  }
  return null;
}

/** True when a diff touches any confidential field — used to badge redacted entries. */
export function hasMoneyChange(diff: AuditDiff): boolean {
  return Object.keys(diff).some(isMoneyField);
}
