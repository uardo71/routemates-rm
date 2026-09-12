import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { actionScope, loadActions } from "@/lib/actions-register-data";
import { ActionsRegisterClient } from "./actions-client";

export const metadata = { title: "Actions" };

// The cross-project actions register, open and completed. Admins see every action; project managers
// see the projects they manage; everyone else sees the actions assigned to them.
export default async function ActionsPage() {
  const user = await requireUser();
  const scope = await actionScope(user);
  const todayIso = format(new Date(), "yyyy-MM-dd");
  const [actions, projects] = await Promise.all([
    loadActions(user, { projectIds: scope.projectIds, mineOnly: scope.mineOnly, todayIso, include: "all", tickets: true }),
    prisma.project.findMany({
      where: { companyId: user.companyId, isInternal: false, ...(scope.projectIds === "ALL" ? {} : { id: { in: scope.projectIds } }) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return (
    <ActionsRegisterClient
      actions={actions}
      projects={projects}
      userId={user.id}
      mineOnly={scope.mineOnly}
      isAdmin={user.role === "ADMIN"}
      canManage={can(user, "delivery:manage")}
    />
  );
}
