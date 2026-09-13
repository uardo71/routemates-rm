import { BackLink } from "@/components/back-link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { can, canManageMilestone, STAFF_ONLY } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { topSkillsByUser } from "@/lib/staffing-skills";
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
    include: { assignments: { select: { userId: true } }, project: { select: { billingType: true } } },
  });
  if (!milestone) notFound();
  if (!(await canManageMilestone(user, milestone.id))) notFound();

  const assignedUserIds = milestone.assignments.map((a) => a.userId);
  const availableUsers = await prisma.user.findMany({
    // A portal (CUSTOMER) account must never be assignable to a milestone.
    where: { companyId: user.companyId, active: true, ...STAFF_ONLY, id: { notIn: assignedUserIds } },
    orderBy: { name: "asc" },
  });
  // Staffing has always been made on availability and rate alone, blind to who actually knows the
  // toolset — the skills matrix lives in People and nothing here ever looked at it. Surfaced as a
  // hint only: it doesn't gate or reorder the picker, just shows what's already tracked elsewhere.
  const skillsByUser = await topSkillsByUser(user.companyId, availableUsers.map((u) => u.id));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackLink href={`/projects/${projectId}/milestones/${milestoneId}`} label={milestone.name} />
        <h1 className="text-2xl font-semibold mt-1">New assignment</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Assignment details</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateAssignmentForm
            milestoneId={milestone.id}
            users={availableUsers.map((u) => ({ id: u.id, name: u.name, skills: skillsByUser.get(u.id) }))}
            canViewCostRate={can(user, "rates:view:any")}
            showBillRate={can(user, "rates:view:any") && milestone.project.billingType !== "FIXED_PRICE"}
            defaultBillRate={milestone.project.billingType !== "FIXED_PRICE" ? milestone.salesPrice.toString() : null}
          />
        </CardContent>
      </Card>
    </div>
  );
}
