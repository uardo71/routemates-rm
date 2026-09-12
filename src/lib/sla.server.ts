import "server-only";
import type { TicketPriority } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeTargets, pickPolicy, type ResolvedSla, type SlaTargets } from "@/lib/sla";
import { addHours } from "@/lib/ticket";

/** A ticket's respond/resolve deadlines counted from `base` (its creation) — none at all for a type
 *  without SLA (change requests and bugs are tracked by stage instead). */
export async function slaDeadlines(
  companyId: string, clientId: string | null, priority: TicketPriority, slaExempt: boolean, base: Date,
): Promise<{ respondBy: Date | null; resolveBy: Date | null }> {
  if (slaExempt) return { respondBy: null, resolveBy: null };
  const t = (await resolvedSlaPolicy(companyId, clientId)).targets;
  return { respondBy: addHours(base, t[priority].respond), resolveBy: addHours(base, t[priority].resolve) };
}

/** The targets that apply to a ticket AND which policy they came from: the client's override, else
 *  the company default, else the built-in fallback. One query; the order itself lives in the pure
 *  `pickPolicy`, so display and calculation can never drift apart. */
export async function resolvedSlaPolicy(companyId: string, clientId: string | null): Promise<ResolvedSla> {
  const policies = await prisma.slaPolicy.findMany({ where: { companyId }, select: { clientId: true, targets: true } });
  return pickPolicy(policies, clientId);
}

/** Every policy a company has, normalised — for screens that resolve per client in memory (the
 *  new-ticket form re-resolves as you change the client). */
export async function companySlaPolicies(companyId: string): Promise<{ clientId: string | null; targets: SlaTargets }[]> {
  const rows = await prisma.slaPolicy.findMany({ where: { companyId }, select: { clientId: true, targets: true } });
  return rows.map((r) => ({ clientId: r.clientId, targets: normalizeTargets(r.targets) }));
}

/** The targets that apply to a ticket (the client override if one exists, else the company default,
 *  else the built-in fallback). */
export async function resolveSlaTargets(companyId: string, clientId: string | null): Promise<SlaTargets> {
  return (await resolvedSlaPolicy(companyId, clientId)).targets;
}

/** Company default targets (for the settings screen), always a complete object. */
export async function getCompanySlaDefault(companyId: string): Promise<SlaTargets> {
  const def = await prisma.slaPolicy.findFirst({ where: { companyId, clientId: null } });
  return def ? normalizeTargets(def.targets) : normalizeTargets(null);
}

/** Per-client override targets, or null when the client uses the company default. */
export async function getClientSlaOverride(companyId: string, clientId: string): Promise<SlaTargets | null> {
  const row = await prisma.slaPolicy.findFirst({ where: { companyId, clientId } });
  return row ? normalizeTargets(row.targets) : null;
}
