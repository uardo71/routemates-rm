import type { AlertsConfig, AlertKind } from "./config";

// The alert rules. Pure predicates over data the caller loads — no Prisma, no clock other than the
// `now` passed in — so every threshold and every "already sent" case is unit-testable. Each rule
// returns the alerts that should go out today; the runner (run.ts) resolves recipients to addresses,
// consults the Notification ledger, and sends.
//
// Suppression is a two-layer thing. Rules skip anything `isSent` reports as already sent (so a test
// can prove a second evaluation is silent); the DB unique on (kind, targetId, payloadHash) is the
// hard guarantee underneath it.
//
// The `payloadKey` is what makes an alert "the same" alert. Choose it so the rule re-fires exactly
// when it should: a threshold in the key ⇒ once per threshold; a date in the key ⇒ again if the
// date is moved.

export type { AlertKind };
export type RecipientAction = "invoices:manage" | "expenses:manage" | "timesheet:approve:any";
export type Recipient = { userId: string } | { action: RecipientAction };

export type Alert = {
  kind: AlertKind;
  targetType: "project" | "invoice" | "timecard" | "expense" | "assignment" | "opportunity" | "milestone";
  targetId: string;
  payloadKey: string;
  subject: string;
  html: string;
  teamsText: string;
  recipients: Recipient[];
};

export type IsSent = (kind: AlertKind, targetId: string, payloadKey: string) => boolean;

export type AlertData = {
  /** "Today" for every rule, as yyyy-MM-dd. */
  today: string;
  projects: {
    id: string; number: string; name: string; managerId: string | null; status: string;
    budgetHours: number | null; budgetAmount: number | null;
    approvedHours: number; internalCost: number; currency: string;
  }[];
  invoices: {
    id: string; invoiceNumber: string; clientName: string; status: string;
    dueDate: string | null; outstanding: number; currency: string;
  }[];
  timecards: { id: string; userName: string; approverId: string | null; submittedAt: string | null; weekStartDate: string; status: string }[];
  expenses: { id: string; ownerName: string; amount: number; currency: string; createdAt: string; status: string }[];
  assignments: {
    id: string; userId: string; userName: string; milestoneName: string; projectName: string;
    projectManagerId: string | null; endDate: string; status: string;
  }[];
  opportunities: {
    id: string; name: string; ownerId: string; poNumber: string | null; poValidUntil: string | null;
    stage: string; projectManagerId: string | null;
  }[];
  milestones: { id: string; name: string; projectName: string; projectManagerId: string | null; endDate: string | null; status: string }[];
};

// ---------- date + text helpers (pure) ----------

const DAY = 86_400_000;
/** Whole days from `fromIso` to `toIso` (positive when `toIso` is later). ISO dates compared at UTC midnight. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) / DAY);
}
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);
const money = (n: number, cur: string) => `${cur} ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${Math.round(n)}%`;
function page(title: string, lines: string[]): string {
  return `<p><strong>${esc(title)}</strong></p>` + lines.map((l) => `<p>${l}</p>`).join("");
}

// ---------- rules ----------

function uniq(rs: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  return rs.filter((r) => { const k = "userId" in r ? `u:${r.userId}` : `a:${r.action}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Project budget: approved hours vs budgetHours and internal cost vs budgetAmount, each crossing the
 *  configured thresholds. One alert per (metric, threshold) — the threshold is in the payload key. */
export function projectBudgetRule(data: AlertData, cfg: AlertsConfig["rules"]["project_budget"], isSent: IsSent): Alert[] {
  if (!cfg.enabled) return [];
  const out: Alert[] = [];
  const thresholds = [...cfg.thresholds].sort((a, b) => a - b);
  for (const p of data.projects) {
    if (!p.managerId) continue;
    if (p.status === "COMPLETED" || p.status === "CANCELLED") continue;
    const metrics: { metric: "hours" | "amount"; used: number; budget: number | null; fmt: (n: number) => string }[] = [
      { metric: "hours", used: p.approvedHours, budget: p.budgetHours, fmt: (n) => `${n.toLocaleString("en-GB", { maximumFractionDigits: 1 })}h` },
      { metric: "amount", used: p.internalCost, budget: p.budgetAmount, fmt: (n) => money(n, p.currency) },
    ];
    for (const m of metrics) {
      if (!m.budget || m.budget <= 0) continue;
      const usedPct = (m.used / m.budget) * 100;
      for (const t of thresholds) {
        if (usedPct < t) continue; // just below the line ⇒ nothing yet
        const payloadKey = `${m.metric}:${t}`;
        if (isSent("project_budget", p.id, payloadKey)) continue;
        const what = m.metric === "hours" ? "budget hours" : "budget amount";
        out.push({
          kind: "project_budget", targetType: "project", targetId: p.id, payloadKey,
          subject: `${p.number} ${p.name}: ${pct(usedPct)} of ${what} used`,
          html: page(`${p.number} · ${p.name}`, [
            `${esc(m.fmt(m.used))} of ${esc(m.fmt(m.budget))} ${what} used — <strong>${pct(usedPct)}</strong> (threshold ${t}%).`,
            m.metric === "hours" ? "Approved hours only; draft and submitted time is not counted." : "Internal cost at the historical rate frozen on each approved entry.",
          ]),
          teamsText: `**${p.number} ${p.name}** — ${pct(usedPct)} of ${what} used (${m.fmt(m.used)} of ${m.fmt(m.budget)}).`,
          recipients: [{ userId: p.managerId }],
        });
      }
    }
  }
  return out;
}

