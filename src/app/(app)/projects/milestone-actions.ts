"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can, canManageMilestone, canManageProject } from "@/lib/permissions";

const CreateMilestoneSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  billable: z.boolean(),
  salesPrice: z.coerce.number().min(0, "Sales price must be 0 or more"),
  cost: z.coerce.number().min(0, "Cost must be 0 or more").optional(),
  budgetHours: z.coerce.number().positive().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export async function createMilestoneAction(_prevState: string | undefined, formData: FormData) {
  const user = await requireUser();

  const parsed = CreateMilestoneSchema.safeParse({
    projectId: formData.get("projectId"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    billable: formData.get("billable") === "on",
    salesPrice: formData.get("salesPrice"),
    cost: formData.get("cost") || undefined,
    budgetHours: formData.get("budgetHours") || undefined,
    startDate: formData.get("startDate") || undefined,
    endDate: formData.get("endDate") || undefined,
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";
  const data = parsed.data;

  if (!(await canManageProject(user, data.projectId))) {
    return "You do not have permission to manage this project.";
  }

  // Budgeted cost is a top-down planning estimate, entered before anyone may be staffed —
  // it's shown alongside a computed "implied cost from assignments" once people are assigned,
  // rather than being derived automatically (a milestone/role can have several people at
  // different cost rates, so there's no single rate to multiply by hours upfront).
  const milestone = await prisma.milestone.create({
    data: {
      projectId: data.projectId,
      name: data.name,
      description: data.description,
      billable: data.billable,
      salesPrice: data.salesPrice,
      cost: data.cost ?? 0,
      budgetHours: data.budgetHours,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      endDate: data.endDate ? new Date(data.endDate) : undefined,
    },
  });

  revalidatePath(`/projects/${data.projectId}`);
  redirect(`/projects/${data.projectId}/milestones/${milestone.id}`);
}

const UpdateMilestoneSchema = z.object({
  milestoneId: z.string().min(1),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  billable: z.boolean(),
  salesPrice: z.coerce.number().min(0, "Sales price must be 0 or more"),
  cost: z.coerce.number().min(0, "Cost must be 0 or more").optional(),
  budgetHours: z.coerce.number().positive().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export async function updateMilestoneAction(_prevState: string | undefined, formData: FormData) {
  const user = await requireUser();
  const milestoneId = formData.get("milestoneId");
  if (typeof milestoneId !== "string") return "Missing milestone.";
  if (!(await canManageMilestone(user, milestoneId))) {
    return "You do not have permission to manage this milestone.";
  }

  const parsed = UpdateMilestoneSchema.safeParse({
    milestoneId,
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    billable: formData.get("billable") === "on",
    salesPrice: formData.get("salesPrice"),
    cost: formData.get("cost") || undefined,
    budgetHours: formData.get("budgetHours") || undefined,
    startDate: formData.get("startDate") || undefined,
    endDate: formData.get("endDate") || undefined,
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";
  const data = parsed.data;

  const milestone = await prisma.milestone.update({
    where: { id: milestoneId },
    data: {
      name: data.name,
      description: data.description,
      billable: data.billable,
      salesPrice: data.salesPrice,
      cost: data.cost ?? 0,
      budgetHours: data.budgetHours ?? null,
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
    },
    select: { projectId: true },
  });

  revalidatePath(`/projects/${milestone.projectId}`);
  revalidatePath(`/projects/${milestone.projectId}/milestones/${milestoneId}`);
  redirect(`/projects/${milestone.projectId}/milestones/${milestoneId}`);
}

export async function deleteMilestoneAction(milestoneId: string) {
  const user = await requireUser();
  if (!(await canManageMilestone(user, milestoneId))) {
    throw new Error("You do not have permission to manage this milestone.");
  }

  const milestone = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    include: { _count: { select: { assignments: true, tasks: true, timeEntries: true } } },
  });
  if (!milestone) throw new Error("Milestone not found.");
  if (milestone._count.assignments + milestone._count.tasks + milestone._count.timeEntries > 0) {
    throw new Error(
      `Can't delete — this milestone has ${milestone._count.assignments} assignment(s), ${milestone._count.tasks} task(s), and ${milestone._count.timeEntries} time entr${milestone._count.timeEntries === 1 ? "y" : "ies"}.`
    );
  }

  await prisma.milestone.delete({ where: { id: milestoneId } });
  revalidatePath(`/projects/${milestone.projectId}`);
  redirect(`/projects/${milestone.projectId}`);
}

export async function setMilestoneStatusAction(milestoneId: string, status: "PLANNED" | "ACTIVE" | "COMPLETE") {
  const user = await requireUser();
  if (!(await canManageMilestone(user, milestoneId))) {
    throw new Error("You do not have permission to manage this milestone.");
  }
  const milestone = await prisma.milestone.update({
    where: { id: milestoneId },
    data: { status },
    select: { projectId: true },
  });
  revalidatePath(`/projects/${milestone.projectId}`);
  revalidatePath(`/projects/${milestone.projectId}/milestones/${milestoneId}`);
}

export async function toggleMilestoneTimeEntryOpenAction(milestoneId: string, open: boolean) {
  const user = await requireUser();
  if (!(await canManageMilestone(user, milestoneId))) {
    throw new Error("You do not have permission to manage this milestone.");
  }
  const milestone = await prisma.milestone.update({
    where: { id: milestoneId },
    data: { timeEntryOpen: open },
    select: { projectId: true },
  });
  revalidatePath(`/projects/${milestone.projectId}/milestones/${milestoneId}`);
}

const CreateAssignmentSchema = z
  .object({
    milestoneId: z.string().min(1),
    userId: z.string().min(1),
    costRate: z.coerce.number().positive().optional(),
    allocatedHours: z.coerce.number().positive().optional(),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
  })
  .refine((d) => new Date(d.endDate) >= new Date(d.startDate), {
    message: "End date must be on or after the start date",
    path: ["endDate"],
  });

export async function createAssignmentAction(_prevState: string | undefined, formData: FormData) {
  const user = await requireUser();

  // Cost rate is derived from salary and only visible/editable by Admin/Finance — a submitted
  // override from anyone else is ignored rather than trusted, even though the field is hidden client-side.
  const canEditCostRate = can(user, "rates:view:any");

  const parsed = CreateAssignmentSchema.safeParse({
    milestoneId: formData.get("milestoneId"),
    userId: formData.get("userId"),
    costRate: canEditCostRate ? formData.get("costRate") || undefined : undefined,
    allocatedHours: formData.get("allocatedHours") || undefined,
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";
  const data = parsed.data;

  if (!(await canManageMilestone(user, data.milestoneId))) {
    return "You do not have permission to manage this milestone.";
  }

  const milestone = await prisma.milestone.findUnique({
    where: { id: data.milestoneId },
    select: { projectId: true },
  });
  if (!milestone) return "Milestone not found.";

  const targetUser = await prisma.user.findFirst({
    where: { id: data.userId, companyId: user.companyId },
    include: { employment: true },
  });
  if (!targetUser) return "Invalid user.";

  const costRate = data.costRate ?? (targetUser.employment ? Number(targetUser.employment.costRate) : undefined);
  if (costRate === undefined) {
    return `${targetUser.name} has no employment cost rate on file — enter a cost rate explicitly.`;
  }

  const existing = await prisma.assignment.findUnique({
    where: { milestoneId_userId: { milestoneId: data.milestoneId, userId: data.userId } },
  });
  if (existing) return `${targetUser.name} is already assigned to this milestone.`;

  await prisma.assignment.create({
    data: {
      milestoneId: data.milestoneId,
      userId: data.userId,
      costRate,
      allocatedHours: data.allocatedHours,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
    },
  });

  revalidatePath(`/projects/${milestone.projectId}/milestones/${data.milestoneId}`);
  redirect(`/projects/${milestone.projectId}/milestones/${data.milestoneId}`);
}

export async function setAssignmentStatusAction(assignmentId: string, status: "ACTIVE" | "PAUSED" | "CLOSED") {
  const user = await requireUser();

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { milestoneId: true, milestone: { select: { projectId: true } } },
  });
  if (!assignment) throw new Error("Assignment not found.");
  if (!(await canManageMilestone(user, assignment.milestoneId))) {
    throw new Error("You do not have permission to manage this milestone.");
  }

  await prisma.assignment.update({ where: { id: assignmentId }, data: { status } });
  revalidatePath(`/projects/${assignment.milestone.projectId}/milestones/${assignment.milestoneId}`);
}

const UpdateAssignmentSchema = z
  .object({
    assignmentId: z.string().min(1),
    costRate: z.coerce.number().positive("Cost rate must be positive").optional(),
    allocatedHours: z.coerce.number().positive().optional(),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
    status: z.enum(["ACTIVE", "PAUSED", "CLOSED"]),
  })
  .refine((d) => new Date(d.endDate) >= new Date(d.startDate), {
    message: "End date must be on or after the start date",
    path: ["endDate"],
  });

export async function updateAssignmentAction(_prevState: string | undefined, formData: FormData) {
  const user = await requireUser();
  const assignmentId = formData.get("assignmentId");
  if (typeof assignmentId !== "string") return "Missing assignment.";

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { milestoneId: true, milestone: { select: { projectId: true } } },
  });
  if (!assignment) return "Assignment not found.";
  if (!(await canManageMilestone(user, assignment.milestoneId))) {
    return "You do not have permission to manage this milestone.";
  }

  // Cost rate is derived from salary and only visible/editable by Admin/Finance — a submitted
  // value from anyone else is ignored rather than trusted, even though the field is hidden client-side.
  const canEditCostRate = can(user, "rates:view:any");
  const rawCostRate = formData.get("costRate");

  const parsed = UpdateAssignmentSchema.safeParse({
    assignmentId,
    costRate: canEditCostRate && rawCostRate ? rawCostRate : undefined,
    allocatedHours: formData.get("allocatedHours") || undefined,
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    status: formData.get("status"),
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";
  const data = parsed.data;

  // Guard: an assignment's allocation can't be lowered below what's already scheduled in the
  // resource planner. The planner's own save-time cap only checks against the allocation as it was
  // when each week was saved, so without this a plan could silently end up exceeding a
  // later-reduced allocation (see AssignmentPlan roll-up on the project + revenue report).
  if (data.allocatedHours != null) {
    const planned = await prisma.assignmentPlan.aggregate({ where: { assignmentId }, _sum: { hours: true } });
    const plannedTotal = Number(planned._sum.hours ?? 0);
    if (data.allocatedHours < plannedTotal) {
      return `This assignment already has ${plannedTotal}h scheduled in the resource planner. Reduce the plan first, or set the allocation to at least ${plannedTotal}h.`;
    }
  }

  await prisma.assignment.update({
    where: { id: assignmentId },
    data: {
      ...(data.costRate !== undefined ? { costRate: data.costRate } : {}),
      allocatedHours: data.allocatedHours ?? null,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      status: data.status,
    },
  });

  revalidatePath(`/projects/${assignment.milestone.projectId}/milestones/${assignment.milestoneId}`);
  redirect(`/projects/${assignment.milestone.projectId}/milestones/${assignment.milestoneId}`);
}

export async function deleteAssignmentAction(assignmentId: string) {
  const user = await requireUser();

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { milestone: { select: { projectId: true } }, _count: { select: { timeEntries: true } } },
  });
  if (!assignment) throw new Error("Assignment not found.");
  if (!(await canManageMilestone(user, assignment.milestoneId))) {
    throw new Error("You do not have permission to manage this milestone.");
  }
  if (assignment._count.timeEntries > 0) {
    throw new Error(`Can't delete — this assignment has ${assignment._count.timeEntries} time entr${assignment._count.timeEntries === 1 ? "y" : "ies"}.`);
  }

  await prisma.assignment.delete({ where: { id: assignmentId } });
  revalidatePath(`/projects/${assignment.milestone.projectId}/milestones/${assignment.milestoneId}`);
  redirect(`/projects/${assignment.milestone.projectId}/milestones/${assignment.milestoneId}`);
}

const CreateTaskSchema = z.object({
  milestoneId: z.string().min(1),
  name: z.string().min(1, "Task name is required"),
  assigneeId: z.string().optional(),
  estimatedHours: z.coerce.number().positive().optional(),
  dueDate: z.string().optional(),
});

export async function createTaskAction(_prevState: string | undefined, formData: FormData) {
  const user = await requireUser();

  const parsed = CreateTaskSchema.safeParse({
    milestoneId: formData.get("milestoneId"),
    name: formData.get("name"),
    assigneeId: formData.get("assigneeId") || undefined,
    estimatedHours: formData.get("estimatedHours") || undefined,
    dueDate: formData.get("dueDate") || undefined,
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";
  const data = parsed.data;

  if (!(await canManageMilestone(user, data.milestoneId))) {
    return "You do not have permission to manage this milestone.";
  }

  const milestone = await prisma.milestone.findUnique({
    where: { id: data.milestoneId },
    select: { projectId: true },
  });
  if (!milestone) return "Milestone not found.";

  await prisma.task.create({
    data: {
      milestoneId: data.milestoneId,
      name: data.name,
      assigneeId: data.assigneeId,
      estimatedHours: data.estimatedHours,
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
    },
  });

  revalidatePath(`/projects/${milestone.projectId}/milestones/${data.milestoneId}`);
  redirect(`/projects/${milestone.projectId}/milestones/${data.milestoneId}`);
}

const UpdateTaskSchema = z.object({
  taskId: z.string().min(1),
  name: z.string().min(1, "Task name is required"),
  assigneeId: z.string().optional(),
  estimatedHours: z.coerce.number().positive().optional(),
  dueDate: z.string().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "DONE"]),
});

export async function updateTaskAction(_prevState: string | undefined, formData: FormData) {
  const user = await requireUser();
  const taskId = formData.get("taskId");
  if (typeof taskId !== "string") return "Missing task.";

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { milestoneId: true, milestone: { select: { projectId: true } } },
  });
  if (!task) return "Task not found.";
  if (!(await canManageMilestone(user, task.milestoneId))) {
    return "You do not have permission to manage this milestone.";
  }

  const rawAssigneeId = formData.get("assigneeId");
  const parsed = UpdateTaskSchema.safeParse({
    taskId,
    name: formData.get("name"),
    assigneeId: rawAssigneeId && rawAssigneeId !== "__none__" ? rawAssigneeId : undefined,
    estimatedHours: formData.get("estimatedHours") || undefined,
    dueDate: formData.get("dueDate") || undefined,
    status: formData.get("status"),
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";
  const data = parsed.data;

  await prisma.task.update({
    where: { id: taskId },
    data: {
      name: data.name,
      assigneeId: data.assigneeId ?? null,
      estimatedHours: data.estimatedHours ?? null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      status: data.status,
    },
  });

  revalidatePath(`/projects/${task.milestone.projectId}/milestones/${task.milestoneId}`);
  redirect(`/projects/${task.milestone.projectId}/milestones/${task.milestoneId}`);
}

const QuickUpdateTaskSchema = z.object({
  name: z.string().min(1, "Task name is required"),
  assigneeId: z.string().nullable(),
  estimatedHours: z.coerce.number().positive().nullable(),
  dueDate: z.string().nullable(),
  status: z.enum(["TODO", "IN_PROGRESS", "DONE"]),
});

export async function quickUpdateTaskAction(
  taskId: string,
  data: {
    name: string;
    assigneeId: string | null;
    estimatedHours: number | null;
    dueDate: string | null;
    status: "TODO" | "IN_PROGRESS" | "DONE";
  }
) {
  const user = await requireUser();

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { milestoneId: true, milestone: { select: { projectId: true } } },
  });
  if (!task) throw new Error("Task not found.");
  if (!(await canManageMilestone(user, task.milestoneId))) {
    throw new Error("You do not have permission to manage this milestone.");
  }

  const parsed = QuickUpdateTaskSchema.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  const parsedData = parsed.data;

  await prisma.task.update({
    where: { id: taskId },
    data: {
      name: parsedData.name,
      assigneeId: parsedData.assigneeId,
      estimatedHours: parsedData.estimatedHours,
      dueDate: parsedData.dueDate ? new Date(parsedData.dueDate) : null,
      status: parsedData.status,
    },
  });

  revalidatePath(`/projects/${task.milestone.projectId}/milestones/${task.milestoneId}`);
}

export async function deleteTaskAction(taskId: string) {
  const user = await requireUser();

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { milestone: { select: { projectId: true } }, _count: { select: { timeEntries: true } } },
  });
  if (!task) throw new Error("Task not found.");
  if (!(await canManageMilestone(user, task.milestoneId))) {
    throw new Error("You do not have permission to manage this milestone.");
  }
  if (task._count.timeEntries > 0) {
    throw new Error(`Can't delete — this task has ${task._count.timeEntries} time entr${task._count.timeEntries === 1 ? "y" : "ies"}.`);
  }

  await prisma.task.delete({ where: { id: taskId } });
  revalidatePath(`/projects/${task.milestone.projectId}/milestones/${task.milestoneId}`);
  redirect(`/projects/${task.milestone.projectId}/milestones/${task.milestoneId}`);
}

