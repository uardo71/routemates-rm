import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { computeVacationBalance, countApprovedLeaveDays } from "@/lib/vacation";
import { toDateParam } from "@/lib/week";
import {
  VacationsClient,
  type BalanceRow,
  type PersonOption,
  type ProjectOption,
  type VacationRequestRow,
} from "./vacations-client";

export default async function VacationsPage() {
  const caller = await requireUser();
  const canManage = can(caller, "vacations:manage"); // Admin: approves, and can record on anyone's behalf (auto-approved)
  const canViewAll = can(caller, "vacations:view:any"); // Admin or PM: company-wide read access

  const requests = await prisma.leaveRequest.findMany({
    where: canViewAll ? { user: { companyId: caller.companyId } } : { userId: caller.id },
    include: { user: true, requestedBy: true, decidedBy: true, returns: true },
    orderBy: { startDate: "desc" },
  });

  const rows: VacationRequestRow[] = requests.map((r) => ({
    id: r.id,
    userId: r.userId,
    userName: r.user.name,
    type: r.type,
    startDate: toDateParam(r.startDate),
    endDate: toDateParam(r.endDate),
    workingDays: Number(r.workingDays),
    status: r.status,
    reason: r.reason,
    requestedByName: r.requestedBy.name,
    decidedByName: r.decidedBy?.name ?? null,
    decidedAt: r.decidedAt ? toDateParam(r.decidedAt) : null,
    comment: r.comment,
    canCancel: r.status === "PENDING" && (r.userId === caller.id || r.requestedById === caller.id || canManage),
    returns: r.returns
      .map((ret) => ({ startDate: toDateParam(ret.startDate), endDate: toDateParam(ret.endDate), workingDays: Number(ret.workingDays) }))
      .sort((a, b) => a.startDate.localeCompare(b.startDate)),
  }));

  let people: PersonOption[] = [];
  let projects: ProjectOption[] = [];
  let balances: BalanceRow[] = [];
  if (canManage) {
    const users = await prisma.user.findMany({
      where: { companyId: caller.companyId, active: true },
      orderBy: { name: "asc" },
    });
    people = users.map((u) => ({ id: u.id, name: u.name }));

    const internalProjects = await prisma.project.findMany({
      where: { companyId: caller.companyId, isInternal: true },
      orderBy: { name: "asc" },
    });
    projects = internalProjects.map((p) => ({ id: p.id, name: p.name }));

    balances = await Promise.all(
      users.map(async (u) => {
        const [b, sickDays] = await Promise.all([computeVacationBalance(u.id), countApprovedLeaveDays(u.id, "SICK")]);
        return { userId: u.id, userName: u.name, balance: b.balance, sickDaysThisYear: sickDays };
      })
    );
  }

  const [own, ownSickDays] = await Promise.all([computeVacationBalance(caller.id), countApprovedLeaveDays(caller.id, "SICK")]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Vacations</h1>
        <p className="text-sm text-muted-foreground">
          {canViewAll ? "Company-wide time off — everyone's requests and balances." : "Your time off requests and balance."}
        </p>
      </div>
      <VacationsClient
        callerId={caller.id}
        canManage={canManage}
        canViewAll={canViewAll}
        rows={rows}
        people={people}
        projects={projects}
        balances={balances}
        ownBalance={{ year: own.year, entitlement: own.entitlement, carriedIn: own.carriedIn, taken: own.taken, balance: own.balance }}
        ownSickDaysThisYear={ownSickDays}
      />
    </div>
  );
}
