"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

const ClientSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

export async function createClientAction(_prevState: string | undefined, formData: FormData) {
  const user = await requirePermission("clients:manage");

  const parsed = ClientSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";

  const client = await prisma.client.create({
    data: { companyId: user.companyId, name: parsed.data.name },
  });

  revalidatePath("/admin/clients");
  redirect(`/admin/clients/${client.id}`);
}

export async function updateClientAction(_prevState: string | undefined, formData: FormData) {
  const user = await requirePermission("clients:manage");
  const clientId = formData.get("clientId");
  if (typeof clientId !== "string") return "Missing client.";

  const parsed = ClientSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";

  await prisma.client.update({
    where: { id: clientId, companyId: user.companyId },
    data: { name: parsed.data.name },
  });

  revalidatePath("/admin/clients");
  revalidatePath(`/admin/clients/${clientId}`);
}

export async function deleteClientAction(clientId: string) {
  const user = await requirePermission("clients:manage");

  const client = await prisma.client.findFirst({
    where: { id: clientId, companyId: user.companyId },
    include: { _count: { select: { projects: true } } },
  });
  if (!client) throw new Error("Client not found.");
  if (client._count.projects > 0) {
    throw new Error(`Can't delete — this client has ${client._count.projects} project(s).`);
  }

  await prisma.$transaction([
    prisma.contact.deleteMany({ where: { clientId } }),
    prisma.client.delete({ where: { id: clientId } }),
  ]);

  revalidatePath("/admin/clients");
  redirect("/admin/clients");
}

const ContactSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
});

export async function addContactAction(_prevState: string | undefined, formData: FormData) {
  const user = await requirePermission("clients:manage");

  const parsed = ContactSchema.safeParse({
    clientId: formData.get("clientId"),
    name: formData.get("name"),
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";
  const { clientId, name, email, phone } = parsed.data;

  const client = await prisma.client.findFirst({ where: { id: clientId, companyId: user.companyId } });
  if (!client) return "Client not found.";

  await prisma.contact.create({ data: { clientId, name, email: email || undefined, phone: phone || undefined } });

  revalidatePath(`/admin/clients/${clientId}`);
}

export async function deleteContactAction(contactId: string) {
  const user = await requirePermission("clients:manage");

  const contact = await prisma.contact.findUnique({ where: { id: contactId }, include: { client: true } });
  if (!contact || contact.client.companyId !== user.companyId) throw new Error("Contact not found.");

  await prisma.contact.delete({ where: { id: contactId } });
  revalidatePath(`/admin/clients/${contact.clientId}`);
}
