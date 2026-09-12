import { BackLink } from "@/components/back-link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { canManageMilestone } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { EditMilestoneForm } from "./edit-milestone-form";

export default async function EditMilestonePage({
  params,
}: {
  params: Promise<{ id: string; milestoneId: string }>;
}) {
  const { id: projectId, milestoneId } = await params;
  const user = await requireUser();

  const milestone = await prisma.milestone.findFirst({
    where: { id: milestoneId, projectId, project: { companyId: user.companyId } },
    include: {
      project: { include: { company: true } },
      _count: { select: { assignments: true, tasks: true, timeEntries: true } },
    },
  });
  if (!milestone) notFound();
  if (!(await canManageMilestone(user, milestone.id))) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackLink href={`/projects/${projectId}/milestones/${milestoneId}`} label={milestone.name} />
        <h1 className="text-2xl font-semibold mt-1">Edit milestone</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Milestone details</CardTitle>
        </CardHeader>
        <CardContent>
          <EditMilestoneForm
            key={milestone.updatedAt.toISOString()}
            milestone={{
              id: milestone.id,
              name: milestone.name,
              description: milestone.description,
              billable: milestone.billable,
              salesPrice: milestone.salesPrice.toString(),
              cost: milestone.cost.toString(),
              budgetHours: milestone.budgetHours?.toString() ?? null,
              startDate: milestone.startDate?.toISOString().slice(0, 10) ?? null,
              endDate: milestone.endDate?.toISOString().slice(0, 10) ?? null,
            }}
            billingType={milestone.project.billingType}
            currency={milestone.project.company.currency}
            canDelete={
              milestone._count.assignments + milestone._count.tasks + milestone._count.timeEntries === 0
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