/** Invoice overdue: an issued/reconciled invoice with money outstanding, N days past due, for each
 *  configured tier. ≥ semantics, so a tier missed on the exact day still fires once later. */
export function invoiceOverdueRule(data: AlertData, cfg: AlertsConfig["rules"]["invoice_overdue"], isSent: IsSent): Alert[] {
  if (!cfg.enabled) return [];
  const out: Alert[] = [];
  const tiers = [...cfg.days].sort((a, b) => a - b);
  for (const inv of data.invoices) {
    if (inv.status !== "ISSUED" && inv.status !== "RECONCILED") continue;
    if (!inv.dueDate || inv.outstanding <= 0) continue;
    const late = daysBetween(inv.dueDate, data.today);
    for (const d of tiers) {
      if (late < d) continue;
      const payloadKey = `d${d}`;
      if (isSent("invoice_overdue", inv.id, payloadKey)) continue;
      out.push({
        kind: "invoice_overdue", targetType: "invoice", targetId: inv.id, payloadKey,
        subject: `${inv.invoiceNumber} (${inv.clientName}) is ${late} day${late === 1 ? "" : "s"} overdue`,
        html: page(`${inv.invoiceNumber} · ${inv.clientName}`, [
          `Due ${esc(inv.dueDate.slice(0, 10))}, now <strong>${late} day${late === 1 ? "" : "s"}</strong> overdue.`,
          `Outstanding: <strong>${esc(money(inv.outstanding, inv.currency))}</strong>.`,
        ]),
        teamsText: `**${inv.invoiceNumber}** (${inv.clientName}) — ${late}d overdue, ${money(inv.outstanding, inv.currency)} outstanding.`,
        recipients: [{ action: "invoices:manage" }],
      });
    }
  }
  return out;
}

/** Approvals waiting: a SUBMITTED timecard or PENDING expense older than the limit. Once per item;
 *  the limit is in the key so changing it re-evaluates cleanly. Timecards go to their approver
 *  (falling back to anyone who can approve); expenses to expense managers. */
export function approvalStaleRule(data: AlertData, cfg: AlertsConfig["rules"]["approval_stale"], isSent: IsSent): Alert[] {
  if (!cfg.enabled) return [];
  const out: Alert[] = [];
  const payloadKey = `stale${cfg.staleDays}`;
  for (const tc of data.timecards) {
    if (tc.status !== "SUBMITTED" || !tc.submittedAt) continue;
    const age = daysBetween(tc.submittedAt, data.today);
    if (age < cfg.staleDays) continue;
    if (isSent("approval_stale", tc.id, payloadKey)) continue;
    out.push({
      kind: "approval_stale", targetType: "timecard", targetId: tc.id, payloadKey,
      subject: `Timecard from ${tc.userName} (week of ${tc.weekStartDate.slice(0, 10)}) waiting ${age} days`,
      html: page(`Timecard · ${tc.userName}`, [`Week of ${esc(tc.weekStartDate.slice(0, 10))}, submitted ${esc(tc.submittedAt.slice(0, 10))} — <strong>${age} days</strong> without a decision.`]),
      teamsText: `Timecard **${tc.userName}** (week ${tc.weekStartDate.slice(0, 10)}) — waiting ${age}d for approval.`,
      recipients: tc.approverId ? [{ userId: tc.approverId }] : [{ action: "timesheet:approve:any" }],
    });
  }
  for (const ex of data.expenses) {
    if (ex.status !== "PENDING") continue;
    const age = daysBetween(ex.createdAt, data.today);
    if (age < cfg.staleDays) continue;
    if (isSent("approval_stale", ex.id, payloadKey)) continue;
    out.push({
      kind: "approval_stale", targetType: "expense", targetId: ex.id, payloadKey,
      subject: `Expense from ${ex.ownerName} (${money(ex.amount, ex.currency)}) waiting ${age} days`,
      html: page(`Expense · ${ex.ownerName}`, [`${esc(money(ex.amount, ex.currency))}, logged ${esc(ex.createdAt.slice(0, 10))} — <strong>${age} days</strong> without a decision.`]),
      teamsText: `Expense **${ex.ownerName}** ${money(ex.amount, ex.currency)} — waiting ${age}d for approval.`,
      recipients: [{ action: "expenses:manage" }],
    });
  }
  return out;
}

/** Expiring soon: an active assignment ending, or a won opportunity's PO validity lapsing, within the
 *  window (today ≤ date ≤ today + days). The date is the key, so re-planning it re-fires. */
