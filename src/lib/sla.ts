import type { TicketPriority } from "@prisma/client";
import { SLA_HOURS, TICKET_PRIORITIES, fmtHours } from "@/lib/ticket";

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
