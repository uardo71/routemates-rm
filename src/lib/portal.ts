import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export type PortalUser = {
  id: string; name: string; companyId: string; clientId: string; clientName: string; companyName: string;
};

/** Resolve the signed-in customer portal user, strictly scoped to their client. Redirects a
 *  non-customer to the internal app and an unauthenticated visitor to login. */
export async function requirePortalUser(): Promise<PortalUser> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "CUSTOMER") redirect("/");
  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, companyId: true, clientId: true, company: { select: { name: true } }, client: { select: { name: true } } },
  });
  if (!u || !u.clientId || !u.client) redirect("/login");
  return { id: u.id, name: u.name, companyId: u.companyId, clientId: u.clientId, clientName: u.client.name, companyName: u.company.name };
}
