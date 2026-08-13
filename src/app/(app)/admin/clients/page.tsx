import Link from "next/link";
import { format } from "date-fns";
import { Building2Icon, ContactIcon, FolderKanbanIcon, TargetIcon, MailIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LinkButton } from "@/components/link-button";
import { InitialsAvatar } from "@/components/initials-avatar";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

const OPEN_STAGES = new Set(["QUALIFYING", "PROPOSAL_SENT", "NEGOTIATION", "PENDING_APPROVAL"]);

export default async function ClientsAdminPage() {
  const user = await requirePermission("clients:view");

  const clients = await prisma.client.findMany({
    where: { companyId: user.companyId },
    include: {
      contacts: { orderBy: { createdAt: "asc" } },
      projects: { select: { status: true } },
      opportunities: { select: { stage: true } },
    },
    orderBy: { name: "asc" },
  });

  const rows = clients.map((c) => {
    const activeProjects = c.projects.filter((p) => p.status === "ACTIVE").length;
    const openOpps = c.opportunities.filter((o) => OPEN_STAGES.has(o.stage)).length;
    const wonOpps = c.opportunities.filter((o) => o.stage === "WON").length;
    return {
      client: c,
      contacts: c.contacts.length,
      projects: c.projects.length,
      activeProjects,
      openOpps,
      wonOpps,
      totalOpps: c.opportunities.length,
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      contacts: acc.contacts + r.contacts,
      activeProjects: acc.activeProjects + r.activeProjects,
      openOpps: acc.openOpps + r.openOpps,
      wonOpps: acc.wonOpps + r.wonOpps,
      totalOpps: acc.totalOpps + r.totalOpps,
    }),
    { contacts: 0, activeProjects: 0, openOpps: 0, wonOpps: 0, totalOpps: 0 }
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="text-sm text-muted-foreground">The companies you deliver work for.</p>
        </div>
        {can(user, "clients:manage") && <LinkButton href="/admin/clients/new">New client</LinkButton>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Clients" value={clients.length} icon={Building2Icon} />
        <StatCard label="Contacts" value={totals.contacts} icon={ContactIcon} />
        <StatCard label="Active projects" value={totals.activeProjects} icon={FolderKanbanIcon} />
        <StatCard
          label="Opportunities"
          value={totals.totalOpps}
          sublabel={totals.totalOpps > 0 ? `${totals.openOpps} open · ${totals.wonOpps} won` : "none yet"}
          icon={TargetIcon}
        />
      </div>

      <Card size="sm">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Primary contact</TableHead>
                <TableHead className="text-right">Contacts</TableHead>
                <TableHead>Projects</TableHead>
                <TableHead>Opportunities</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ client: c, contacts, projects, activeProjects, openOpps, wonOpps, totalOpps }) => (
                <TableRow key={c.id} className="group/row">
                  <TableCell>
                    <Link href={`/admin/clients/${c.id}`} className="flex items-center gap-3">
                      <InitialsAvatar name={c.name} size="md" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium group-hover/row:underline">{c.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          Since {format(c.createdAt, "MMM yyyy")}
                        </span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    {c.contacts[0] ? (
                      <span className="flex flex-col">
                        <span className="text-sm">{c.contacts[0].name}</span>
                        {c.contacts[0].email && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MailIcon className="size-3" /> {c.contacts[0].email}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {contacts > 0 ? contacts : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {projects > 0 ? (
                      <span className="flex items-center gap-1.5">
                        {activeProjects > 0 && <Badge variant="default">{activeProjects} active</Badge>}
                        <span className="text-xs text-muted-foreground tabular-nums">of {projects}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {totalOpps > 0 ? (
                      <span className="flex items-center gap-1.5">
                        {openOpps > 0 && <Badge variant="secondary">{openOpps} open</Badge>}
                        {wonOpps > 0 && (
                          <span className="inline-flex items-center rounded-full bg-emerald-500/12 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-500/25 dark:text-emerald-400">
                            {wonOpps} won
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground tabular-nums">of {totalOpps}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No clients yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
