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
export type RecipientAction = "invoices:manage" | "expenses:manage" | "timesheet:approve:any" | "users:manage";
import { statusChase, overduePlanTasks, overdueRaidItems, isHighSeverity, goLiveReadiness, isoWeek, isoWeekday } from "@/lib/delivery-signals";
export type Recipient = { userId: string } | { action: RecipientAction };

export type Alert = {
  kind: AlertKind;
  targetType: "project" | "invoice" | "timecard" | "expense" | "assignment" | "opportunity" | "milestone" | "certification" | "workspace" | "plantask" | "raid" | "user";
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
  certifications: { id: string; userId: string; userName: string; name: string; issuer: string | null; expiryDate: string | null }[];
  /** Delivery signals, pre-shaped by the runner; the predicates below and My Day share the same pure rules. */
  delivery: {
    baseUrl: string;
    workspaces: {
      key: string; projectId: string; projectName: string; engagementId: string | null; engagementName: string | null;
      managerId: string | null; active: boolean; done: boolean; customerFacing: boolean;
      lastReportDateIso: string | null; cadence: string | null; sinceIso: string | null;
    }[];
    planTasks: {
      id: string; name: string; projectId: string; projectName: string; engagementId: string | null; engagementName: string | null;
      managerId: string | null; ownerUserId: string | null; status: string; progress: number; isMilestone: boolean; dueDate: string | null;
    }[];
    raidItems: {
      id: string; title: string; projectId: string; projectName: string; engagementId: string | null; engagementName: string | null;
      managerId: string | null; ownerUserId: string | null; status: string; severity: string | null; dueDate: string | null;
    }[];
    projects: {
      id: string; name: string; managerId: string | null; active: boolean; done: boolean; uatStatus: string; uatAccepted: boolean;
      endDateIso: string | null; scripts: { status: string }[]; cutoverLeaves: { status: string }[];
    }[];
  };
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

/** Certification expiry: at each tier (e.g. 90 and 30 days before). The expiry date is part of the
 *  key, so renewing the certificate (a new date) starts the tiers over. Nothing fires once expired —
 *  by then it is a profile fact, not an alert. */
export function certificationExpiryRule(data: AlertData, cfg: AlertsConfig["rules"]["certification_expiry"], isSent: IsSent): Alert[] {
  if (!cfg.enabled) return [];
  const out: Alert[] = [];
  const tiers = [...cfg.days].sort((a, b) => b - a);
  for (const c of data.certifications) {
    if (!c.expiryDate) continue;
    const left = daysBetween(data.today, c.expiryDate);
    if (left < 0) continue;
    const date = c.expiryDate.slice(0, 10);
    for (const d of tiers) {
      if (left > d) continue;
      const payloadKey = `${date}:d${d}`;
      if (isSent("certification_expiry", c.id, payloadKey)) continue;
      out.push({
        kind: "certification_expiry", targetType: "certification", targetId: c.id, payloadKey,
        subject: `${c.userName}'s ${c.name} certification expires in ${left} day${left === 1 ? "" : "s"}`,
        html: page(`Certification · ${c.userName}`, [
          `<strong>${esc(c.name)}</strong>${c.issuer ? ` (${esc(c.issuer)})` : ""} expires on <strong>${esc(date)}</strong> — ${left} day${left === 1 ? "" : "s"} from now.`,
          `Plan the renewal and update the expiry date on the profile once done.`,
        ]),
        teamsText: `**${c.userName}** — ${c.name} expires ${date} (${left}d).`,
        recipients: uniq([{ userId: c.userId }, { action: "users:manage" }]),
      });
    }
  }
  return out;
}


// ---------- delivery rules (predicates shared with My Day via delivery-signals.ts) ----------

const wsLink = (base: string, projectId: string, engagementId: string | null, tab?: string) => {
  const p = new URLSearchParams();
  if (engagementId) p.set("eng", engagementId);
  if (tab) p.set("tab", tab);
  const q = p.toString();
  return `${base}/delivery/${projectId}${q ? `?${q}` : ""}`;
};
const scopeName = (w: { projectName: string; engagementName: string | null }) => (w.engagementName ? `${w.projectName} · ${w.engagementName}` : w.projectName);

/** Status update past its cadence: tier 1 at one cadence, tier 2 at two. A workspace that never
 *  reported is due at once (tier from the project's start). The key carries the last report date, so
 *  the next report resets the tiers. */
export function statusOverdueRule(data: AlertData, cfg: AlertsConfig["rules"]["status_overdue"], isSent: IsSent): Alert[] {
  if (!cfg.enabled) return [];
  const out: Alert[] = [];
  for (const w of data.delivery.workspaces) {
    if (!w.managerId) continue;
    const sc = statusChase({ lastReportDateIso: w.lastReportDateIso, cadence: w.cadence, sinceIso: w.sinceIso, todayIso: data.today, customerFacing: w.customerFacing, active: w.active, done: w.done });
    if (!sc.due) continue;
    const ref = w.lastReportDateIso ?? "first";
    for (const tier of [1, 2] as const) {
      if (sc.tier < tier) continue;
      const payloadKey = `${ref}:x${tier}`;
      if (isSent("status_overdue", w.key, payloadKey)) continue;
      const since = sc.neverReported ? "never sent one" : `last sent ${w.lastReportDateIso} (${sc.daysSince} day${sc.daysSince === 1 ? "" : "s"} ago)`;
      out.push({
        kind: "status_overdue", targetType: "workspace", targetId: w.key, payloadKey,
        subject: `${tier === 2 ? "Still no" : "Status update due"} — ${scopeName(w)}${tier === 2 ? " (two cadences late)" : ""}`.replace("Still no —", "Still no status update —"),
        html: page(`Status update · ${esc(scopeName(w))}`, [
          `${esc(scopeName(w))} is ${tier === 2 ? "<strong>two cadences</strong>" : "a cadence"} past due for a status update — ${esc(since)}.`,
          `<a href="${esc(wsLink(data.delivery.baseUrl, w.projectId, w.engagementId, "status"))}">Open the workspace</a> — "New status update" starts from the last one.`,
        ]),
        teamsText: `**${scopeName(w)}** — status update ${tier === 2 ? "two cadences" : "a cadence"} overdue (${since}).`,
        recipients: [{ userId: w.managerId }],
      });
    }
  }
  return out;
}

/** Open plan tasks past due: once per task per due date (re-planning re-arms). */
export function planSlippingRule(data: AlertData, cfg: AlertsConfig["rules"]["plan_slipping"], isSent: IsSent): Alert[] {
  if (!cfg.enabled) return [];
  const out: Alert[] = [];
  for (const t of overduePlanTasks(data.delivery.planTasks, data.today)) {
    if (!t.dueDate) continue;
    const payloadKey = t.dueDate;
    if (isSent("plan_slipping", t.id, payloadKey)) continue;
    const late = daysBetween(t.dueDate, data.today);
    const recipients = uniq([...(t.managerId ? [{ userId: t.managerId }] : []), ...(t.ownerUserId ? [{ userId: t.ownerUserId }] : [])]);
    if (recipients.length === 0) continue;
    out.push({
      kind: "plan_slipping", targetType: "plantask", targetId: t.id, payloadKey,
      subject: `Plan task overdue: ${t.name} (${scopeName(t)})`,
      html: page(`Plan · ${esc(scopeName(t))}`, [`<strong>${esc(t.name)}</strong> was due ${esc(t.dueDate)} — ${late} day${late === 1 ? "" : "s"} ago — and is still open.`, `<a href="${esc(wsLink(data.delivery.baseUrl, t.projectId, t.engagementId, "plan"))}">Open the plan</a> to re-plan it or mark it done.`]),
      teamsText: `**${t.name}** (${scopeName(t)}) — due ${t.dueDate}, ${late}d late.`,
      recipients,
    });
  }
  return out;
}

/** Open RAID items past their target date; high/critical escalate to admins as well. */
export function issueOverdueRule(data: AlertData, cfg: AlertsConfig["rules"]["issue_overdue"], isSent: IsSent): Alert[] {
  if (!cfg.enabled) return [];
  const out: Alert[] = [];
  for (const r of overdueRaidItems(data.delivery.raidItems, data.today)) {
    if (!r.dueDate) continue;
    const payloadKey = r.dueDate;
    if (isSent("issue_overdue", r.id, payloadKey)) continue;
    const high = isHighSeverity(r.severity);
    const late = daysBetween(r.dueDate, data.today);
    const recipients = uniq([
      ...(r.managerId ? [{ userId: r.managerId }] : []),
      ...(r.ownerUserId ? [{ userId: r.ownerUserId }] : []),
      ...(high ? [{ action: "users:manage" as const }] : []),
    ]);
    if (recipients.length === 0) continue;
    out.push({
      kind: "issue_overdue", targetType: "raid", targetId: r.id, payloadKey,
      subject: `${high ? "HIGH — " : ""}Issue past due: ${r.title} (${scopeName(r)})`,
      html: page(`Issue · ${esc(scopeName(r))}`, [`<strong>${esc(r.title)}</strong>${r.severity ? ` (${esc(r.severity.toLowerCase())})` : ""} was due ${esc(r.dueDate)} — ${late} day${late === 1 ? "" : "s"} ago — and is still ${esc(r.status.toLowerCase().replace("_", " "))}.`, `<a href="${esc(wsLink(data.delivery.baseUrl, r.projectId, r.engagementId, "raid"))}">Open the issues log</a>.`]),
      teamsText: `${high ? "🔴 " : ""}**${r.title}** (${scopeName(r)}) — due ${r.dueDate}, ${late}d late.`,
      recipients,
    });
  }
  return out;
}

/** UAT script not sent inside the UAT window; cutover not finished near go-live. Keys: the UAT phase
 *  (a new phase re-fires) and the go-live date (a moved date re-fires). */
export function goLiveReadinessRule(data: AlertData, cfg: AlertsConfig["rules"]["golive_readiness"], isSent: IsSent): Alert[] {
  if (!cfg.enabled) return [];
  const out: Alert[] = [];
  for (const p of data.delivery.projects) {
    if (!p.managerId) continue;
    const g = goLiveReadiness({ active: p.active, done: p.done, uatStatus: p.uatStatus, uatAccepted: p.uatAccepted, endDateIso: p.endDateIso, todayIso: data.today, scripts: p.scripts, cutoverLeaves: p.cutoverLeaves });
    if (g.uatScriptDue) {
      const payloadKey = `uat:${p.uatStatus}`;
      if (!isSent("golive_readiness", p.id, payloadKey)) out.push({
        kind: "golive_readiness", targetType: "project", targetId: p.id, payloadKey,
        subject: `UAT test script not sent — ${p.name}`,
        html: page(`Go-live readiness · ${esc(p.name)}`, [`UAT is ${p.uatStatus === "NOT_STARTED" ? "coming up" : "under way"} but no customer test script is marked <strong>Sent</strong>${p.scripts.length ? ` (${p.scripts.length} script${p.scripts.length === 1 ? "" : "s"} in progress)` : " (none prepared)"}.`, `<a href="${esc(data.delivery.baseUrl)}/delivery/${esc(p.id)}/uat">Open the UAT scripts</a>.`]),
        teamsText: `**${p.name}** — UAT test script not sent.`,
        recipients: [{ userId: p.managerId }],
      });
    }
    if (g.cutoverDue) {
      const payloadKey = `cutover:${p.endDateIso ?? "none"}`;
      if (!isSent("golive_readiness", p.id, payloadKey)) out.push({
        kind: "golive_readiness", targetType: "project", targetId: p.id, payloadKey,
        subject: `Cutover not finished — ${p.name}${g.daysToGoLive != null ? ` (go-live in ${g.daysToGoLive} day${g.daysToGoLive === 1 ? "" : "s"})` : ""}`,
        html: page(`Go-live readiness · ${esc(p.name)}`, [`${g.cutoverTotal ? `${g.cutoverDone}/${g.cutoverTotal} cutover steps done` : "No cutover plan yet"}${p.uatAccepted ? " — UAT is accepted" : ""}${g.daysToGoLive != null ? `, go-live ${p.endDateIso} (${g.daysToGoLive} day${g.daysToGoLive === 1 ? "" : "s"})` : ""}.`, `<a href="${esc(data.delivery.baseUrl)}/delivery/${esc(p.id)}/cutover">Open the cutover plans</a>.`]),
        teamsText: `**${p.name}** — cutover ${g.cutoverTotal ? `${g.cutoverDone}/${g.cutoverTotal}` : "not started"}${g.daysToGoLive != null ? `, go-live in ${g.daysToGoLive}d` : ""}.`,
        recipients: [{ userId: p.managerId }],
      });
    }
  }
  return out;
}

/** Monday digest: one email per PM with everything on their projects that needs a hand this week.
 *  Keyed by ISO week, so a re-run on the same Monday (or a Tuesday catch-up) never sends twice. */
export function deliveryDigestRule(data: AlertData, cfg: AlertsConfig["rules"]["delivery_digest"], isSent: IsSent): Alert[] {
  if (!cfg.enabled) return [];
  if (isoWeekday(data.today) !== cfg.weekday) return [];
  const week = isoWeek(data.today);
  const base = data.delivery.baseUrl;
  type Bucket = { status: string[]; tasks: string[]; issues: string[]; golive: string[] };
  const byPm = new Map<string, Bucket>();
  const bucket = (pm: string | null) => { if (!pm) return null; let b = byPm.get(pm); if (!b) { b = { status: [], tasks: [], issues: [], golive: [] }; byPm.set(pm, b); } return b; };

  for (const w of data.delivery.workspaces) {
    const sc = statusChase({ lastReportDateIso: w.lastReportDateIso, cadence: w.cadence, sinceIso: w.sinceIso, todayIso: data.today, customerFacing: w.customerFacing, active: w.active, done: w.done });
    if (sc.due) bucket(w.managerId)?.status.push(`<a href="${esc(wsLink(base, w.projectId, w.engagementId, "status"))}">${esc(scopeName(w))}</a> — ${sc.neverReported ? "never sent" : `last ${esc(w.lastReportDateIso ?? "")}`}`);
  }
  for (const t of overduePlanTasks(data.delivery.planTasks, data.today)) bucket(t.managerId)?.tasks.push(`<a href="${esc(wsLink(base, t.projectId, t.engagementId, "plan"))}">${esc(t.name)}</a> — ${esc(scopeName(t))}, due ${esc(t.dueDate ?? "")}`);
  for (const r of overdueRaidItems(data.delivery.raidItems, data.today)) bucket(r.managerId)?.issues.push(`<a href="${esc(wsLink(base, r.projectId, r.engagementId, "raid"))}">${esc(r.title)}</a> — ${esc(scopeName(r))}, due ${esc(r.dueDate ?? "")}${isHighSeverity(r.severity) ? " <strong>(high)</strong>" : ""}`);
  for (const p of data.delivery.projects) {
    const g = goLiveReadiness({ active: p.active, done: p.done, uatStatus: p.uatStatus, uatAccepted: p.uatAccepted, endDateIso: p.endDateIso, todayIso: data.today, scripts: p.scripts, cutoverLeaves: p.cutoverLeaves });
    const items: string[] = [];
    if (g.daysToGoLive != null && g.daysToGoLive >= 0 && g.daysToGoLive <= 14 && !p.done) items.push(`go-live in ${g.daysToGoLive} day${g.daysToGoLive === 1 ? "" : "s"} (${esc(p.endDateIso ?? "")})`);
    if (g.uatScriptDue) items.push(`<a href="${esc(base)}/delivery/${esc(p.id)}/uat">UAT script not sent</a>`);
    if (g.cutoverDue) items.push(`<a href="${esc(base)}/delivery/${esc(p.id)}/cutover">cutover ${g.cutoverTotal ? `${g.cutoverDone}/${g.cutoverTotal}` : "not started"}</a>`);
    if (items.length) bucket(p.managerId)?.golive.push(`<a href="${esc(base)}/delivery/${esc(p.id)}">${esc(p.name)}</a> — ${items.join(", ")}`);
  }

  const out: Alert[] = [];
  for (const [pm, b] of byPm) {
    const total = b.status.length + b.tasks.length + b.issues.length + b.golive.length;
    if (total === 0) continue;
    if (isSent("delivery_digest", pm, week)) continue;
    const section = (title: string, rows: string[]) => (rows.length ? `<h3 style="margin:16px 0 4px;font-size:13px">${title} (${rows.length})</h3><ul style="margin:0;padding-left:18px">${rows.map((r) => `<li>${r}</li>`).join("")}</ul>` : "");
    out.push({
      kind: "delivery_digest", targetType: "user", targetId: pm, payloadKey: week,
      subject: `Your delivery week ${week}: ${total} thing${total === 1 ? "" : "s"} need${total === 1 ? "s" : ""} a hand`,
      html: page(`Monday digest · ${week}`, [
        `Across your projects: ${b.status.length} status update${b.status.length === 1 ? "" : "s"} due, ${b.tasks.length} overdue task${b.tasks.length === 1 ? "" : "s"}, ${b.issues.length} issue${b.issues.length === 1 ? "" : "s"} past due, ${b.golive.length} go-live item${b.golive.length === 1 ? "" : "s"}.`,
        section("Status updates due", b.status) + section("Overdue plan tasks", b.tasks) + section("Issues past due", b.issues) + section("Go-live in the next 14 days", b.golive),
        `<a href="${esc(base)}/delivery">Open My Day</a> · <a href="${esc(base)}/actions?mine=1">My actions</a>`,
      ]),
      teamsText: `Weekly digest ${week}: ${total} item${total === 1 ? "" : "s"} across your projects.`,
      recipients: [{ userId: pm }],
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
  { kind: "certification_expiry", run: (d, c, s) => certificationExpiryRule(d, c.rules.certification_expiry, s) },
  { kind: "status_overdue", run: (d, c, s) => statusOverdueRule(d, c.rules.status_overdue, s) },
  { kind: "plan_slipping", run: (d, c, s) => planSlippingRule(d, c.rules.plan_slipping, s) },
  { kind: "issue_overdue", run: (d, c, s) => issueOverdueRule(d, c.rules.issue_overdue, s) },
  { kind: "golive_readiness", run: (d, c, s) => goLiveReadinessRule(d, c.rules.golive_readiness, s) },
  { kind: "delivery_digest", run: (d, c, s) => deliveryDigestRule(d, c.rules.delivery_digest, s) },
];

/** Every alert that should go out today, across all enabled rules. */
export function evaluateAll(data: AlertData, cfg: AlertsConfig, isSent: IsSent): Alert[] {
  if (!cfg.enabled) return [];
  return RULES.flatMap((r) => r.run(data, cfg, isSent));
}
