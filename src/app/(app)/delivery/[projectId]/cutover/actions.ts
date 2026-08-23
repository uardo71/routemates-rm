"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canAccessProjectCutover } from "@/lib/permissions";
import { serializeCutover, serializeCutoverList, type CutoverRowData, type CutoverListData } from "./serialize";

function utcDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

const RowSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  macroActivity: z.string().trim().max(120),
  activity: z.string().trim().max(240),
  description: z.string().trim().max(4000),
  responsible: z.string().trim().max(160),
  prerequisite: z.string().trim().max(160),
  referenceList: z.string().trim().max(120),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  durationMinutes: z.number().int().min(0).max(1000000).nullable(),
  status: z.enum(["PENDING", "IN_PROGRESS", "DONE", "BLOCKED", "SKIPPED"]),
});

const ListSchema = z.object({
  id: z.string(),
  name: z.string().trim().max(120),
  columns: z.array(z.string().max(120)).max(30),
  rows: z.array(z.array(z.string().max(4000)).max(30)).max(5000),
});

const PayloadSchema = z.object({
  tasks: z.array(RowSchema).max(500),
  lists: z.array(ListSchema).max(50),
});

/** Persist the whole cutover plan + its reference lists in one shot (explicit Save). */
export async function saveCutoverPlanAction(
  projectId: string,
  payload: z.infer<typeof PayloadSchema>,
): Promise<{ error?: string; rows?: CutoverRowData[]; lists?: CutoverListData[] }> {
  const user = await requireUser();
  if (!(await canAccessProjectCutover(user, projectId))) return { error: "Forbidden" };
  const parsed = PayloadSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { tasks, lists } = parsed.data;

  // Reference lists: keep only named ones, and names must be unique within the project.
  const named = lists.filter((l) => l.name.trim().length > 0);
  const seen = new Set<string>();
  for (const l of named) {
    const key = l.name.trim().toLowerCase();
    if (seen.has(key)) return { error: `Duplicate reference-list name: "${l.name}".` };
    seen.add(key);
  }

  const [existingTasks, existingLists] = await Promise.all([
    prisma.cutoverTask.findMany({ where: { projectId }, select: { id: true } }),
    prisma.cutoverList.findMany({ where: { projectId }, select: { id: true } }),
  ]);
  const taskIds = new Set(existingTasks.map((e) => e.id));
  const listIds = new Set(existingLists.map((e) => e.id));
  const keepTaskIds = new Set(tasks.filter((r) => !r.id.startsWith("new:")).map((r) => r.id));
  const keepListIds = new Set(named.filter((l) => !l.id.startsWith("new:")).map((l) => l.id));
  const delTasks = [...taskIds].filter((id) => !keepTaskIds.has(id));
  const delLists = [...listIds].filter((id) => !keepListIds.has(id));

  await prisma.$transaction(async (tx) => {
    if (delTasks.length) await tx.cutoverTask.deleteMany({ where: { id: { in: delTasks }, projectId } });
    if (delLists.length) await tx.cutoverList.deleteMany({ where: { id: { in: delLists }, projectId } });

    const idMap = new Map<string, string>();
    let ti = 0;
    for (const r of tasks) {
      const rawParent = r.parentId ?? null;
      const parentId = rawParent ? idMap.get(rawParent) ?? rawParent : null;
      const data = {
        macroActivity: r.macroActivity || "General",
        activity: r.activity,
        description: r.description || null,
        responsible: r.responsible || null,
        prerequisite: r.prerequisite || null,
        referenceList: r.referenceList || null,
        startDate: utcDate(r.startDate),
        endDate: utcDate(r.endDate),
        durationMinutes: r.durationMinutes,
        status: r.status,
        parentId,
        sortOrder: ti,
      };
      if (r.id.startsWith("new:")) {
        const created = await tx.cutoverTask.create({ data: { companyId: user.companyId, projectId, ...data } });
        idMap.set(r.id, created.id);
      } else if (taskIds.has(r.id)) {
        await tx.cutoverTask.update({ where: { id: r.id }, data });
      }
      ti++;
    }

    let li = 0;
    for (const l of named) {
      const data = { name: l.name.trim(), columns: l.columns, rows: l.rows, sortOrder: li };
      if (l.id.startsWith("new:")) await tx.cutoverList.create({ data: { companyId: user.companyId, projectId, ...data } });
      else if (listIds.has(l.id)) await tx.cutoverList.update({ where: { id: l.id }, data });
      li++;
    }
  });

  const [freshTasks, freshLists] = await Promise.all([
    prisma.cutoverTask.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    prisma.cutoverList.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
  ]);
  revalidatePath(`/delivery/${projectId}/cutover`);
  return { rows: freshTasks.map(serializeCutover), lists: freshLists.map(serializeCutoverList) };
}
