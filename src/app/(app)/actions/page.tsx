import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { actionScope, loadOpenActions } from "@/lib/actions-register-data";
import { ActionsRegisterClient } from "./actions-client";

export const metadata = { title: "Actions" };

// The cross-project actions register. Delivery managers see every open action on the projects
// they manage (admins: all); everyone else sees the actions assigned to them.
export default async function ActionsPage() {
  const user = await requireUser();
  const scope = await actionScope(user);
  const todayIso = format(new Date(), "yyyy-MM-dd");
  const [actions, projects] = await Promise.all([
    loadOpenActions(user, { projectIds: scope.projectIds, mineOnly: scope.mineOnly, todayIso }),
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
      canManage={can(user, "delivery:manage")}
    />
  );
}
