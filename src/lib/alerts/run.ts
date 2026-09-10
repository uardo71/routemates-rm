import "server-only";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, STAFF_ONLY, type SessionUser } from "@/lib/permissions";
import { invoiceTotals, outstanding, effectiveDueDate } from "@/lib/invoice";
import { notify, delivered, noChannelAvailable } from "@/lib/notify";
import { getAlertsConfig, getAlertsLastRun, setAlertsLastRun } from "@/lib/settings";
import { toDateParam } from "@/lib/week";
import { evaluateAll, type Alert, type AlertData, type Recipient } from "./rules";
import { loadDeliveryAlertData } from "./delivery-data";

// The daily alerts runner. Loads what the pure rules need, evaluates them, dedups through the
// Notification ledger, fans out through notify(). Idempotent per day via an AppSetting marker, and
// per alert forever via the ledger's unique key.

export type AlertsRunReport = {
  companyId: string;
  dryRun: boolean;
  skipped?: string;
  /** What the rules produced, before the ledger. `alreadySent` ones are shown but never re-sent. */
  candidates: { kind: string; targetType: string; targetId: string; subject: string; recipients: string[]; alreadySent: boolean }[];
  sent: number;
  suppressed: number;
  failed: string[];
  noChannel: boolean;
};

function hashKey(payloadKey: string): string {
  return createHash("sha256").update(payloadKey).digest("hex").slice(0, 32);
}
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// ---------- data loading ----------

