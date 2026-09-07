"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";

const ViewSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Name is required").max(80),
  shared: z.boolean(),
  filters: z.record(z.string(), z.unknown()),
  columns: z.array(z.string()).max(40),
  sort: z.object({ key: z.string(), dir: z.enum(["asc", "desc"]) }).nullable(),
});

export async function saveTicketViewAction(input: z.infer<typeof ViewSchema>): Promise<{ error?: string; id?: string }> {
  const user = await requireUser();
  if (!can(user, "tickets:view") && !can(user, "tickets:manage")) return { error: "Forbidden" };
  const parsed = ViewSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  const data = {
    name: d.name, shared: d.shared,
    filters: d.filters as Prisma.InputJsonValue,
    columns: d.columns as Prisma.InputJsonValue,
    sort: (d.sort ?? undefined) as Prisma.InputJsonValue | undefined,
  };
  let id = d.id;
  if (id) {
    const existing = await prisma.ticketView.findFirst({ where: { id, companyId: user.companyId }, select: { ownerId: true } });
    if (!existing) return { error: "Not found" };
    if (existing.ownerId !== user.id) return { error: "You can only edit your own views" };
    await prisma.ticketView.update({ where: { id }, data });
  } else {
    const created = await prisma.ticketView.create({ data: { ...data, companyId: user.companyId, ownerId: user.id } });
    id = created.id;
  }
  revalidatePath("/tickets");
  return { id };
}

export async function deleteTicketViewAction(id: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const v = await prisma.ticketView.findFirst({ where: { id, companyId: user.companyId }, select: { ownerId: true } });
  if (!v) return { error: "Not found" };
  if (v.ownerId !== user.id) return { error: "You can only delete your own views" };
  await prisma.ticketView.delete({ where: { id } });
  revalidatePath("/tickets");
  return {};
}
