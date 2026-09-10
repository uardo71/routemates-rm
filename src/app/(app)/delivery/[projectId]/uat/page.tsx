import { notFound } from "next/navigation";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canAccessProjectDelivery, canManageProject, engagementScope, engagementScopeWhere } from "@/lib/permissions";
import { UAT_SCRIPT_STATUS_LABEL, UAT_SCRIPT_STATUS_TONE } from "@/lib/uat";
import { RunbookListClient, type RunbookItem } from "../runbook-list-client";

export const metadata = { title: "UAT test scripts" };

// The project's UAT test scripts, grouped by end customer — same shape as the cutover plans list.
export default async function UatScriptsPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ eng?: string }> }) {
  const { projectId } = await params;
  const { eng } = await searchParams;
  const user = await requireUser();
  if (!(await canAccessProjectDelivery(user, projectId))) notFound();

  const [project, scope, canManage] = await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId, companyId: user.companyId },
      select: {
        id: true, name: true, number: true, client: { select: { name: true } },
        engagements: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, members: { select: { user: { select: { name: true } } } } } },
      },
    }),
    engagementScope(user, projectId),
    canManageProject(user, projectId),
  ]);
  if (!project) notFound();

  const scripts = await prisma.uatScript.findMany({
    where: { projectId, ...engagementScopeWhere(scope) },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, engagementId: true, status: true, updatedAt: true, _count: { select: { cases: true, areas: true } } },
  });
  const engagements = project.engagements
    .filter((e) => scope === "ALL" || scope.includes(e.id))
    .map((e) => ({ id: e.id, name: e.name, members: e.members.map((m) => m.user.name) }));

  const items: RunbookItem[] = scripts.map((s) => ({
    id: s.id,
    name: s.name,
    engagementId: s.engagementId,
    meta: `${s._count.areas} area${s._count.areas === 1 ? "" : "s"} · ${s._count.cases} case${s._count.cases === 1 ? "" : "s"}`,
    pill: { label: UAT_SCRIPT_STATUS_LABEL[s.status], tone: UAT_SCRIPT_STATUS_TONE[s.status] },
    updatedAt: format(s.updatedAt, "MMM d"),
  }));

  return (
    <RunbookListClient
      kind="uat"
      projectId={projectId}
      projectName={project.name}
      projectNumber={project.number}
      clientName={project.client.name}
      items={items}
      engagements={engagements}
      initialEngagementId={engagements.some((e) => e.id === eng) ? (eng as string) : null}
      canCreate
      backHref={canManage ? `/delivery/${projectId}${eng ? `?eng=${eng}` : ""}` : "/uat"}
    />
  );
}