async function loadAlertData(companyId: string, today: string): Promise<AlertData> {
  const baseUrl = (process.env.AUTH_URL ?? "").replace(/\/$/, "");
  const [projects, entries, invoices, timecards, expenses, assignments, opportunities, milestones, certifications, delivery] = await Promise.all([
    prisma.project.findMany({
      where: { companyId, isInternal: false },
      select: { id: true, number: true, name: true, managerId: true, status: true, budgetHours: true, budgetAmount: true },
    }),
    // Approved time only — the same "draft hours are not actual" rule every report follows.
    prisma.timeEntry.findMany({
      where: { timeCard: { status: "APPROVED" }, milestone: { project: { companyId, isInternal: false } } },
      select: { hours: true, costRate: true, assignment: { select: { costRate: true } }, milestone: { select: { projectId: true } } },
    }),
    prisma.invoice.findMany({
      where: { companyId, status: { in: ["ISSUED", "RECONCILED"] } },
      select: { id: true, invoiceNumber: true, status: true, dueDate: true, issueDate: true, vatRate: true, currency: true, client: { select: { name: true, paymentTermsDays: true } }, lines: { select: { amount: true } }, payments: { select: { amount: true, bankFee: true } } },
    }),
    prisma.timeCard.findMany({
      where: { status: "SUBMITTED", user: { companyId } },
      select: { id: true, approverId: true, submittedAt: true, weekStartDate: true, status: true, user: { select: { name: true } } },
    }),
    prisma.expense.findMany({
      where: { status: "PENDING", user: { companyId } },
      select: { id: true, amount: true, currency: true, createdAt: true, status: true, user: { select: { name: true } } },
    }),
    prisma.assignment.findMany({
      where: { status: "ACTIVE", milestone: { project: { companyId, isInternal: false } } },
      select: { id: true, userId: true, endDate: true, status: true, user: { select: { name: true } }, milestone: { select: { name: true, project: { select: { name: true, managerId: true } } } } },
    }),
    prisma.opportunity.findMany({
      where: { companyId, stage: "WON", poValidUntil: { not: null } },
      // The PM of a won deal is the manager of the project it converted into (Opportunity.projectId).
      select: { id: true, name: true, ownerId: true, poNumber: true, poValidUntil: true, stage: true, project: { select: { managerId: true } } },
    }),
    prisma.milestone.findMany({
      where: { status: { notIn: ["COMPLETE", "INVOICED"] }, endDate: { not: null }, project: { companyId, isInternal: false } },
      select: { id: true, name: true, endDate: true, status: true, project: { select: { name: true, managerId: true } } },
    }),
    prisma.certification.findMany({
      where: { expiryDate: { not: null }, user: { companyId, active: true } },
      select: { id: true, userId: true, name: true, issuer: true, expiryDate: true, user: { select: { name: true } } },
    }),
    loadDeliveryAlertData(companyId, baseUrl),
  ]);

  const hoursBy = new Map<string, number>();
  const costBy = new Map<string, number>();
  for (const e of entries) {
    const pid = e.milestone.projectId;
    const h = Number(e.hours);
    const rate = e.costRate != null ? Number(e.costRate) : Number(e.assignment.costRate);
    hoursBy.set(pid, (hoursBy.get(pid) ?? 0) + h);
    costBy.set(pid, (costBy.get(pid) ?? 0) + h * rate);
  }
  return {
    today,
    projects: projects.map((p) => ({
      id: p.id, number: p.number ?? "", name: p.name, managerId: p.managerId, status: p.status,
      budgetHours: p.budgetHours == null ? null : Number(p.budgetHours),
      budgetAmount: p.budgetAmount == null ? null : Number(p.budgetAmount),
      approvedHours: Math.round((hoursBy.get(p.id) ?? 0) * 100) / 100,
      internalCost: Math.round((costBy.get(p.id) ?? 0) * 100) / 100,
      currency: "EUR", // cost rates are always EUR (salary-derived) — budgetAmount is compared in the same unit
    })),
    invoices: invoices.map((i) => {
      const t = invoiceTotals(i.lines.map((l) => ({ amount: Number(l.amount) })), i.vatRate == null ? null : Number(i.vatRate));
      return {
        id: i.id, invoiceNumber: i.invoiceNumber, clientName: i.client.name, status: i.status,
        // Same rule as the AR aging page: the invoice's own due date, else issue date + the client's
        // payment terms, else nothing — a missing due date is never guessed into being overdue.
        dueDate: iso(effectiveDueDate(i.dueDate, i.issueDate, i.client.paymentTermsDays)), currency: i.currency,
        outstanding: outstanding(t.gross, i.payments.map((p) => ({ amount: Number(p.amount), bankFee: Number(p.bankFee) }))),
      };
    }),
    timecards: timecards.map((c) => ({ id: c.id, userName: c.user.name, approverId: c.approverId, submittedAt: iso(c.submittedAt), weekStartDate: c.weekStartDate.toISOString(), status: c.status })),
    expenses: expenses.map((x) => ({ id: x.id, ownerName: x.user.name, amount: Number(x.amount), currency: x.currency, createdAt: x.createdAt.toISOString(), status: x.status })),
    assignments: assignments.map((a) => ({
      id: a.id, userId: a.userId, userName: a.user.name, milestoneName: a.milestone.name, projectName: a.milestone.project.name,
      projectManagerId: a.milestone.project.managerId, endDate: a.endDate.toISOString(), status: a.status,
    })),
    opportunities: opportunities.map((o) => ({
      id: o.id, name: o.name, ownerId: o.ownerId, poNumber: o.poNumber, poValidUntil: iso(o.poValidUntil), stage: o.stage,
      projectManagerId: o.project?.managerId ?? null,
    })),
    milestones: milestones.map((m) => ({ id: m.id, name: m.name, projectName: m.project.name, projectManagerId: m.project.managerId, endDate: iso(m.endDate), status: m.status })),
    certifications: certifications.map((c) => ({ id: c.id, userId: c.userId, userName: c.user.name, name: c.name, issuer: c.issuer, expiryDate: iso(c.expiryDate) })),
    delivery,
  };
}

// ---------- recipients ----------

type Staff = { id: string; email: string; role: SessionUser["role"]; companyId: string };
function resolveRecipients(recipients: Recipient[], staff: Staff[]): string[] {
  const emails = new Set<string>();
  for (const r of recipients) {
    if ("userId" in r) {
      const u = staff.find((s) => s.id === r.userId);
      if (u) emails.add(u.email);
    } else {
      for (const u of staff) if (can(u, r.action)) emails.add(u.email);
    }
  }
  return [...emails];
}

