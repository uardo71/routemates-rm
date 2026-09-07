import Link from "next/link";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import {
  FolderKanbanIcon,
  ContactIcon,
  TargetIcon,
  ActivityIcon,
  MailIcon,
  PhoneIcon,
  SettingsIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteButton } from "@/components/delete-button";
import { InitialsAvatar } from "@/components/initials-avatar";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { can } from "@/lib/permissions";
import { getCompanySlaDefault, getClientSlaOverride } from "@/lib/sla.server";
import { EditClientForm } from "./edit-client-form";
import { AddContactForm } from "./add-contact-form";
import { PortalUsers } from "./portal-users";
import { ClientSla } from "./client-sla";
import { deleteContactAction } from "../actions";

const STATUS_TONE: Record<string, "secondary" | "default" | "outline" | "destructive"> = {
  ACTIVE: "default",
  PLANNED: "secondary",
  ON_HOLD: "outline",
  COMPLETED: "secondary",
  CANCELLED: "destructive",
};

const OPEN_STAGES = new Set(["QUALIFYING", "PROPOSAL_SENT", "NEGOTIATION", "PENDING_APPROVAL"]);

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("clients:view");

  const client = await prisma.client.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      contacts: { orderBy: { createdAt: "asc" } },
      projects: { orderBy: { createdAt: "desc" } },
      opportunities: { select: { stage: true } },
      portalUsers: { orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true, active: true } },
    },
  });
  if (!client) notFound();

  const canManage = can(user, "clients:manage");
  const canManageTickets = can(user, "tickets:manage");
  const [slaDefault, slaOverride] = canManageTickets
    ? await Promise.all([getCompanySlaDefault(user.companyId), getClientSlaOverride(user.companyId, client.id)])
    : [null, null];
  const activeProjects = client.projects.filter((p) => p.status === "ACTIVE").length;
  const openOpps = client.opportunities.filter((o) => OPEN_STAGES.has(o.stage)).length;
  const wonOpps = client.opportunities.filter((o) => o.stage === "WON").length;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/clients" className="text-sm text-muted-foreground hover:underline">
        ← Clients
      </Link>

      {/* Header */}
      <Card className="gap-0 overflow-hidden p-0">
        <div className="h-20 bg-gradient-to-r from-primary/25 via-primary/10 to-transparent" />
        <div className="-mt-10 flex flex-col gap-3 px-6 pb-6 sm:flex-row sm:items-end sm:gap-5">
          <InitialsAvatar name={client.name} size="lg" className="ring-4 ring-card shadow-paper" />
          <div className="flex flex-1 flex-col gap-1 pt-1 sm:pb-1">
            <h1 className="font-heading text-xl font-semibold">{client.name}</h1>
            <p className="text-sm text-muted-foreground">Client since {format(client.createdAt, "MMMM yyyy")}</p>
          </div>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Projects" value={client.projects.length} icon={FolderKanbanIcon} />
        <StatCard label="Active projects" value={activeProjects} icon={ActivityIcon} />
        <StatCard label="Contacts" value={client.contacts.length} icon={ContactIcon} />
        <StatCard
          label="Opportunities"
          value={client.opportunities.length}
          sublabel={client.opportunities.length > 0 ? `${openOpps} open · ${wonOpps} won` : "none yet"}
          icon={TargetIcon}
        />
      </div>

      {/* Contacts */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-base">
            Contacts <span className="font-normal text-muted-foreground">({client.contacts.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {client.contacts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <InitialsAvatar name={c.name} />
                      <span className="font-medium">{c.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {c.email ? (
                      <a
                        href={`mailto:${c.email}`}
                        className="flex w-fit items-center gap-1.5 text-muted-foreground hover:text-foreground hover:underline"
                      >
                        <MailIcon className="size-3.5" /> {c.email}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {c.phone ? (
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <PhoneIcon className="size-3.5" /> {c.phone}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <DeleteButton
                        action={deleteContactAction.bind(null, c.id)}
                        confirmMessage={`Remove contact ${c.name}?`}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {client.contacts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canManage ? 4 : 3} className="py-6 text-center text-muted-foreground">
                    No contacts yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {canManage && <AddContactForm clientId={client.id} />}
        </CardContent>
      </Card>

      {/* Projects */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-base">
            Projects <span className="font-normal text-muted-foreground">({client.projects.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {client.projects.map((p) => (
                <TableRow key={p.id} className="group/row">
                  <TableCell>
                    <Link href={`/projects/${p.id}`} className="font-medium group-hover/row:underline">
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_TONE[p.status] ?? "secondary"}>{p.status.replaceAll("_", " ")}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.billingType.replaceAll("_", " ")}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{format(p.createdAt, "MMM d, yyyy")}</TableCell>
                </TableRow>
              ))}
              {client.projects.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    No projects yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Portal accounts */}
      {canManage && (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ContactIcon className="size-4 text-muted-foreground" /> Customer portal accounts
              <span className="font-normal text-muted-foreground">({client.portalUsers.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PortalUsers clientId={client.id} users={client.portalUsers} />
          </CardContent>
        </Card>
      )}

      {/* Support SLA */}
      {canManageTickets && slaDefault && (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ActivityIcon className="size-4 text-muted-foreground" /> Support SLA
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ClientSla clientId={client.id} defaultTargets={slaDefault} override={slaOverride} />
          </CardContent>
        </Card>
      )}

      {/* Settings */}
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <SettingsIcon className="size-4 text-muted-foreground" /> Client settings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EditClientForm key={client.updatedAt.toISOString()} clientId={client.id} name={client.name} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
