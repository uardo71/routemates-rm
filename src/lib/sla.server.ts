import "server-only";
import type { TicketPriority } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeTargets, DEFAULT_SLA_TARGETS, type SlaTargets } from "@/lib/sla";
import { addHours } from "@/lib/ticket";

/** A ticket's respond/resolve deadlines counted from `base` (its creation) — none at all for a type
 *  without SLA (change requests are tracked by stage instead). */
export async function slaDeadlines(
  companyId: string, clientId: string | null, priority: TicketPriority, slaExempt: boolean, base: Date,
): Promise<{ respondBy: Date | null; resolveBy: Date | null }> {
  if (slaExempt) return { respondBy: null, resolveBy: null };
  const t = (await resolveSlaTargets(companyId, clientId))[priority];
  return { respondBy: addHours(base, t.respond), resolveBy: addHours(base, t.resolve) };
}

/** The SLA targets that apply to a ticket: the client override if one exists, else the company
 *  default, else the built-in fallback. */
export async function resolveSlaTargets(companyId: string, clientId: string | null): Promise<SlaTargets> {
  const policies = await prisma.slaPolicy.findMany({
    where: { companyId, clientId: clientId ? { in: [clientId] } : null },
  });
  // When clientId is set, the query returns only that client's row; when null, only the default.
  if (clientId) {
    const clientP = policies.find((p) => p.clientId === clientId);
    if (clientP) return normalizeTargets(clientP.targets);
    // Fall back to the company default.
    const def = await prisma.slaPolicy.findFirst({ where: { companyId, clientId: null } });
    return def ? normalizeTargets(def.targets) : DEFAULT_SLA_TARGETS;
  }
  const def = policies.find((p) => p.clientId === null);
  return def ? normalizeTargets(def.targets) : DEFAULT_SLA_TARGETS;
}

/** Company default targets (for the settings screen), always a complete object. */
export async function getCompanySlaDefault(companyId: string): Promise<SlaTargets> {
  const def = await prisma.slaPolicy.findFirst({ where: { companyId, clientId: null } });
  return def ? normalizeTargets(def.targets) : DEFAULT_SLA_TARGETS;
}

/** Per-client override targets, or null when the client uses the company default. */
export async function getClientSlaOverride(companyId: string, clientId: string): Promise<SlaTargets | null> {
  const row = await prisma.slaPolicy.findFirst({ where: { companyId, clientId } });
  return row ? normalizeTargets(row.targets) : null;
}
