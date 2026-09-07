import type { SystemRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type Action =
  | "users:manage"
  | "clients:manage"
  | "clients:view"
  | "projects:view"
  | "projects:create"
  | "projects:manage:any"
  | "timesheet:approve:any"
  | "rates:view:any"
  | "invoices:manage"
  | "planning:view"
  | "delivery:manage"
  | "salaries:manage"
  | "vacations:manage"
  | "vacations:view:any"
  | "expenses:manage"
  | "taxes:manage"
  | "vendors:manage"
  | "opportunities:view"
  | "opportunities:manage"
  | "opportunities:approve"
  | "reports:view"
  | "tickets:view"
  | "tickets:manage";

// Employees and contractors are delivery staff, not delivery managers: for now they
// only get the Dashboard, their own Time page (logging hours against assignments
// they've been given), and their own Vacations page. They have no visibility into
// projects/milestones/clients — that's PM/Admin/Finance territory.
const ROLE_PERMISSIONS: Record<SystemRole, Action[]> = {
  ADMIN: [
    "users:manage",
    "clients:manage",
    "clients:view",
    "projects:view",
    "projects:create",
    "projects:manage:any",
    "timesheet:approve:any",
    "rates:view:any",
    "invoices:manage",
    "planning:view",
    "delivery:manage",
    "salaries:manage",
    "vacations:manage",
    "vacations:view:any",
    "expenses:manage",
    "taxes:manage",
    "vendors:manage",
    "opportunities:view",
    "opportunities:manage",
    "opportunities:approve",
    "reports:view",
    "tickets:view",
    "tickets:manage",
  ],
  FINANCE: ["clients:view", "projects:view", "rates:view:any", "invoices:manage", "salaries:manage", "expenses:manage", "opportunities:view", "reports:view", "tickets:view"],
  SALES: ["clients:manage", "clients:view", "opportunities:view", "opportunities:manage", "tickets:view"],
  PM: ["projects:view", "projects:create", "planning:view", "delivery:manage", "vacations:view:any", "opportunities:view", "opportunities:manage", "tickets:view", "tickets:manage"],
  EMPLOYEE: [],
  CONTRACTOR: [],
  // Customer portal users never hold internal permissions — their access is granted through the
  // /portal guards, scoped to their own client, not through `can(...)`.
  CUSTOMER: [],
};

export type SessionUser = {
  id: string;
  role: SystemRole;
  companyId: string;
};

export function can(user: SessionUser | null | undefined, action: Action): boolean {
  if (!user) return false;
  return ROLE_PERMISSIONS[user.role]?.includes(action) ?? false;
}

/** Project IDs a user is allowed to see: admin/finance see all; PMs see only projects they manage;
 *  everyone else sees only projects where they hold at least one milestone assignment. */
export async function visibleProjectIds(user: SessionUser): Promise<string[] | "ALL"> {
  if (user.role === "ADMIN" || user.role === "FINANCE") return "ALL";

  const where =
    user.role === "PM"
      ? { companyId: user.companyId, managerId: user.id }
      : { companyId: user.companyId, milestones: { some: { assignments: { some: { userId: user.id } } } } };
  const projects = await prisma.project.findMany({ where, select: { id: true } });
  return projects.map((p) => p.id);
}

/** Whether `user` may manage (edit milestones/assignments/tasks/budget of) a specific project. */
export async function canManageProject(user: SessionUser, projectId: string): Promise<boolean> {
  if (can(user, "projects:manage:any")) return true;
  if (user.role !== "PM") return false;
  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId: user.companyId, managerId: user.id },
    select: { id: true },
  });
  return project !== null;
}

/** Whether `user` may manage a specific milestone (create/edit assignments, tasks, reallocate hours). */
export async function canManageMilestone(user: SessionUser, milestoneId: string): Promise<boolean> {
  if (can(user, "projects:manage:any")) return true;
  if (user.role !== "PM") return false;
  const milestone = await prisma.milestone.findFirst({
    where: { id: milestoneId, project: { companyId: user.companyId, managerId: user.id } },
    select: { id: true },
  });
  return milestone !== null;
}

/** Whether `user` may decide (approve/reject) a specific TimeCard.
 *  Each TimeCard is pre-assigned to one approver (the manager of the relevant
 *  project) at submission time, so this is a direct ownership check. */
export function canDecideApproval(user: SessionUser, card: { approverId: string | null }): boolean {
  return can(user, "timesheet:approve:any") || (user.role === "PM" && card.approverId === user.id);
}

/** Whether `user` may view/edit delivery working docs of a project (cutover plan, UAT test scripts):
 *  the managing PM/Admin, OR any consultant assigned to one of the project's milestones. */
export async function canAccessProjectDelivery(user: SessionUser, projectId: string): Promise<boolean> {
  if (await canManageProject(user, projectId)) return true;
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      companyId: user.companyId,
      milestones: { some: { assignments: { some: { userId: user.id } } } },
    },
    select: { id: true },
  });
  return project !== null;
}

/** @deprecated alias — cutover uses the shared delivery-member check. */
export async function canAccessProjectCutover(user: SessionUser, projectId: string): Promise<boolean> {
  return canAccessProjectDelivery(user, projectId);
}

/** Prisma `where` for the tickets a user may see: everyone with `tickets:view` sees the whole
 *  company; everyone else (employees/contractors) sees only tickets they raised, were assigned, or
 *  created. */
export function visibleTicketWhere(user: SessionUser): { companyId: string; OR?: object[] } {
  if (can(user, "tickets:view")) return { companyId: user.companyId };
  return { companyId: user.companyId, OR: [{ requesterId: user.id }, { assigneeId: user.id }, { createdById: user.id }] };
}

/** Whether `user` may see bill/cost rate figures for the given project (own projects for PMs). */
export async function canViewProjectRates(user: SessionUser, projectId: string): Promise<boolean> {
  if (can(user, "rates:view:any")) return true;
  return canManageProject(user, projectId);
}

/** Whether `user` may see sales price/cost figures for the given milestone (own projects for PMs). */
export async function canViewMilestoneRates(user: SessionUser, milestoneId: string): Promise<boolean> {
  if (can(user, "rates:view:any")) return true;
  return canManageMilestone(user, milestoneId);
}
