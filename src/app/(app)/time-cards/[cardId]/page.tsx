import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import type { TimeCardStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { toDateParam } from "@/lib/week";
import { TimeCardGrid } from "@/components/time-card-grid";
import { cn } from "@/lib/utils";

export const metadata = { title: "Time card" };

const STATUS_LABEL: Record<TimeCardStatus, string> = { DRAFT: "Draft", SUBMITTED: "Submitted", APPROVED: "Approved", REJECTED: "Rejected" };
const STATUS_TONE: Record<TimeCardStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  SUBMITTED: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  APPROVED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  REJECTED: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

export default async function TimeCardPage({ params }: { params: Promise<{ cardId: string }> }) {
  const raw = (await params).cardId;
  // Card ids can contain a colon (client-generated "new:uuid" ids persisted as the primary key), which
  // is percent-encoded in the URL. Decoding is a no-op for ids that have no escape sequences.
  const cardId = decodeURIComponent(raw);
  const user = await requireUser();

  const card = await prisma.timeCard.findUnique({
    where: { id: cardId },
    include: {
      user: true,
      submittedBy: true,
      milestone: { include: { project: { include: { manager: true } } } },
      entries: { include: { task: true }, orderBy: { date: "asc" } },
    },
  });
  if (!card || card.milestone.project.companyId !== user.companyId) notFound();

  const allowed =
    can(user, "reports:view") ||
    can(user, "delivery:manage") ||
    can(user, "timesheet:approve:any") ||
    card.userId === user.id ||
    card.approverId === user.id;
  if (!allowed) notFound();

  const entries = card.entries.map((e) => ({
    id: e.id,
    date: toDateParam(e.date),
    hours: Number(e.hours),
    taskName: e.task?.name ?? null,
    description: e.description ?? "",
    billed: e.invoiceLineId != null,
  }));
  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  const unbilledHours = entries.filter((e) => !e.billed).reduce((s, e) => s + e.hours, 0);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <Link href="/command" className="text-sm text-muted-foreground hover:underline">← Command center</Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {card.user.name} — week of {format(new Date(card.weekStartDate), "MMM d, yyyy")}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{card.milestone.project.name} — {card.milestone.name}</p>
        </div>
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", STATUS_TONE[card.status])}>{STATUS_LABEL[card.status]}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-4">
        <Field label="Submitted">
          {card.submittedAt ? format(new Date(card.submittedAt), "MMM d, yyyy") : "—"}
          {card.submittedBy?.name && card.submittedBy.name !== card.user.name && (
            <span className="block text-xs text-muted-foreground">by {card.submittedBy.name}</span>
          )}
        </Field>
        <Field label="Approver">{card.milestone.project.manager?.name ?? "—"}</Field>
        <Field label="Total hours"><span className="font-mono tabular-nums">{totalHours}h</span></Field>
        <Field label="Not yet billed">
          <span className={cn("font-mono tabular-nums", unbilledHours > 0 && "font-semibold text-amber-600 dark:text-amber-400")}>{unbilledHours}h</span>
        </Field>
      </div>

      <TimeCardGrid weekStartDate={toDateParam(card.weekStartDate)} entries={entries} totalHours={totalHours} highlightUnbilled />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
