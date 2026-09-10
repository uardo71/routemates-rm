import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { assignedClientIds, visibleClientWhere } from "@/lib/permissions";
import { loadTicketConfig } from "@/lib/ticket-config.server";
import { CreateTicketForm, type FormConfig } from "./create-ticket-form";

export const metadata = { title: "New ticket" };

export default async function NewTicketPage({ searchParams }: { searchParams: Promise<{ clientId?: string }> }) {
  const { clientId: presetClientId } = await searchParams;
  const user = await requireUser();
  // Someone staffed on at least one account gets the triage fields (requester/assignee); the
  // server re-checks against the specific client on submit. Only the clients they can see are offered.
  const myClients = await assignedClientIds(user);
  const manage = myClients === "ALL" || myClients.length > 0;
  const cfg = await loadTicketConfig(user.companyId);
  const [clients, projects, users] = await Promise.all([
    prisma.client.findMany({ where: await visibleClientWhere(user), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { companyId: user.companyId, isInternal: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { companyId: user.companyId, active: true, role: { not: "CUSTOMER" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const pubField = (f: { id: string; key: string; name: string; kind: string; options: string[]; required: boolean }) =>
    ({ id: f.id, key: f.key, name: f.name, kind: f.kind, options: f.options, required: f.required });
  const config: FormConfig = {
    types: cfg.types.map((t) => ({ id: t.id, name: t.name, color: t.color, icon: t.icon, fields: t.fields.map(pubField) })),
    globalFields: cfg.globalFields.map(pubField),
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <Link href="/tickets" className="text-sm text-muted-foreground hover:underline">← Tickets</Link>
      <h1 className="text-2xl font-semibold tracking-tight">New ticket</h1>
      <CreateTicketForm defaultClientId={presetClientId ?? ""} manage={manage} clients={clients} projects={projects} users={users} currentUserId={user.id} config={config} />
    </div>
  );
}
