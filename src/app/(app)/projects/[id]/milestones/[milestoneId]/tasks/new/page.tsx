import { BackLink } from "@/components/back-link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { canManageMilestone } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { CreateTaskForm } from "./create-task-form";

export default async function NewTaskPage({
  params,
}: {
  params: Promise<{ id: string; milestoneId: string }>;
}) {
  const { id: projectId, milestoneId } = await params;
  const user = await requireUser();

  const milestone = await prisma.milestone.findFirst({
    where: { id: milestoneId, projectId, project: { companyId: user.companyId } },
    include: { assignments: { include: { user: true } } },
  });
  if (!milestone) notFound();
  if (!(await canManageMilestone(user, milestone.id))) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackLink href={`/projects/${projectId}/milestones/${milestoneId}`} label={milestone.name} />
        <h1 className="text-2xl font-semibold mt-1">New task</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Task details</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateTaskForm
            milestoneId={milestone.id}
            members={milestone.assignments.map((a) => ({ id: a.user.id, name: a.user.name }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
