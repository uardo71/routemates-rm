import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { canManageProject, visibleProjectIds } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { CreateMilestoneForm } from "./create-milestone-form";

export default async function NewMilestonePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("projects:view");

  const projectIds = await visibleProjectIds(user);
  if (projectIds !== "ALL" && !projectIds.includes(id)) notFound();

  const project = await prisma.project.findFirst({
    where: { id, companyId: user.companyId },
    include: { company: true },
  });
  if (!project) notFound();
  if (!(await canManageProject(user, id))) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${id}`} className="text-sm text-muted-foreground hover:underline">
          ← {project.name}
        </Link>
        <h1 className="text-2xl font-semibold mt-1">New milestone</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Milestone details</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateMilestoneForm projectId={project.id} billingType={project.billingType} currency={project.company.currency} />
        </CardContent>
      </Card>
    </div>
  );
}
