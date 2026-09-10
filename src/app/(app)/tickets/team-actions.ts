"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { STAFF_ONLY } from "@/lib/permissions";

// Staffing an account is an ACCESS decision, not a preference: membership grants — and, for anyone
// who isn't an admin, scopes — the right to see and triage every ticket that client raises. So it's
// gated like user administration (`users:manage`), not like editing a client's address.

const MemberSchema = z.object({
  clientId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["LEAD", "MEMBER"]).default("MEMBER"),
});
export type ClientTeamMemberInput = z.infer<typeof MemberSchema>;

function revalidateFor(clientId: string) {
  revalidatePath("/tickets");
  revalidatePath("/tickets/all");
  revalidatePath(`/tickets/c/${clientId}`);
  revalidatePath(`/admin/clients/${clientId}`);
}

export async function addClientTeamMemberAction(input: ClientTeamMemberInput): Promise<{ error?: string }> {
  const user = await requirePermission("users:manage");
  const parsed = MemberSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { clientId, userId, role } = parsed.data;

  const [client, member] = await Promise.all([
    prisma.client.findFirst({ where: { id: clientId, companyId: user.companyId }, select: { id: true } }),
    // Portal (CUSTOMER) accounts are the client's own people — never on our side of the desk.
    prisma.user.findFirst({ where: { id: userId, companyId: user.companyId, active: true, ...STAFF_ONLY }, select: { id: true } }),
  ]);
  if (!client) return { error: "Client not found." };
  if (!member) return { error: "Pick an active staff member." };

  // Re-adding someone who's already on the team just updates their role.
  await prisma.clientTeamMember.upsert({
    where: { clientId_userId: { clientId, userId } },
    create: { clientId, userId, role, createdById: user.id },
    update: { role },
  });
  revalidateFor(clientId);
  return {};
}

export async function setClientTeamRoleAction(memberId: string, role: "LEAD" | "MEMBER"): Promise<{ error?: string }> {
  const user = await requirePermission("users:manage");
  const m = await prisma.clientTeamMember.findFirst({
    where: { id: memberId, client: { companyId: user.companyId } },
    select: { id: true, clientId: true },
  });
  if (!m) return { error: "Not found." };
  await prisma.clientTeamMember.update({ where: { id: m.id }, data: { role } });
  revalidateFor(m.clientId);
  return {};
}

export async function removeClientTeamMemberAction(memberId: string): Promise<{ error?: string }> {
  const user = await requirePermission("users:manage");
  const m = await prisma.clientTeamMember.findFirst({
    where: { id: memberId, client: { companyId: user.companyId } },
    select: { id: true, clientId: true },
  });
  if (!m) return { error: "Not found." };
  // Tickets they raised or are assigned stay visible to them (see visibleTicketWhere) — only the
  // account-wide view goes away.
  await prisma.clientTeamMember.delete({ where: { id: m.id } });
  revalidateFor(m.clientId);
  return {};
}
