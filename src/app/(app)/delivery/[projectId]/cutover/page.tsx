import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canAccessProjectCutover, canManageProject, STAFF_ONLY } from "@/lib/permissions";
import { serializeCutover, serializeCutoverList } from "./serialize";
import { CutoverClient } from "./cutover-client";

export const metadata = { title: "Cutover plan" };

export default async function CutoverPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireUser();
  if (!(await canAccessProjectCutover(user, projectId))) notFound();

  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId: user.companyId },
    select: { id: true, name: true, number: true, client: { select: { name: true } } },
  });
  if (!project) notFound();

  const [tasks, lists, users, canManage] = await Promise.all([
    prisma.cutoverTask.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    prisma.cutoverList.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({ where: { companyId: user.companyId, active: true, ...STAFF_ONLY }, select: { name: true }, orderBy: { name: "asc" } }),
    canManageProject(user, projectId),
  ]);

  return (
    <CutoverClient
      projectId={projectId}
      projectName={project.name}
      projectNumber={project.number}
      clientName={project.client.name}
      rows={tasks.map(serializeCutover)}
      lists={lists.map(serializeCutoverList)}
      userNames={users.map((u) => u.name)}
      backHref={canManage ? `/delivery/${projectId}` : "/cutover"}
    />
  );
}
