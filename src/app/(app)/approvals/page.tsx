import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { toDateParam } from "@/lib/week";
import { ApprovalsTable, type ApprovalCard } from "./approvals-table";

export default async function ApprovalsPage() {
  const user = await requireUser();
  const canApproveAny = can(user, "timesheet:approve:any");
  if (!canApproveAny && user.role !== "PM") {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <p className="text-muted-foreground">You don&apos;t have any approvals to review.</p>
      </div>
    );
  }

  const pending = await prisma.timeCard.findMany({
    where: {
      status: "SUBMITTED",
      ...(canApproveAny ? {} : { approverId: user.id }),
    },
    include: {
      user: true,
      submittedBy: true,
      milestone: { include: { project: { include: { manager: true } } } },
      entries: { include: { task: true }, orderBy: { date: "asc" } },
    },
    orderBy: { submittedAt: "asc" },
  });

  const cards: ApprovalCard[] = pending.map((card) => ({
    id: card.id,
    userName: card.user.name,
    // Distinct from `userName` (whose time this is) — a PM/Admin can submit on someone else's
    // behalf, so who actually clicked Submit can be a different person.
    submittedByName: card.submittedBy?.name ?? null,
    weekStartDate: toDateParam(card.weekStartDate),
    projectName: card.milestone.project.name,
    milestoneName: card.milestone.name,
    totalHours: card.entries.reduce((s, e) => s + Number(e.hours), 0),
    submittedAt: card.submittedAt ? card.submittedAt.toISOString() : null,
    // Who's actually responsible for deciding this — the project's manager, pre-assigned at
    // submit time — not necessarily the person viewing this page (e.g. an Admin sees everyone's).
    approverName: card.milestone.project.manager?.name ?? null,
    entries: card.entries.map((e) => ({
      id: e.id,
      date: toDateParam(e.date),
      hours: Number(e.hours),
      taskName: e.task?.name ?? null,
      description: e.description ?? "",
    })),
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Approvals</h1>
      <ApprovalsTable cards={cards} />
    </div>
  );
}
