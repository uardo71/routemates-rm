import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { canManageProject, visibleProjectIds } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { EditProjectForm } from "./edit-project-form";

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("projects:view");

  const projectIds = await visibleProjectIds(user);
  if (projectIds !== "ALL" && !projectIds.includes(id)) notFound();

  const project = await prisma.project.findFirst({
    where: { id, companyId: user.companyId },
    include: { _count: { select: { milestones: true } } },
  });
  if (!project) notFound();

  if (!(await canManageProject(user, id))) notFound();

  const [clients, managers] = await Promise.all([
    prisma.client.findMany({ where: { companyId: user.companyId }, orderBy: { name: "asc" } }),
    user.role === "ADMIN"
      ? prisma.user.findMany({ where: { companyId: user.companyId, role: "PM", active: true }, orderBy: { name: "asc" } })
      : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${id}`} className="text-sm text-muted-foreground hover:underline">
          ← {project.name}
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Edit project</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Project details</CardTitle>
        </CardHeader>
        <CardContent>
          <EditProjectForm
            key={project.updatedAt.toISOString()}
            project={{
              id: project.id,
              name: project.name,
              clientId: project.clientId,
              status: project.status,
              billingType: project.billingType,
              budgetAmount: project.budgetAmount?.toString() ?? null,
              budgetHours: project.budgetHours?.toString() ?? null,
              startDate: project.startDate?.toISOString().slice(0, 10) ?? null,
              endDate: project.endDate?.toISOString().slice(0, 10) ?? null,
              managerId: project.managerId,
              isInternal: project.isInternal,
            }}
            clients={clients.map((c) => ({ id: c.id, name: c.name }))}
            managers={managers ? managers.map((m) => ({ id: m.id, name: m.name })) : null}
            canDelete={project._count.milestones === 0}
          />
        </CardContent>
      </Card>
    </div>
  );
}
