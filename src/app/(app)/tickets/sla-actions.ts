"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { normalizeTargets } from "@/lib/sla";

/** Save the company-wide default SLA targets. */
export async function saveCompanySlaAction(targets: unknown): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!can(user, "tickets:manage")) return { error: "Forbidden" };
  const norm = normalizeTargets(targets) as unknown as Prisma.InputJsonValue;
  const existing = await prisma.slaPolicy.findFirst({ where: { companyId: user.companyId, clientId: null }, select: { id: true } });
  if (existing) await prisma.slaPolicy.update({ where: { id: existing.id }, data: { targets: norm } });
  else await prisma.slaPolicy.create({ data: { companyId: user.companyId, clientId: null, targets: norm } });
  revalidatePath("/tickets/settings");
  revalidatePath("/tickets");
  return {};
}

/** Save (targets object) or clear (null → use company default) a client's SLA override. */
export async function saveClientSlaAction(clientId: string, targets: unknown | null): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!can(user, "tickets:manage")) return { error: "Forbidden" };
  const client = await prisma.client.findFirst({ where: { id: clientId, companyId: user.companyId }, select: { id: true } });
  if (!client) return { error: "Client not found" };
  const existing = await prisma.slaPolicy.findFirst({ where: { companyId: user.companyId, clientId }, select: { id: true } });
  if (targets === null) {
    if (existing) await prisma.slaPolicy.delete({ where: { id: existing.id } });
  } else {
    const norm = normalizeTargets(targets) as unknown as Prisma.InputJsonValue;
    if (existing) await prisma.slaPolicy.update({ where: { id: existing.id }, data: { targets: norm } });
    else await prisma.slaPolicy.create({ data: { companyId: user.companyId, clientId, targets: norm } });
  }
  revalidatePath(`/admin/clients/${clientId}`);
  return {};
}
