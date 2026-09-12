import type { TicketPriority } from "@prisma/client";
import type { TicketStatusCategory } from "@prisma/client";
import { SLA_HOURS, TICKET_PRIORITIES, fmtHours } from "@/lib/ticket";
import { isOpenCategory } from "@/lib/ticket-config";

// Client+server-safe SLA target vocabulary. Targets are response/resolution hours per priority.
export type SlaTarget = { respond: number; resolve: number };
export type SlaTargets = Record<TicketPriority, SlaTarget>;

// The built-in fallback used when a company hasn't customised anything.
export const DEFAULT_SLA_TARGETS: SlaTargets = SLA_HOURS;

/** Where a ticket's targets came from — shown next to them, so "respond 4h" is never a mystery. */
export type SlaSource = "client" | "company" | "builtin";
export const SLA_SOURCE_LABEL: Record<SlaSource, string> = {
  client: "Client override",
  company: "Company policy",
  builtin: "Built-in default",
};
export type ResolvedSla = { targets: SlaTargets; source: SlaSource };

/** Coerce arbitrary JSON into a complete, valid SlaTargets, filling gaps from the default. */
export function normalizeTargets(v: unknown): SlaTargets {
  const src = v && typeof v === "object" ? (v as Record<string, { respond?: unknown; resolve?: unknown }>) : {};
  const out = {} as SlaTargets;
  for (const p of TICKET_PRIORITIES) {
    const r = Number(src[p]?.respond);
    const s = Number(src[p]?.resolve);
    out[p] = {
      respond: Number.isFinite(r) && r > 0 ? r : SLA_HOURS[p].respond,
      resolve: Number.isFinite(s) && s > 0 ? s : SLA_HOURS[p].resolve,
    };
  }
  return out;
}

/** THE resolution order, in one pure place: the client's own override wins, then the company
 *  policy, then the built-in default. Pure so the new-ticket form can re-resolve as you change the
 *  client in the form, without another round trip. */
export function pickPolicy(
  policies: { clientId: string | null; targets: unknown }[],
  clientId: string | null,
): ResolvedSla {
  const own = clientId ? policies.find((p) => p.clientId === clientId) : undefined;
  if (own) return { targets: normalizeTargets(own.targets), source: "client" };
  const company = policies.find((p) => p.clientId === null);
  if (company) return { targets: normalizeTargets(company.targets), source: "company" };
  return { targets: DEFAULT_SLA_TARGETS, source: "builtin" };
}

export function targetsLabel(t: SlaTargets, p: TicketPriority): string {
  return `respond ${fmtHours(t[p].respond)} · resolve ${fmtHours(t[p].resolve)}`;
}

/** Derive a "respond Xh · resolve Yh" label straight from a ticket's absolute SLA timestamps,
 *  so the detail page reflects whatever policy was applied at creation without a DB lookup. */
export function labelFromTimestamps(createdAt: string, respondBy: string, resolveBy: string): string {
  const base = new Date(createdAt).getTime();
  const rh = respondBy ? Math.round((new Date(respondBy).getTime() - base) / 3_600_000) : 0;
  const sh = resolveBy ? Math.round((new Date(resolveBy).getTime() - base) / 3_600_000) : 0;
  if (!rh && !sh) return "";
  return `respond ${fmtHours(rh)} · resolve ${fmtHours(sh)}`;
}

// ---------------------------------------------------------------------------------------------
// Which of four SLA states a ticket is in: On track · At risk · Breached · No SLA.
//
// This lives here, in the pure module, rather than beside the badge component, because the SERVER
// needs the same answer — the actions register asks "is this ticket urgent?" and must get the exact
// verdict the badge draws. One implementation, two callers. `tickets/sla.tsx` re-exports it for the
// screens that were already importing it from there.
// ---------------------------------------------------------------------------------------------

/** How close to a target counts as "at risk" — the threshold the amber pill has always used. */
export const SLA_AT_RISK_MS = 4 * 3_600_000;

export type SlaBadgeKind = "on_track" | "at_risk" | "breached" | "none";

export type SlaBadgeState = {
  kind: SlaBadgeKind;
  /** False wherever the app draws nothing: a type with no SLA, a stopped clock, or no target. */
  show: boolean;
  /** "On track" / "At risk" / "Breached" / "No SLA". */
  label: string;
  /** The clock in words — "respond in 3h", "resolve overdue by 2h". Empty when there is no clock. */
  detail: string;
};

/** Everything the verdict needs. `TicketRow` satisfies it structurally, and so does a Prisma row
 *  mapped to ISO strings — which is why this is not `Pick<TicketRow, …>`. */
export type SlaClock = {
  statusCategory: TicketStatusCategory;
  firstResponseAt: string;
  respondBy: string;
  resolveBy: string;
  slaApplicable: boolean;
};

export const SLA_BADGE_LABEL: Record<SlaBadgeKind, string> = {
  on_track: "On track",
  at_risk: "At risk",
  breached: "Breached",
  none: "No SLA",
};

const NO_SLA: SlaBadgeState = { kind: "none", show: false, label: SLA_BADGE_LABEL.none, detail: "" };

function relIn(ms: number): string {
  const h = Math.round(ms / 3_600_000);
  return h < 24 ? `in ${Math.max(1, h)}h` : `in ${Math.round(h / 24)}d`;
}
function overdueBy(ms: number): string {
  const h = Math.round(ms / 3_600_000);
  return h < 24 ? `overdue by ${Math.max(1, h)}h` : `overdue by ${Math.round(h / 24)}d`;
}

/** `now` is injectable so the boundaries can be tested. */
export function slaBadgeState(r: SlaClock, now: number = Date.now()): SlaBadgeState {
  if (!r.slaApplicable) return NO_SLA;
  // The clock stops when the ticket leaves an open status; a closed ticket is not "on track".
  if (!isOpenCategory(r.statusCategory)) return NO_SLA;
  const responded = !!r.firstResponseAt;
  const targetIso = responded ? r.resolveBy : r.respondBy;
  if (!targetIso) return NO_SLA;

  const kind = responded ? "resolve" : "respond";
  const left = new Date(targetIso).getTime() - now;
  if (left <= 0) return { kind: "breached", show: true, label: SLA_BADGE_LABEL.breached, detail: `${kind} ${overdueBy(-left)}` };
  const at = left < SLA_AT_RISK_MS ? "at_risk" : "on_track";
  return { kind: at, show: true, label: SLA_BADGE_LABEL[at], detail: `${kind} ${relIn(left)}` };
}
