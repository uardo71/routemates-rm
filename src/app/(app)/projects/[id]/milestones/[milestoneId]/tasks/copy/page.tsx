import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { canManageMilestone, visibleProjectIds } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { SourceMilestonePicker } from "./source-picker";
import { CopyTasksForm } from "./copy-tasks-form";

export default async function CopyTasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; milestoneId: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const { id: projectId, milestoneId } = await params;
  const { source } = await searchParams;
  const user = await requireUser();

  const milestone = await prisma.milestone.findFirst({
    where: { id: milestoneId, projectId, project: { companyId: user.companyId } },
    select: { id: true, name: true },
  });
  if (!milestone) notFound();
  if (!(await canManageMilestone(user, milestone.id))) notFound();

  const projectIds = await visibleProjectIds(user);
  const scopeFilter = projectIds !== "ALL" ? { id: { in: projectIds } } : {};

  const candidates = await prisma.milestone.findMany({
    where: {
      id: { not: milestoneId },
      project: { companyId: user.companyId, ...scopeFilter },
    },
    select: { id: true, name: true, project: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const options = candidates.map((m) => ({ id: m.id, name: `${m.name} — ${m.project.name}` }));

  const sourceMilestone = source
    ? await prisma.milestone.findFirst({
        where: { id: source, project: { companyId: user.companyId, ...scopeFilter } },
        include: { tasks: { orderBy: { createdAt: "asc" } } },
      })
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/projects/${projectId}/milestones/${milestoneId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {milestone.name}
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Copy tasks into {milestone.name}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Source milestone</CardTitle>
        </CardHeader>
        <CardContent>
          <SourceMilestonePicker options={options} currentId={source} />
        </CardContent>
      </Card>

      {sourceMilestone && (
        <Card>
          <CardHeader>
            <CardTitle>Tasks from {sourceMilestone.name}</CardTitle>
          </CardHeader>
          <CardContent>
            {sourceMilestone.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">This milestone has no tasks.</p>
            ) : (
              <CopyTasksForm
                targetMilestoneId={milestoneId}
                tasks={sourceMilestone.tasks.map((t) => ({
                  id: t.id,
                  name: t.name,
                  estimatedHours: t.estimatedHours?.toString() ?? "",
                }))}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
