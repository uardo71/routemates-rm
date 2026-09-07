import "server-only";
import type { Prisma } from "@prisma/client";
import { fieldsForType, type TicketConfig, type LoadedField } from "@/lib/ticket-config.server";

export function coerceField(field: LoadedField, raw: unknown): Prisma.InputJsonValue | null {
  if (raw === null || raw === undefined || raw === "") return null;
  switch (field.kind) {
    case "NUMBER": {
      const n = typeof raw === "number" ? raw : parseFloat(String(raw));
      return Number.isFinite(n) ? n : null;
    }
    case "CHECKBOX":
      return raw === true || raw === "true" || raw === "on" ? true : null;
    case "MULTISELECT": {
      const arr = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      const valid = arr.filter((v) => field.options.includes(v));
      return valid.length ? valid : null;
    }
    case "SELECT": {
      const v = String(raw);
      return field.options.includes(v) ? v : null;
    }
    case "DATE":
      return String(raw).slice(0, 10);
    case "USER":
      return String(raw);
    default:
      return String(raw).slice(0, 8000);
  }
}

/** Upsert/delete a ticket's custom field values. `rawById` maps fieldId → raw value.
 *  `customerScope` restricts which fields may be written: "editable" (portal edits) or
 *  "creatable" (portal create — any customer-visible field). */
export async function applyFieldValues(
  tx: Prisma.TransactionClient, ticketId: string, typeId: string,
  rawById: Record<string, unknown>, cfg: TicketConfig,
  customerScope?: "editable" | "creatable",
) {
  const fields = fieldsForType(cfg, typeId);
  for (const f of fields) {
    if (customerScope === "editable" && !f.customerEditable) continue;
    if (customerScope === "creatable" && !f.customerVisible) continue;
    if (!(f.id in rawById)) continue;
    const value = coerceField(f, rawById[f.id]);
    if (value === null) {
      await tx.ticketFieldValue.deleteMany({ where: { ticketId, fieldId: f.id } });
    } else {
      await tx.ticketFieldValue.upsert({
        where: { ticketId_fieldId: { ticketId, fieldId: f.id } },
        create: { ticketId, fieldId: f.id, value },
        update: { value },
      });
    }
  }
}

export function fieldRawFromForm(formData: FormData, cfg: TicketConfig, typeId: string): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const f of fieldsForType(cfg, typeId)) {
    const key = `cf:${f.id}`;
    if (f.kind === "MULTISELECT") raw[f.id] = formData.getAll(key).map(String);
    else if (f.kind === "CHECKBOX") raw[f.id] = formData.get(key) != null;
    else if (formData.has(key)) raw[f.id] = formData.get(key);
  }
  return raw;
}
