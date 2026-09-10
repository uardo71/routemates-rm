import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canAccessProjectDelivery, engagementScope, STAFF_ONLY } from "@/lib/permissions";
import { loadUatScriptData } from "../load";
import { UatClient } from "../uat-client";

export const metadata = { title: "UAT test script" };

export default async function UatScriptPage({ params }: { params: Promise<{ projectId: string; scriptId: string }> }) {
  const { projectId, scriptId } = await params;
  const user = await requireUser();
  if (!(await canAccessProjectDelivery(user, projectId))) notFound();

  const script = await prisma.uatScript.findFirst({
    where: { id: scriptId, projectId, companyId: user.companyId },
    select: {
      id: true, name: true, engagementId: true,
      engagement: { select: { name: true } },
      project: { select: { id: true, name: true, number: true, client: { select: { name: true } } } },
    },
  });
  if (!script) notFound();
  const scope = await engagementScope(user, projectId);
  if (scope !== "ALL" && script.engagementId && !scope.includes(script.engagementId)) notFound();

  const [data, users] = await Promise.all([
    loadUatScriptData(scriptId),
    prisma.user.findMany({ where: { companyId: user.companyId, active: true, ...STAFF_ONLY }, select: { name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <UatClient
      scriptId={script.id}
      scriptName={script.name}
      engagementName={script.engagement?.name ?? null}
      projectName={script.project.name}
      projectNumber={script.project.number}
      clientName={script.project.client.name}
      data={data}
      userNames={users.map((u) => u.name)}
      backHref={`/delivery/${projectId}/uat${script.engagementId ? `?eng=${script.engagementId}` : ""}`}
    />
  );
}
