import { notFound, redirect } from "next/navigation";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canAccessProjectCutover, canManageProject, engagementScope, engagementScopeWhere } from "@/lib/permissions";
import { RunbookListClient, type RunbookItem } from "../runbook-list-client";

export const metadata = { title: "Cutover plans" };

// The project's cutover plans, grouped by end customer. A consultant scoped to specific end
// customers sees only theirs (plus project-level plans); the editor is one click further.
export default async function CutoverPlansPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ eng?: string }> }) {
  const { projectId } = await params;
  const { eng } = await searchParams;
  const user = await requireUser();
  if (!(await canAccessProjectCutover(user, projectId))) notFound();

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

  const plans = await prisma.cutoverPlan.findMany({
    where: { projectId, ...engagementScopeWhere(scope) },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, engagementId: true, updatedAt: true, tasks: { select: { id: true, parentId: true, status: true } } },
  });
  const engagements = project.engagements
    .filter((e) => scope === "ALL" || scope.includes(e.id))
    .map((e) => ({ id: e.id, name: e.name, members: e.members.map((m) => m.user.name) }));

  const items: RunbookItem[] = plans.map((p) => {
    const leaves = p.tasks.filter((t) => !p.tasks.some((c) => c.parentId === t.id));
    const done = leaves.filter((t) => t.status === "DONE" || t.status === "SKIPPED").length;
    return {
      id: p.id,
      name: p.name,
      engagementId: p.engagementId,
      meta: leaves.length === 0 ? "No steps yet" : `${leaves.length} step${leaves.length === 1 ? "" : "s"} · ${done} done`,
      updatedAt: format(p.updatedAt, "MMM d"),
    };
  });

  // Arriving from a cockpit that was viewing one end customer: show that customer's plans only, and
  // when there is exactly one, open it straight away.
  const focus = engagements.find((e) => e.id === eng) ?? null;
  const focused = focus ? items.filter((i) => i.engagementId === focus.id) : items;
  if (focus && focused.length === 1) redirect(`/delivery/${projectId}/cutover/${focused[0].id}`);

  return (
    <RunbookListClient
      kind="cutover"
      projectId={projectId}
      projectName={project.name}
      projectNumber={project.number}
      clientName={project.client.name}
      items={focused}
      engagements={engagements}
      initialEngagementId={focus?.id ?? null}
      focus={focus ? { id: focus.id, name: focus.name } : null}
      canCreate
      backHref={canManage ? `/delivery/${projectId}${eng ? `?eng=${eng}` : ""}` : "/cutover"}
    />
  );
}
