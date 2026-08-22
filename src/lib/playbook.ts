import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

/** Snapshots the company's active playbook into a project's checklist. Due dates are seeded from the
 *  project start date + each task's offsetDays (when both are known). Called on project creation so a
 *  junior PM always starts from the same standard governance checklist. */
export async function applyPlaybookToProject(companyId: string, projectId: string, startDate: Date | null, db: Db = prisma): Promise<void> {
  const tasks = await db.playbookTask.findMany({ where: { companyId, active: true }, orderBy: { sortOrder: "asc" } });
  if (tasks.length === 0) return;
  await db.projectChecklistItem.createMany({
    data: tasks.map((t) => ({
      projectId,
      phase: t.phase,
      title: t.title,
      description: t.description,
      sortOrder: t.sortOrder,
      done: false,
      dueDate: startDate && t.offsetDays != null ? new Date(startDate.getTime() + t.offsetDays * 86_400_000) : null,
    })),
  });
}