export function expiryRule(data: AlertData, cfg: AlertsConfig["rules"]["expiry"], isSent: IsSent): Alert[] {
  if (!cfg.enabled) return [];
  const out: Alert[] = [];
  for (const a of data.assignments) {
    if (a.status !== "ACTIVE") continue;
    const left = daysBetween(data.today, a.endDate);
    if (left < 0 || left > cfg.days) continue;
    const payloadKey = a.endDate.slice(0, 10);
    if (isSent("expiry", a.id, payloadKey)) continue;
    out.push({
      kind: "expiry", targetType: "assignment", targetId: a.id, payloadKey,
      subject: `${a.userName} on ${a.projectName} ends in ${left} day${left === 1 ? "" : "s"}`,
      html: page(`Assignment · ${a.userName}`, [`${esc(a.projectName)} — ${esc(a.milestoneName)} ends <strong>${esc(payloadKey)}</strong> (${left} day${left === 1 ? "" : "s"}). Extend it or plan the hand-over.`]),
      teamsText: `**${a.userName}** on ${a.projectName} / ${a.milestoneName} ends ${payloadKey} (${left}d).`,
      recipients: uniq([...(a.projectManagerId ? [{ userId: a.projectManagerId }] : []), { userId: a.userId }]),
    });
  }
  for (const o of data.opportunities) {
    if (o.stage !== "WON" || !o.poValidUntil) continue;
    const left = daysBetween(data.today, o.poValidUntil);
    if (left < 0 || left > cfg.days) continue;
    const payloadKey = o.poValidUntil.slice(0, 10);
    if (isSent("expiry", o.id, payloadKey)) continue;
    out.push({
      kind: "expiry", targetType: "opportunity", targetId: o.id, payloadKey,
      subject: `PO ${o.poNumber ?? ""} for ${o.name} expires in ${left} day${left === 1 ? "" : "s"}`.replace("PO  ", "PO "),
      html: page(`Purchase order · ${o.name}`, [`PO ${esc(o.poNumber ?? "(no number)")} is valid until <strong>${esc(payloadKey)}</strong> (${left} day${left === 1 ? "" : "s"}). Renew it before work continues past that date.`]),
      teamsText: `PO **${o.poNumber ?? o.name}** (${o.name}) expires ${payloadKey} (${left}d).`,
      recipients: uniq([...(o.projectManagerId ? [{ userId: o.projectManagerId }] : []), { userId: o.ownerId }]),
    });
  }
  return out;
}

/** Milestone overdue: end date passed, not COMPLETE/INVOICED. The end date is the key. */
export function milestoneOverdueRule(data: AlertData, cfg: AlertsConfig["rules"]["milestone_overdue"], isSent: IsSent): Alert[] {
  if (!cfg.enabled) return [];
  const out: Alert[] = [];
  for (const m of data.milestones) {
    if (!m.endDate || !m.projectManagerId) continue;
    if (m.status === "COMPLETE" || m.status === "INVOICED") continue;
    const late = daysBetween(m.endDate, data.today);
    if (late <= 0) continue; // due today is not overdue yet
    const payloadKey = m.endDate.slice(0, 10);
    if (isSent("milestone_overdue", m.id, payloadKey)) continue;
    out.push({
      kind: "milestone_overdue", targetType: "milestone", targetId: m.id, payloadKey,
      subject: `${m.projectName} — ${m.name} is ${late} day${late === 1 ? "" : "s"} past its end date`,
      html: page(`${m.projectName} · ${m.name}`, [`Planned end <strong>${esc(payloadKey)}</strong>, still <em>${esc(m.status.toLowerCase())}</em> ${late} day${late === 1 ? "" : "s"} later. Complete it, or move the date.`]),
      teamsText: `**${m.projectName} / ${m.name}** — ${late}d past end date, status ${m.status}.`,
      recipients: [{ userId: m.projectManagerId }],
    });
  }
  return out;
}

export const RULES: { kind: AlertKind; run: (data: AlertData, cfg: AlertsConfig, isSent: IsSent) => Alert[] }[] = [
  { kind: "project_budget", run: (d, c, s) => projectBudgetRule(d, c.rules.project_budget, s) },
  { kind: "invoice_overdue", run: (d, c, s) => invoiceOverdueRule(d, c.rules.invoice_overdue, s) },
  { kind: "approval_stale", run: (d, c, s) => approvalStaleRule(d, c.rules.approval_stale, s) },
  { kind: "expiry", run: (d, c, s) => expiryRule(d, c.rules.expiry, s) },
  { kind: "milestone_overdue", run: (d, c, s) => milestoneOverdueRule(d, c.rules.milestone_overdue, s) },
];

/** Every alert that should go out today, across all enabled rules. */
export function evaluateAll(data: AlertData, cfg: AlertsConfig, isSent: IsSent): Alert[] {
  if (!cfg.enabled) return [];
  return RULES.flatMap((r) => r.run(data, cfg, isSent));
}
