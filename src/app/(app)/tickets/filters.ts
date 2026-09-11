import type { TicketPriority, TicketStatusCategory } from "@prisma/client";
import { isOpenCategory } from "@/lib/ticket-config";
import type { TicketRow } from "./serialize";
import { columnValue } from "./columns";

/** The drill-downs behind the overview numbers. Each must select exactly the tickets that number
 *  counted, so clicking "2 breached" shows precisely those 2. */
export type TicketFocus = "open" | "breached" | "unassigned" | "critical" | "resolved7d";
export const FOCUS_LABEL: Record<TicketFocus, string> = {
  open: "Open", breached: "SLA breached", unassigned: "Unassigned", critical: "Critical", resolved7d: "Resolved (7 days)",
};

/** People and clients are matched by ACCOUNT ID, never by name — two people or two clients can share
 *  a name. Views saved before this carried `assigneeNames` / `clientNames`; `normalizeFilters`
 *  translates those when a view is read. */
export type TicketFilters = {
  focus?: TicketFocus | null;
  text?: string;
  typeIds?: string[];
  statusIds?: string[];
  statusCategories?: TicketStatusCategory[];
  priorities?: TicketPriority[];
  assigneeIds?: string[];
  clientIds?: string[];
  onlyOpen?: boolean;
  mine?: "assigned" | "requested" | null;
};

type Named = { id: string; name: string };
type LegacyFilters = TicketFilters & { assigneeNames?: string[]; clientNames?: string[] };
/** Prefix for a legacy name that matches no account today — it keeps matching nothing, as it did. */
export const MISSING_ID = "missing:";

/** Reads stored/posted filters. Legacy name lists become id lists, with no database write (the next
 *  save stores ids): a name shared by several accounts keeps all of them — exactly what the old
 *  name filter matched — and a name nobody has any more keeps matching nothing. */
export function normalizeFilters(raw: unknown, people: Named[], clients: Named[]): TicketFilters {
  const f: LegacyFilters = { ...((raw && typeof raw === "object" ? raw : {}) as LegacyFilters) };
  const idsFor = (names: string[], list: Named[]) =>
    names.flatMap((n) => {
      const ids = list.filter((x) => x.name === n).map((x) => x.id);
      return ids.length > 0 ? ids : [`${MISSING_ID}${n}`];
    });
  if (Array.isArray(f.assigneeNames) && f.assigneeNames.length > 0) {
    f.assigneeIds = [...new Set([...(f.assigneeIds ?? []), ...idsFor(f.assigneeNames, people)])];
  }
  if (Array.isArray(f.clientNames) && f.clientNames.length > 0) {
    f.clientIds = [...new Set([...(f.clientIds ?? []), ...idsFor(f.clientNames, clients)])];
  }
  delete f.assigneeNames;
  delete f.clientNames;
  return f;
}

function has(arr: string[] | undefined, v: string): boolean {
  return !arr || arr.length === 0 || arr.includes(v);
}

export function filterRows(rows: TicketRow[], f: TicketFilters, currentUserId: string): TicketRow[] {
  const needle = (f.text ?? "").trim().toLowerCase();
  const now = Date.now();
  const weekAgo = now - 7 * 86_400_000;
  return rows.filter((r) => {
    if (f.focus) {
      const open = isOpenCategory(r.statusCategory);
      switch (f.focus) {
        case "open": if (!open) return false; break;
        case "unassigned": if (!open || r.assigneeName) return false; break;
        case "critical": if (!open || r.priority !== "CRITICAL") return false; break;
        case "breached": {
          // Same rule as the SLA pill and the overview: respond-by until answered, then resolve-by.
          const target = r.firstResponseAt ? r.resolveBy : r.respondBy;
          if (!open || !target || now <= new Date(target).getTime()) return false;
          break;
        }
        case "resolved7d": if (!r.resolvedAt || new Date(r.resolvedAt).getTime() < weekAgo) return false; break;
      }
    }
    if (f.onlyOpen && !isOpenCategory(r.statusCategory)) return false;
    if (f.typeIds && f.typeIds.length && !f.typeIds.includes(r.typeId)) return false;
    if (f.statusIds && f.statusIds.length && !f.statusIds.includes(r.statusId)) return false;
    if (f.statusCategories && f.statusCategories.length && !f.statusCategories.includes(r.statusCategory)) return false;
    if (f.priorities && f.priorities.length && !f.priorities.includes(r.priority)) return false;
    if (!has(f.assigneeIds, r.assigneeId ?? "")) return false;
    if (!has(f.clientIds, r.clientId ?? "")) return false;
    if (f.mine === "assigned" && r.assigneeId !== currentUserId) return false;
    if (f.mine === "requested" && r.requesterId !== currentUserId) return false;
    if (needle) {
      const hay = [r.number, r.title, r.clientName ?? "", r.projectName ?? "", r.assigneeName ?? "", r.requesterName, r.systemRef, r.moduleRef, r.typeName, r.statusName].join(" ").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export function sortRows(rows: TicketRow[], sort: { key: string; dir: "asc" | "desc" } | null): TicketRow[] {
  if (!sort) return rows;
  const PRIORITY_RANK: Record<TicketPriority, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
  const dir = sort.dir === "asc" ? 1 : -1;
  const val = (r: TicketRow): string | number => {
    switch (sort.key) {
      case "priority": return PRIORITY_RANK[r.priority];
      case "number": return r.number;
      case "title": return r.title.toLowerCase();
      case "type": return r.typeName.toLowerCase();
      case "status": return r.statusName.toLowerCase();
      case "assignee": return (r.assigneeName ?? "").toLowerCase();
      case "client": return (r.clientName ?? "").toLowerCase();
      case "dueDate": return r.dueDate || "9999";
      case "createdAt": return r.createdAt;
      // Anything else (system, module, category, resolveBy, custom "cf:" fields) sorts by its display text.
      default: return columnValue(r, sort.key).toLowerCase();
    }
  };
  return [...rows].sort((a, b) => {
    const av = val(a), bv = val(b);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}
