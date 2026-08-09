"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { canManageProject } from "@/lib/permissions";

const CreateProjectSchema = z.object({
  name: z.string().min(1, "Name is required"),
  clientId: z.string().min(1, "Client is required"),
  billingType: z.enum(["TIME_AND_MATERIALS", "FIXED_PRICE", "RETAINER"]),
  budgetAmount: z.coerce.number().positive().optional(),
  budgetHours: z.coerce.number().positive().optional(),
  startDate: z.string().optional(),
  managerId: z.string().optional(),
});

export async function createProjectAction(_prevState: string | undefined, formData: FormData) {
  const user = await requirePermission("projects:create");

  const parsed = CreateProjectSchema.safeParse({
    name: formData.get("name"),
    clientId: formData.get("clientId"),
    billingType: formData.get("billingType"),
    budgetAmount: formData.get("budgetAmount") || undefined,
    budgetHours: formData.get("budgetHours") || undefined,
    startDate: formData.get("startDate") || undefined,
    managerId: formData.get("managerId") || undefined,
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";

  const data = parsed.data;
  const managerId = user.role === "PM" ? user.id : data.managerId;
  if (!managerId) return "A project manager is required.";

  const manager = await prisma.user.findFirst({
    where: { id: managerId, companyId: user.companyId },
  });
  if (!manager) return "Invalid project manager.";

  const client = await prisma.client.findFirst({
    where: { id: data.clientId, companyId: user.companyId },
  });
  if (!client) return "Invalid client.";

  const project = await prisma.project.create({
    data: {
      companyId: user.companyId,
      clientId: client.id,
      name: data.name,
      billingType: data.billingType,
      budgetAmount: data.budgetAmount,
      budgetHours: data.budgetHours,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      managerId: manager.id,
      status: "ACTIVE",
    },
  });

  revalidatePath("/projects");
  redirect(`/projects/${project.id}`);
}

const UpdateProjectSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1, "Name is required"),
  clientId: z.string().min(1, "Client is required"),
  status: z.enum(["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]),
  billingType: z.enum(["TIME_AND_MATERIALS", "FIXED_PRICE", "RETAINER"]),
  budgetAmount: z.coerce.number().positive().optional(),
  budgetHours: z.coerce.number().positive().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  managerId: z.string().optional(),
});

export async function updateProjectAction(_prevState: string | undefined, formData: FormData) {
  const user = await requirePermission("projects:view");
  const projectId = formData.get("projectId");
  if (typeof projectId !== "string") return "Missing project.";
  if (!(await canManageProject(user, projectId))) return "You do not have permission to manage this project.";

  const parsed = UpdateProjectSchema.safeParse({
    projectId,
    name: formData.get("name"),
    clientId: formData.get("clientId"),
    status: formData.get("status"),
    billingType: formData.get("billingType"),
    budgetAmount: formData.get("budgetAmount") || undefined,
    budgetHours: formData.get("budgetHours") || undefined,
    startDate: formData.get("startDate") || undefined,
    endDate: formData.get("endDate") || undefined,
    managerId: formData.get("managerId") || undefined,
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";
  const data = parsed.data;

  const client = await prisma.client.findFirst({ where: { id: data.clientId, companyId: user.companyId } });
  if (!client) return "Invalid client.";

  let managerId: string | undefined;
  if (data.managerId) {
    const manager = await prisma.user.findFirst({ where: { id: data.managerId, companyId: user.companyId } });
    if (!manager) return "Invalid project manager.";
    managerId = manager.id;
  }

  await prisma.project.update({
    where: { id: projectId },
    data: {
      name: data.name,
      clientId: data.clientId,
      status: data.status,
      billingType: data.billingType,
      budgetAmount: data.budgetAmount ?? null,
      budgetHours: data.budgetHours ?? null,
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      ...(managerId ? { managerId } : {}),
    },
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}

export async function deleteProjectAction(projectId: string) {
  const user = await requirePermission("projects:view");
  if (!(await canManageProject(user, projectId))) {
    throw new Error("You do not have permission to manage this project.");
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId },
    include: { _count: { select: { milestones: true } } },
  });
  if (!project) throw new Error("Project not found.");
  if (project._count.milestones > 0) {
    throw new Error(`Can't delete — this project has ${project._count.milestones} milestone(s).`);
  }

  await prisma.project.delete({ where: { id: projectId } });
  revalidatePath("/projects");
  redirect("/projects");
}