const ReallocateSchema = z.object({
  fromMilestoneId: z.string().min(1),
  toMilestoneId: z.string().min(1),
  hours: z.coerce.number().positive("Hours must be positive"),
  reason: z.string().optional(),
});

export async function reallocateHoursAction(_prevState: string | undefined, formData: FormData) {
  const user = await requireUser();

  const parsed = ReallocateSchema.safeParse({
    fromMilestoneId: formData.get("fromMilestoneId"),
    toMilestoneId: formData.get("toMilestoneId"),
    hours: formData.get("hours"),
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";
  const { fromMilestoneId, toMilestoneId, hours, reason } = parsed.data;

  if (fromMilestoneId === toMilestoneId) return "Source and destination milestones must differ.";

  const [from, to] = await Promise.all([
    prisma.milestone.findUnique({ where: { id: fromMilestoneId }, include: { project: true } }),
    prisma.milestone.findUnique({ where: { id: toMilestoneId }, include: { project: true } }),
  ]);
  if (!from || !to) return "Milestone not found.";
  if (from.projectId !== to.projectId) return "Both milestones must belong to the same project.";
  if (!(await canManageProject(user, from.projectId))) {
    return "You do not have permission to manage this project.";
  }

  const fromBudgetHours = from.budgetHours ? Number(from.budgetHours) : 0;
  if (fromBudgetHours <= 0 || hours > fromBudgetHours) {
    return `Source milestone only has ${fromBudgetHours}h available to reallocate.`;
  }

  let destHours: number;
  let costMoved: number;

  if (from.project.billingType === "FIXED_PRICE") {
    const costPerHourSource = fromBudgetHours > 0 ? Number(from.cost) / fromBudgetHours : 0;
    costMoved = hours * costPerHourSource;
    const toBudgetHours = to.budgetHours ? Number(to.budgetHours) : 0;
    const costPerHourDest = toBudgetHours > 0 ? Number(to.cost) / toBudgetHours : costPerHourSource;
    destHours = costPerHourDest > 0 ? costMoved / costPerHourDest : hours;
  } else {
    const valueMoved = hours * Number(from.salesPrice);
    destHours = Number(to.salesPrice) > 0 ? valueMoved / Number(to.salesPrice) : hours;
    const costPerHourSource = fromBudgetHours > 0 ? Number(from.cost) / fromBudgetHours : 0;
    costMoved = hours * costPerHourSource;
  }

  destHours = Math.round(destHours * 100) / 100;
  costMoved = Math.round(costMoved * 100) / 100;

  await prisma.$transaction([
    prisma.milestone.update({
      where: { id: fromMilestoneId },
      data: { budgetHours: fromBudgetHours - hours, cost: Number(from.cost) - costMoved },
    }),
    prisma.milestone.update({
      where: { id: toMilestoneId },
      data: {
        budgetHours: (to.budgetHours ? Number(to.budgetHours) : 0) + destHours,
        cost: Number(to.cost) + costMoved,
      },
    }),
    prisma.milestoneReallocation.create({
      data: {
        fromMilestoneId,
        toMilestoneId,
        hours,
        hoursReceived: destHours,
        costMoved,
        byUserId: user.id,
        reason,
      },
    }),
  ]);

  revalidatePath(`/projects/${from.projectId}`);
  revalidatePath(`/projects/${from.projectId}/milestones/${fromMilestoneId}`);
  revalidatePath(`/projects/${from.projectId}/milestones/${toMilestoneId}`);
}

export async function copyTasksAction(_prevState: string | undefined, formData: FormData) {
  const user = await requireUser();

  const targetMilestoneId = formData.get("targetMilestoneId");
  if (typeof targetMilestoneId !== "string" || !targetMilestoneId) return "Missing target milestone.";

  const target = await prisma.milestone.findUnique({
    where: { id: targetMilestoneId },
    select: { projectId: true },
  });
  if (!target) return "Target milestone not found.";
  if (!(await canManageMilestone(user, targetMilestoneId))) {
    return "You do not have permission to manage this milestone.";
  }

  const rows: { name: string; estimatedHours?: number }[] = [];
  let i = 0;
  while (formData.has(`task_${i}_id`)) {
    if (formData.get(`task_${i}_selected`) === "on") {
      const name = formData.get(`task_${i}_name`);
      const hoursRaw = formData.get(`task_${i}_hours`);
      if (typeof name === "string" && name.trim()) {
        rows.push({
          name: name.trim(),
          estimatedHours: hoursRaw ? Number(hoursRaw) : undefined,
        });
      }
    }
    i++;
  }
  if (rows.length === 0) return "Select at least one task to copy.";

  await prisma.task.createMany({
    data: rows.map((r) => ({
      milestoneId: targetMilestoneId,
      name: r.name,
      estimatedHours: r.estimatedHours,
    })),
  });

  revalidatePath(`/projects/${target.projectId}/milestones/${targetMilestoneId}`);
  redirect(`/projects/${target.projectId}/milestones/${targetMilestoneId}`);
}
