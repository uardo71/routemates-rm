import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LinkButton } from "@/components/link-button";
import { HourProgress } from "@/components/hour-progress";
import { InitialsAvatar } from "@/components/initials-avatar";
import { prisma } from "@/lib/prisma";
import { can, visibleProjectIds } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { parseList } from "@/lib/utils";
import { ProjectsFilters } from "./projects-filters";

const STATUS_TONE: Record<string, "secondary" | "default" | "outline" | "destructive"> = {
  ACTIVE: "default",
  PLANNED: "secondary",
  ON_HOLD: "outline",
  COMPLETED: "secondary",
  CANCELLED: "destructive",
};

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ statuses?: string; clients?: string; managers?: string; billing?: string }>;
}) {
  const { statuses, clients: clientsParam, managers: managersParam, billing } = await searchParams;
  const user = await requirePermission("projects:view");
  const projectIds = await visibleProjectIds(user);

  const selectedStatuses = parseList(statuses ?? null);
  const selectedClientIds = parseList(clientsParam ?? null);
  const selectedManagerIds = parseList(managersParam ?? null);
  const selectedBilling = parseList(billing ?? null);

  const visibilityWhere = {
    companyId: user.companyId,
    ...(projectIds === "ALL" ? {} : { id: { in: projectIds } }),
  };

  const [optionSource, projects] = await Promise.all([
    // Unfiltered by the current selection, so the dropdown options never shrink as you filter.
    prisma.project.findMany({
      where: visibilityWhere,
      select: { client: { select: { id: true, name: true } }, manager: { select: { id: true, name: true } } },
    }),
    prisma.project.findMany({
      where: {
        ...visibilityWhere,
        ...(selectedStatuses.length > 0 ? { status: { in: selectedStatuses as never[] } } : {}),
        ...(selectedClientIds.length > 0 ? { clientId: { in: selectedClientIds } } : {}),
        ...(selectedManagerIds.length > 0 ? { managerId: { in: selectedManagerIds } } : {}),
        ...(selectedBilling.length > 0 ? { billingType: { in: selectedBilling as never[] } } : {}),
      },
      include: {
        client: true,
        manager: true,
        milestones: { select: { id: true, budgetHours: true, _count: { select: { assignments: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const clientOptions = [...new Map(optionSource.map((p) => [p.client.id, p.client])).values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const managerOptions = [...new Map(optionSource.filter((p) => p.manager).map((p) => [p.manager!.id, p.manager!])).values()].sort(
    (a, b) => a.name.localeCompare(b.name)
  );

  const milestoneIds = projects.flatMap((p) => p.milestones.map((m) => m.id));
  const hoursByMilestone = await prisma.timeEntry.groupBy({
    by: ["milestoneId"],
    where: { milestoneId: { in: milestoneIds }, timeCard: { status: "APPROVED" } },
    _sum: { hours: true },
  });
  const usedMap = new Map(hoursByMilestone.map((h) => [h.milestoneId, Number(h._sum.hours ?? 0)]));

  const rows = projects.map((p) => {
    const budgetHours = p.milestones.reduce((sum, m) => sum + Number(m.budgetHours ?? 0), 0);
    const usedHours = p.milestones.reduce((sum, m) => sum + (usedMap.get(m.id) ?? 0), 0);
    const teamSize = p.milestones.reduce((sum, m) => sum + m._count.assignments, 0);
    return { project: p, budgetHours, usedHours, teamSize };
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            {projectIds === "ALL" ? "Every project across the company." : "Projects you're on."}
          </p>
        </div>
        {can(user, "projects:create") && <LinkButton href="/projects/new">New project</LinkButton>}
      </div>

      <ProjectsFilters
        clients={clientOptions}
        managers={managerOptions}
        currentStatuses={selectedStatuses}
        currentClients={selectedClientIds}
        currentManagers={selectedManagerIds}
        currentBilling={selectedBilling}
      />

      <Card size="sm">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Manager</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ project: p, budgetHours, usedHours, teamSize }) => (
                <TableRow key={p.id} className="group/row">
                  <TableCell>
                    <Link href={`/projects/${p.id}`} className="flex items-center gap-3">
                      <InitialsAvatar name={p.client.name} />
                      <span>
                        <span className="block font-medium group-hover/row:underline">{p.name}</span>
                        <span className="block text-xs text-muted-foreground">{p.client.name}</span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.manager?.name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_TONE[p.status] ?? "secondary"}>{p.status.replaceAll("_", " ")}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.billingType.replaceAll("_", " ")}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{teamSize > 0 ? `${teamSize} on team` : "—"}</TableCell>
                  <TableCell>
                    {budgetHours > 0 ? <HourProgress used={usedHours} cap={budgetHours} /> : usedHours > 0 ? `${usedHours}h logged` : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No projects match these filters.
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
