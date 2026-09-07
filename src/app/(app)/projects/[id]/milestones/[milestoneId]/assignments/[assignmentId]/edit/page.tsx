import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { can, canManageMilestone } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { EditAssignmentForm } from "./edit-assignment-form";

export default async function EditAssignmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; milestoneId: string; assignmentId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id: projectId, milestoneId, assignmentId } = await params;
  // Opened from the project's Assignments tab (`?tab=assignments`) → go back there; opened from the
  // milestone's assignment list → go back to the milestone.
  const { tab } = await searchParams;
  const fromAssignmentsTab = tab === "assignments";
  const user = await requireUser();

  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, milestoneId, milestone: { projectId, project: { companyId: user.companyId } } },
    include: { user: true, milestone: { include: { project: { select: { billingType: true } } } }, _count: { select: { timeEntries: true } } },
  });
  if (!assignment) notFound();
  if (!(await canManageMilestone(user, milestoneId))) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={fromAssignmentsTab ? `/projects/${projectId}?tab=assignments` : `/projects/${projectId}/milestones/${milestoneId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {fromAssignmentsTab ? "Assignments" : assignment.milestone.name}
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Edit assignment — {assignment.user.name}</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Assignment details</CardTitle>
        </CardHeader>
        <CardContent>
          <EditAssignmentForm
            key={assignment.updatedAt.toISOString()}
            assignment={{
              id: assignment.id,
              userName: assignment.user.name,
              costRate: assignment.costRate.toString(),
              billRate: assignment.billRate?.toString() ?? null,
              allocatedHours: assignment.allocatedHours?.toString() ?? null,
              startDate: assignment.startDate?.toISOString().slice(0, 10) ?? null,
              endDate: assignment.endDate?.toISOString().slice(0, 10) ?? null,
              status: assignment.status,
            }}
            canDelete={assignment._count.timeEntries === 0}
            canViewCostRate={can(user, "rates:view:any")}
            showBillRate={can(user, "rates:view:any") && assignment.milestone.project.billingType !== "FIXED_PRICE"}
          />
        </CardContent>
      </Card>
    </div>
  );
}
