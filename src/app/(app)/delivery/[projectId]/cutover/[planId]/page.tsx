import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canAccessProjectCutover, engagementScope, STAFF_ONLY } from "@/lib/permissions";
import { serializeCutover, serializeCutoverList } from "../serialize";
import { CutoverClient } from "../cutover-client";

export const metadata = { title: "Cutover plan" };

export default async function CutoverPlanPage({ params }: { params: Promise<{ projectId: string; planId: string }> }) {
  const { projectId, planId } = await params;
  const user = await requireUser();
  if (!(await canAccessProjectCutover(user, projectId))) notFound();

  const plan = await prisma.cutoverPlan.findFirst({
    where: { id: planId, projectId, companyId: user.companyId },
    select: {
      id: true, name: true, engagementId: true,
      engagement: { select: { name: true } },
      project: { select: { id: true, name: true, number: true, client: { select: { name: true } } } },
    },
  });
  if (!plan) notFound();
  const scope = await engagementScope(user, projectId);
  if (scope !== "ALL" && plan.engagementId && !scope.includes(plan.engagementId)) notFound();

  const [tasks, lists, users] = await Promise.all([
    prisma.cutoverTask.findMany({ where: { planId }, orderBy: { sortOrder: "asc" } }),
    prisma.cutoverList.findMany({ where: { planId }, orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({ where: { companyId: user.companyId, active: true, ...STAFF_ONLY }, select: { name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <CutoverClient
      planId={plan.id}
      planName={plan.name}
      engagementName={plan.engagement?.name ?? null}
      projectName={plan.project.name}
      projectNumber={plan.project.number}
      clientName={plan.project.client.name}
      rows={tasks.map(serializeCutover)}
      lists={lists.map(serializeCutoverList)}
      userNames={users.map((u) => u.name)}
      backHref={`/delivery/${projectId}/cutover${plan.engagementId ? `?eng=${plan.engagementId}` : ""}`}
    />
  );
}
