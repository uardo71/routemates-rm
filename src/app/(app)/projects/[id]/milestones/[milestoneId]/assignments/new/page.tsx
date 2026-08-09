import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { can, canManageMilestone } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { CreateAssignmentForm } from "./create-assignment-form";

export default async function NewAssignmentPage({
  params,
}: {
  params: Promise<{ id: string; milestoneId: string }>;
}) {
  const { id: projectId, milestoneId } = await params;
  const user = await requireUser();

  const milestone = await prisma.milestone.findFirst({
    where: { id: milestoneId, projectId, project: { companyId: user.companyId } },
    include: { assignments: { select: { userId: true } } },
  });
  if (!milestone) notFound();
  if (!(await canManageMilestone(user, milestone.id))) notFound();

  const assignedUserIds = milestone.assignments.map((a) => a.userId);
  const availableUsers = await prisma.user.findMany({
    where: { companyId: user.companyId, active: true, id: { notIn: assignedUserIds } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/projects/${projectId}/milestones/${milestoneId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {milestone.name}
        </Link>
        <h1 className="text-2xl font-semibold mt-1">New assignment</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Assignment details</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateAssignmentForm
            milestoneId={milestone.id}
            users={availableUsers.map((u) => ({ id: u.id, name: u.name }))}
            canViewCostRate={can(user, "rates:view:any")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