// ---------- the run ----------

export async function runAlerts(companyId: string, opts: { dryRun?: boolean; force?: boolean } = {}): Promise<AlertsRunReport> {
  const dryRun = !!opts.dryRun;
  const cfg = await getAlertsConfig();
  const today = toDateParam(new Date());
  const report: AlertsRunReport = { companyId, dryRun, candidates: [], sent: 0, suppressed: 0, failed: [], noChannel: false };

  if (!cfg.enabled) { report.skipped = "alerts disabled in settings"; return report; }
  if (!opts.force && !dryRun && (await getAlertsLastRun()) === today) { report.skipped = "already ran today"; return report; }

  const [data, staff, ledger] = await Promise.all([
    loadAlertData(companyId, today),
    prisma.user.findMany({ where: { companyId, active: true, ...STAFF_ONLY }, select: { id: true, email: true, role: true, companyId: true } }),
    prisma.notification.findMany({ where: { companyId }, select: { kind: true, targetId: true, payloadHash: true } }),
  ]);
  const sentSet = new Set(ledger.map((n) => `${n.kind}|${n.targetId}|${n.payloadHash}`));
  const isSent = (kind: string, targetId: string, payloadKey: string) => sentSet.has(`${kind}|${targetId}|${hashKey(payloadKey)}`);

  // Evaluate with an always-false isSent so the report can show suppressed alerts too, then split.
  const all = evaluateAll(data, cfg, () => false);
  const fresh: Alert[] = [];
  for (const a of all) {
    const already = isSent(a.kind, a.targetId, a.payloadKey);
    const to = resolveRecipients(a.recipients, staff);
    report.candidates.push({ kind: a.kind, targetType: a.targetType, targetId: a.targetId, subject: a.subject, recipients: to, alreadySent: already });
    if (already) report.suppressed++;
    else fresh.push(a);
  }
  if (dryRun) return report;

  let anySent = false;
  for (const a of fresh) {
    const to = resolveRecipients(a.recipients, staff);
    if (to.length === 0 && !cfg.teamsEnabled) { report.failed.push(`${a.kind}/${a.targetId}: no recipient`); continue; }

    // Claim the alert in the ledger FIRST. The unique key makes this race-safe: two overlapping runs
    // can't both send, because only one insert succeeds.
    let row: { id: string } | null = null;
    try {
      row = await prisma.notification.create({
        data: { companyId, kind: a.kind, targetType: a.targetType, targetId: a.targetId, payloadHash: hashKey(a.payloadKey), channel: "", recipient: "" },
        select: { id: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") { report.suppressed++; continue; }
      throw e;
    }

    const r = await notify({
      subject: a.subject, html: a.html, recipients: to,
      teamsTitle: a.subject, teamsText: a.teamsText,
      channels: { email: cfg.emailEnabled, teams: cfg.teamsEnabled },
    });

    if (noChannelAvailable(r) || !delivered(r)) {
      // Nothing went out — release the claim so tomorrow's run tries again once a channel works.
      await prisma.notification.delete({ where: { id: row.id } });
      if (noChannelAvailable(r)) report.noChannel = true;
      else report.failed.push(`${a.kind}/${a.targetId}: ${[...r.email.errors, r.teams.status].join("; ")}`);
      continue;
    }
    const channels = [r.email.sent.length > 0 ? "email" : null, r.teams.status === "sent" ? "teams" : null].filter(Boolean).join(",");
    await prisma.notification.update({ where: { id: row.id }, data: { channel: channels, recipient: [...r.email.sent, ...(r.teams.status === "sent" ? ["teams"] : [])].join(",") } });
    report.sent++;
    anySent = true;
    for (const err of r.email.errors) report.failed.push(`${a.kind}/${a.targetId}: ${err}`);
  }

  // Mark the day only when something actually went out — an empty day can be re-run later.
  if (anySent) await setAlertsLastRun(today);
  return report;
}
