import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { canManageMilestone } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { EditTaskForm } from "./edit-task-form";

export default async function EditTaskPage({
  params,
}: {
  params: Promise<{ id: string; milestoneId: string; taskId: string }>;
}) {
  const { id: projectId, milestoneId, taskId } = await params;
  const user = await requireUser();

  const task = await prisma.task.findFirst({
    where: { id: taskId, milestoneId, milestone: { projectId, project: { companyId: user.companyId } } },
    include: {
      milestone: { include: { assignments: { include: { user: true } } } },
      _count: { select: { timeEntries: true } },
    },
  });
  if (!task) notFound();
  if (!(await canManageMilestone(user, milestoneId))) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/projects/${projectId}/milestones/${milestoneId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {task.milestone.name}
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Edit task</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Task details</CardTitle>
        </CardHeader>
        <CardContent>
          <EditTaskForm
            key={task.updatedAt.toISOString()}
            task={{
              id: task.id,
              name: task.name,
              assigneeId: task.assigneeId,
              estimatedHours: task.estimatedHours?.toString() ?? null,
              dueDate: task.dueDate?.toISOString().slice(0, 10) ?? null,
              status: task.status,
            }}
            members={task.milestone.assignments.map((a) => ({ id: a.user.id, name: a.user.name }))}
            canDelete={task._count.timeEntries === 0}
          />
        </CardContent>
      </Card>
    </div>
  );
}
