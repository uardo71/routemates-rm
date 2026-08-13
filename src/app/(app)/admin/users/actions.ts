"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { requirePermission } from "@/lib/session";
import { recomputeEmploymentCostRate } from "@/lib/cost-rate";

const CreateUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["ADMIN", "FINANCE", "SALES", "PM", "EMPLOYEE", "CONTRACTOR"]),
  trackEmployment: z.boolean(),
  startDate: z.string().optional(),
});

export async function createUserAction(_prevState: string | undefined, formData: FormData) {
  const user = await requirePermission("users:manage");

  const parsed = CreateUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
    trackEmployment: formData.get("trackEmployment") === "on",
    startDate: formData.get("startDate") || undefined,
  });

  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? "Invalid input";
  }

  const data = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) return "A user with that email already exists.";

  // No salary can exist for a brand-new user yet, so cost rate starts at 0 — it's computed
  // automatically once a salary is recorded on their profile.
  const employmentCreate = data.trackEmployment
    ? {
        create: {
          type: data.role === "CONTRACTOR" ? ("CONTRACTOR" as const) : ("EMPLOYEE" as const),
          costRate: 0,
          startDate: data.startDate ? new Date(data.startDate) : new Date(),
        },
      }
    : undefined;

  const passwordHash = await hashPassword(data.password);

  const newUser = await prisma.user.create({
    data: {
      companyId: user.companyId,
      name: data.name,
      email: data.email,
      passwordHash,
      role: data.role,
      employment: employmentCreate,
    },
  });

  revalidatePath("/admin/users");
  redirect(`/admin/users/${newUser.id}`);
}

const orNull = (v?: string) => {
  const t = v?.trim();
  return t ? t : null;
};

const UpdateUserSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  role: z.enum(["ADMIN", "FINANCE", "SALES", "PM", "EMPLOYEE", "CONTRACTOR"]),
  active: z.boolean(),
  title: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  location: z.string().max(120).optional(),
  trackEmployment: z.boolean(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  carriedInVacationDays: z.string().optional(),
  carriedInVacationYear: z.string().optional(),
  newPassword: z.string().min(8).optional().or(z.literal("")),
});

export async function updateUserAction(_prevState: string | undefined, formData: FormData) {
  const user = await requirePermission("users:manage");

  const parsed = UpdateUserSchema.safeParse({
    userId: formData.get("userId"),
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    active: formData.get("active") === "on",
    title: formData.get("title") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    location: formData.get("location") ?? undefined,
    trackEmployment: formData.get("trackEmployment") === "on",
    startDate: formData.get("startDate") || undefined,
    endDate: formData.get("endDate") || undefined,
    carriedInVacationDays: formData.get("carriedInVacationDays") || undefined,
    carriedInVacationYear: formData.get("carriedInVacationYear") || undefined,
    newPassword: formData.get("newPassword") || undefined,
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";
  const data = parsed.data;

  // Manual opening vacation balance. Blank days clears it (and the year); if days are given
  // without a year, the balance is treated as of Jan 1 of the current year.
  const carriedDaysRaw = data.carriedInVacationDays?.trim();
  let carriedInVacationDays: number | null = null;
  let carriedInVacationYear: number | null = null;
  if (carriedDaysRaw) {
    carriedInVacationDays = Number(carriedDaysRaw);
    if (!Number.isFinite(carriedInVacationDays) || carriedInVacationDays < 0) {
      return "Carried-in vacation days must be a number of 0 or more.";
    }
    const yearRaw = data.carriedInVacationYear?.trim();
    carriedInVacationYear = yearRaw ? Number(yearRaw) : new Date().getFullYear();
    if (!Number.isInteger(carriedInVacationYear) || carriedInVacationYear < 2000 || carriedInVacationYear > 2100) {
      return "Carried-in vacation year must be a valid year.";
    }
  }

  const target = await prisma.user.findFirst({
    where: { id: data.userId, companyId: user.companyId },
    include: { employment: true },
  });
  if (!target) return "User not found.";

  if (data.email !== target.email) {
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) return "A user with that email already exists.";
  }

  const passwordHash = data.newPassword ? await hashPassword(data.newPassword) : undefined;

  await prisma.user.update({
    where: { id: data.userId },
    data: {
      name: data.name,
      email: data.email,
      role: data.role,
      active: data.active,
      title: orNull(data.title),
      phone: orNull(data.phone),
      location: orNull(data.location),
      ...(passwordHash ? { passwordHash } : {}),
    },
  });

  if (data.trackEmployment) {
    await prisma.employment.upsert({
      where: { userId: data.userId },
      create: {
        userId: data.userId,
        type: data.role === "CONTRACTOR" ? "CONTRACTOR" : "EMPLOYEE",
        costRate: 0,
        startDate: data.startDate ? new Date(data.startDate) : new Date(),
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        carriedInVacationDays,
        carriedInVacationYear,
      },
      update: {
        type: data.role === "CONTRACTOR" ? "CONTRACTOR" : "EMPLOYEE",
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        carriedInVacationDays,
        carriedInVacationYear,
      },
    });
    // Cost rate is never typed in directly — derive it from salary history.
    await recomputeEmploymentCostRate(data.userId);
  } else if (target.employment) {
    await prisma.employment.delete({ where: { userId: data.userId } });
  }

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${data.userId}`);
}

export async function deleteUserAction(userId: string) {
  const user = await requirePermission("users:manage");

  const target = await prisma.user.findFirst({ where: { id: userId, companyId: user.companyId } });
  if (!target) throw new Error("User not found.");
  if (target.id === user.id) throw new Error("You can't delete your own account.");

  const [timeEntries, assignments, approvals, managedProjects] = await Promise.all([
    prisma.timeEntry.count({ where: { userId } }),
    prisma.assignment.count({ where: { userId } }),
    prisma.timeCard.count({ where: { approverId: userId } }),
    prisma.project.count({ where: { managerId: userId } }),
  ]);
  const totalDependents = timeEntries + assignments + approvals + managedProjects;
  if (totalDependents > 0) {
    throw new Error(
      `Can't delete — this user has ${assignments} assignment(s), ${timeEntries} time entr${timeEntries === 1 ? "y" : "ies"}, ${approvals} approval(s), and manages ${managedProjects} project(s). Deactivate instead.`
    );
  }

  await prisma.$transaction([
    prisma.employment.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  revalidatePath("/admin/users");
  redirect("/admin/users");
}

