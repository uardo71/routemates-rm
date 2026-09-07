import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canAccessProjectDelivery, canManageProject, STAFF_ONLY } from "@/lib/permissions";
import { serializeArea, serializeCase, serializeIssue } from "./serialize";
import { UatClient } from "./uat-client";

export const metadata = { title: "UAT test scripts" };

export default async function UatPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireUser();
  if (!(await canAccessProjectDelivery(user, projectId))) notFound();

  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId: user.companyId },
    select: { id: true, name: true, number: true, uatScriptStatus: true, uatScriptSentAt: true, client: { select: { name: true } } },
  });
  if (!project) notFound();

  const [areas, cases, issues, users, canManage] = await Promise.all([
    prisma.uatArea.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    prisma.uatTestCase.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    prisma.uatIssue.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({ where: { companyId: user.companyId, active: true, ...STAFF_ONLY }, select: { name: true }, orderBy: { name: "asc" } }),
    canManageProject(user, projectId),
  ]);

  return (
    <UatClient
      projectId={projectId}
      projectName={project.name}
      projectNumber={project.number}
      clientName={project.client.name}
      data={{
        status: project.uatScriptStatus,
        sentAt: project.uatScriptSentAt ? project.uatScriptSentAt.toISOString().slice(0, 10) : "",
        areas: areas.map(serializeArea),
        cases: cases.map(serializeCase),
        issues: issues.map(serializeIssue),
      }}
      userNames={users.map((u) => u.name)}
      backHref={canManage ? `/delivery/${projectId}` : "/uat"}
    />
  );
}
