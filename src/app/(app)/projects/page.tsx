import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LinkButton } from "@/components/link-button";
import { prisma } from "@/lib/prisma";
import { can, visibleProjectIds } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

export default async function ProjectsPage() {
  const user = await requirePermission("projects:view");
  const projectIds = await visibleProjectIds(user);

  const projects = await prisma.project.findMany({
    where: {
      companyId: user.companyId,
      ...(projectIds === "ALL" ? {} : { id: { in: projectIds } }),
    },
    include: { client: true, manager: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        {can(user, "projects:create") && <LinkButton href="/projects/new">New project</LinkButton>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{projectIds === "ALL" ? "All projects" : "Your projects"}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Manager</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Billing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell>{p.client.name}</TableCell>
                  <TableCell>{p.manager?.name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{p.status}</Badge>
                  </TableCell>
                  <TableCell>{p.billingType.replaceAll("_", " ")}</TableCell>
                </TableRow>
              ))}
              {projects.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No projects yet.
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
