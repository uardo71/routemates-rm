// In-app documentation content for the Help page. Pure data (client-safe) so it can be searched and
// rendered without any server dependency. Keep it accurate to how the app actually behaves.

export type HelpBlock =
  | { t: "p"; text: string }
  | { t: "list"; items: string[] }
  | { t: "steps"; items: string[] }
  | { t: "formula"; name: string; expr: string; note?: string }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "callout"; tone?: "info" | "warn"; text: string };

export type HelpSection = { id: string; group: string; title: string; blocks: HelpBlock[] };

export const HELP_GROUPS = [
  "Basics",
  "Money & rates",
  "Sales",
  "Delivery",
  "Time & planning",
  "Finance",
  "Reports",
  "Delivery cockpit",
  "Go-live",
  "Admin",
] as const;

export const HELP: HelpSection[] = [
  // ---------------- Basics ----------------
  {
    id: "what-is",
    group: "Basics",
    title: "What RM Ops is",
    blocks: [
      { t: "p", text: "RM Ops is Routemates' internal PSA (Professional Services Automation) system — it runs the whole services lifecycle in one place, replacing separate CRM, project, timesheet and invoicing tools." },
      { t: "p", text: "The flow it supports end to end: sell work (opportunities) → deliver it (projects, milestones, assignments, time) → govern delivery (status reports, plan, RAID, minutes, cutover, UAT) → recognise revenue and bill it (invoicing register) → report on the business (revenue, budgets, command center)." },
      { t: "list", items: [
        "Payroll is deliberately cost-tracking only (it feeds margin/budget maths) — no payslips or tax filing; that stays with the external payroll provider.",
        "Money can be shown in the company reporting currency (from Company settings); cost rates are always in EUR (salary-derived).",
        "Dates are stored at UTC midnight and read with UTC accessors, so a date means the same day for everyone.",
      ] },
    ],
  },
  {
    id: "roles",
    group: "Basics",
    title: "Roles & what you can see",
    blocks: [
      { t: "p", text: "Your system role decides which pages and figures you can access. Roles are set by an admin on the user's profile." },
      { t: "table", head: ["Role", "What they get"], rows: [
        ["Admin", "Everything — all projects, finance, reports, users, settings."],
        ["Finance", "Clients, projects (view), rates, invoicing, salaries, expenses, opportunities (view), reports."],
        ["Sales", "Clients and opportunities (create/manage). No delivery or finance."],
        ["PM (Project Manager)", "Projects they manage, planning, the full delivery cockpit, opportunities. Company-wide for time proxying and planning; only their own managed projects for the cockpit."],
        ["Employee / Contractor", "Their own Time, My planning, Vacations, Expenses — plus the Cutover plans and UAT scripts of projects they're assigned to, and the Help page."],
      ] },
      { t: "callout", tone: "info", text: "Delivery working docs (cutover plan, UAT test scripts) are accessible to any consultant assigned to that project, not just the PM — because the consultant runs them. The PM governs." },
    ],
  },

  // ---------------- Money & rates ----------------
  {
    id: "billing-types",
    group: "Money & rates",
    title: "Billing types",
    blocks: [
      { t: "p", text: "Every project has one billing type (set from the opportunity or on the project). It is the single source of truth for how revenue is recognised." },
      { t: "table", head: ["Type", "How the milestone rate is read", "How revenue works"], rows: [
        ["Time & Materials (T&M)", "Milestone sales price = hourly rate", "Earned = approved hours × rate. Forecast = planned hours × rate."],
        ["Fixed price", "Milestone sales price = lump sum for that milestone", "Earned = % completion (or full value on completion), capped to the contract value. Forecast = contract value."],
        ["Retainer", "Milestone sales price = hourly rate", "Same rate-driven maths as T&M."],
      ] },
      { t: "callout", tone: "info", text: "A milestone can be marked non-billable (internal work) — it never generates revenue but still tracks hours and cost." },
    ],
  },
  {
    id: "rates-cost",
    group: "Money & rates",
    title: "Rates & cost",
    blocks: [
      { t: "p", text: "Two different rates drive the numbers: the sales rate (what you charge) and the cost rate (what a person costs you)." },
      { t: "formula", name: "Hourly cost rate (EUR)", expr: "monthly salary ÷ that month's working hours", note: "So a salaried person's hourly cost varies month to month — that's intentional, not a bug. Salary and FX come from the person's employment record and the exchange-rates table." },
      { t: "p", text: "Cost is applied two ways, deliberately:" },
      { t: "list", items: [
        "Historical cost (for actuals) — each approved time entry is stamped with the cost rate effective on the day it was worked. Reports use this frozen rate, so past cost never drifts when salaries change.",
        "Current cost (for forecasts) — planned hours are costed at the person's live employment rate, because the forecast is forward-looking.",
      ] },
      { t: "callout", tone: "info", text: "Cost rate is Admin/Finance-only. PMs and others never see it, in displays or forms; the server ignores a cost rate submitted by someone without permission." },
    ],
  },
  {
    id: "discounts",
    group: "Money & rates",
    title: "Discounts & contract value",
    blocks: [
      { t: "p", text: "A deal-level discount lives on the project (from the won opportunity), not on the milestones. Milestones keep their LIST rates; the discount is applied once at the top." },
      { t: "formula", name: "Contract value", expr: "list total − deal discount" },
      { t: "p", text: "For fixed-price revenue, the contract value is distributed across milestones by each milestone's share of the list total — so a fully-delivered project earns exactly the contract value, never the pre-discount list total." },
      { t: "formula", name: "Fixed-price effective rate (shown per milestone)", expr: "milestone lump sum ÷ budget hours" },
    ],
  },

  // ---------------- Sales ----------------
  {
    id: "opportunities",
    group: "Sales",
    title: "Opportunities (CRM)",
    blocks: [
      { t: "p", text: "The sales pipeline. Managed by Sales, PM and Admin; approved by Admin; viewed by Finance." },
      { t: "p", text: "Stages: Qualifying → Proposal sent → Negotiation → Pending approval → Won / Lost / Cancelled." },
      { t: "formula", name: "Quote total", expr: "gross = Σ(hours × list unit price);  net = gross − discount" },
      { t: "list", items: [
        "Each quote line carries quantity (hours) × unit price and becomes a Milestone when the deal is won.",
        "Winning an opportunity auto-creates the project (milestones from the lines, contract value, SoW/PO carried over).",
        "Each issued proposal is snapshotted as an immutable revision — the negotiation/discount audit trail.",
        "Amendments (change orders) on a won deal add hours after close: they append a new milestone (or grow one) and bump the project's contract value / budget.",
      ] },
    ],
  },

  // ---------------- Delivery ----------------
  {
    id: "projects",
    group: "Delivery",
    title: "Projects, milestones & assignments",
    blocks: [
      { t: "p", text: "The delivery hierarchy is Project → Milestone → Assignment (a person) and Task." },
      { t: "list", items: [
        "Milestone: sales price (rate or lump sum by billing type), optional budget hours (a cap), a budgeted cost, a billable flag, and a status PLANNED → ACTIVE → COMPLETE → INVOICED. A separate 'time entry open' toggle gates logging independent of status.",
        "Assignment: a person on a milestone, with a required start/end date, an optional allocated-hours cap, and a cost rate snapshotted at creation (from salary).",
        "Completing a milestone can lock time entry and, for fixed price, recognises its full value even with zero logged hours.",
        "Value adjustments record money removed/absorbed on a milestone (e.g. moved to another PO), with an audit trail; the effective value flows into revenue.",
      ] },
    ],
  },

  // ---------------- Time & planning ----------------
  {
    id: "time",
    group: "Time & planning",
    title: "Time tracking",
    blocks: [
      { t: "p", text: "Time is logged on a weekly grid, one time card per assignment. A card holds daily entries (optionally split across tasks) and moves through DRAFT → SUBMITTED → APPROVED / REJECTED." },
      { t: "callout", tone: "info", text: "Draft hours are not actual. Only APPROVED hours count towards 'logged' / budget-progress displays and T&M invoicing. (Saving still validates against the allocation cap using all non-zero entries, to prevent over-allocation before decisions land.)" },
      { t: "p", text: "Auto-approval is deliberately narrow:" },
      { t: "list", items: [
        "When the literal project manager submits time on someone else's behalf, it auto-approves.",
        "A negative-only correction always auto-approves (it's an undo of already-approved hours) — but it can never undo more than is actually approved on that line.",
        "Admin proxy-submission and self-submission never auto-approve — they land in the normal queue.",
      ] },
      { t: "p", text: "A single card can't mix positive and negative hours. 'Submitted by' (who clicked Submit) is tracked separately from 'whose time it is' — a PM/Admin can proxy for someone." },
    ],
  },
  {
    id: "approvals",
    group: "Time & planning",
    title: "Approvals",
    blocks: [
      { t: "p", text: "PMs and Admins review submitted time cards line by line. Each card is pre-assigned to a responsible approver (the project's manager) at submit time." },
      { t: "list", items: [
        "Bulk select + Approve/Reject; click a row for a read-only detail of that week.",
        "Deciding stamps the approver to whoever actually clicked, and stamps each approved entry with its historical cost rate.",
      ] },
    ],
  },
  {
    id: "planning",
    group: "Time & planning",
    title: "Resource planning",
    blocks: [
      { t: "p", text: "The Resource Planner is an editable weekly grid (not a Gantt). Hours typed into cells are planned/scheduled hours, stored separately from actual time — they drive the forecast." },
      { t: "list", items: [
        "Capacity colour on a person's week: yellow < 40h, green = 40h, red > 40h.",
        "Planned hours can't exceed an assignment's allocated hours, and can't fall outside the assignment's own start/end window.",
        "You can drag an assignment's end date on the grid (bounded by the project end and the latest approved time).",
      ] },
      { t: "p", text: "Everyone can see their own schedule read-only under My planning." },
    ],
  },
  {
    id: "sva",
    group: "Time & planning",
    title: "Scheduled vs actuals",
    blocks: [
      { t: "p", text: "A planner-style grid comparing planned hours against actual submitted time, per person per week. Severity-ranked colouring:" },
      { t: "table", head: ["Cell", "Meaning"], rows: [
        ["Rose (worst)", "Planned = 0 — no planning at all, always flagged"],
        ["Red", "Planned, but nothing submitted"],
        ["Amber", "Actual < planned (partial)"],
        ["Emerald", "Actual ≥ planned"],
      ] },
    ],
  },
  {
    id: "leave",
    group: "Time & planning",
    title: "Leave & vacations",
    blocks: [
      { t: "p", text: "Leave types: Vacation (20 days/yr, uncapped carryover, prorated first year), Sick (tracked only), Paternity/Maternity (one-off, admin picks the dates)." },
      { t: "list", items: [
        "Admin approves; approval auto-provisions the days into Planning and Time (so capacity reflects the absence). PMs get read-only company-wide visibility; employees self-serve.",
        "Admins can set an opening balance (carried-in days as of Jan 1 of a year); blank = auto from hire date.",
        "A 'record return' handles early/partial return-to-work, giving vacation days back and un-provisioning the returned working days.",
        "Albanian public holidays are shown as informational (never blocking) in the planner, time entry and requests.",
      ] },
    ],
  },

  // ---------------- Finance ----------------
  {
    id: "invoicing",
    group: "Finance",
    title: "Invoicing register",
    blocks: [
      { t: "p", text: "The invoicing module is a register + reconciliation ledger against your external fiscal app — not a document generator. Nothing auto-creates an invoice; you stay in full control." },
      { t: "p", text: "Lifecycle: Draft → Issued → Reconciled → Paid (plus Void). Type: Invoice or Credit note. A self-billed flag records German-style Gutschrift for revenue recognition." },
      { t: "formula", name: "Invoice totals", expr: "net = Σ line amounts;  VAT = net × vatRate;  gross = net + VAT;  outstanding = gross − Σ payments" },
      { t: "list", items: [
        "Create from approved time (T&M), a manual/partial amount, a full-contract prefill, a milestone prefill, or a credit note linked to the original.",
        "Reconciliation captures the fiscal number/reference; a 'needs reconciliation' worklist shows issued invoices without one.",
        "Partial payments are supported (outstanding = gross − Σ payments).",
      ] },
      { t: "callout", tone: "info", text: "Sales commission is a single negative line whose description is exactly 'Sales comision'. It's discount = base × percent/100 + fixed, where base is the net of the non-commission lines. It flows through every total as a normal line and can be set in any status." },
    ],
  },
  {
    id: "expenses",
    group: "Finance",
    title: "Expenses",
    blocks: [
      { t: "p", text: "Any employee can log a company-card expense or a personal reimbursement claim, with receipts. Auto-approval depends only on whether the submitter has expense-manage permission (Admin/Finance)." },
      { t: "list", items: [
        "Paid-by is Company or Employee; categories are admin-managed (inline on the Expenses page).",
        "A capture flow (mobile /capture) photographs a receipt and drafts an expense (with optional OCR).",
        "CSV export for the accountant. Draft (captured, unconfirmed) expenses are excluded from the list and export.",
      ] },
    ],
  },
  {
    id: "taxes",
    group: "Finance",
    title: "Taxes",
    blocks: [
      { t: "p", text: "Admin-only tracking of tax obligations and payments (municipality tax, advance sales tax, rent tax, social/health contributions…)." },
      { t: "list", items: [
        "Managed tax categories; a To-pay → Paid workflow capturing period, amount, serial/reference, authority, due/payment dates.",
        "Attach the tax notice and the payment receipt. KPIs: outstanding, overdue, paid YTD/this month.",
      ] },
    ],
  },
  {
    id: "vendors",
    group: "Finance",
    title: "Vendor payments",
    blocks: [
      { t: "p", text: "Admin-only accounts-payable: a managed vendor list plus bills, To-pay → Paid, with an optional project link for subcontractor bills. Attach the vendor invoice and payment receipt." },
    ],
  },

  // ---------------- Reports ----------------
  {
    id: "revenue",
    group: "Reports",
    title: "Revenue & forecast",
    blocks: [
      { t: "p", text: "The revenue report (Admin/Finance) is the single source of truth for the money maths — the Command Center reuses the exact same engine, so figures always reconcile." },
      { t: "formula", name: "Forecast revenue", expr: "T&M/Retainer: Σ planned hours × rate   ·   Fixed price: contract value", note: "Time-phased across the next 12 months from the delivery plan." },
      { t: "formula", name: "Earned revenue (accrued)", expr: "T&M/Retainer: Σ approved hours × rate   ·   Fixed price: completed milestones earn full value, in-progress earn min(1, approved ÷ budget) × value — all scaled so the total can't exceed the contract value" },
      { t: "formula", name: "Recognized revenue", expr: "net of Issued / Reconciled / Paid invoices in the register (credit notes subtract)" },
      { t: "formula", name: "Cost", expr: "Σ approved hours × historical cost rate (EUR)" },
      { t: "formula", name: "Margin", expr: "earned − cost      (Margin % = margin ÷ earned)" },
      { t: "formula", name: "Operating margin", expr: "gross margin − internal/overhead cost" },
      { t: "formula", name: "Forecast margin", expr: "forecast revenue − forecast cost   (forecast cost = Σ planned hours × current cost rate)" },
      { t: "callout", tone: "info", text: "Internal / non-billable projects are treated as overhead — pure cost, no revenue, no per-project margin. Their cost rolls into company operating margin. The period filter at the top drives the expected-revenue KPI, the chart and the table's period column." },
    ],
  },
  {
    id: "budgets",
    group: "Reports",
    title: "Budgets",
    blocks: [
      { t: "p", text: "Per-milestone budget tracking. Budgeted cost derives from allocated hours × current cost rate when no cost is entered manually (a manual figure always wins). Cost 'remaining' shows '—' rather than a misleading negative when there's no cost budget." },
    ],
  },
  {
    id: "command-center",
    group: "Reports",
    title: "Command Center",
    blocks: [
      { t: "p", text: "The owner's one-screen view (Admin/Finance). Every KPI opens a drill-down popup showing exactly what the number is made of — click a tile to see the per-project breakdown and the formula." },
      { t: "list", items: [
        "Financial position: Earned, Gross margin (with the earned − cost − overhead formula), Cash outstanding, Pipeline, Invoiced, Cost, Overhead, Active work.",
        "Delivery health: a segmented RAG bar across the portfolio, plus the quarterly forecast.",
        "Needs your attention: money-and-risk items — work delivered but not invoiced, milestones done but unbilled, overdue/unreconciled invoices, over-budget hours, low-margin projects.",
        "Portfolio: a switchable Finance ↔ Delivery board over the same client/project list.",
      ] },
      { t: "formula", name: "Still to bill (unbilled work)", expr: "T&M/Retainer: Σ approved hours NOT linked to an invoice × rate   ·   Fixed price: max(0, earned − work already billed)", note: "The T&M number is invoice-linkage accurate — it uses which specific time entries are on an invoice, so the drill-down reconciles down to the individual time cards. The commission line is excluded from 'billed work'." },
    ],
  },

  // ---------------- Delivery cockpit ----------------
  {
    id: "cockpit",
    group: "Delivery cockpit",
    title: "Delivery cockpit overview",
    blocks: [
      { t: "p", text: "A PM governance workspace (PM + Admin), separate from the finance module. It opens on 'My Day' — a guided path across the PM's projects — and each project has its own cockpit with tabs: Overview · Status updates · Plan · Minutes · Documents (plus the RAID/attention nudges)." },
      { t: "p", text: "RAG health (Green on track / Amber at risk / Red off track) comes from the latest status report per scope, escalated to Red by an overdue high/critical issue." },
    ],
  },
  {
    id: "status-updates",
    group: "Delivery cockpit",
    title: "Status updates",
    blocks: [
      { t: "p", text: "Weekly customer status reports, aligned to the real customer deck: Progress %, Severity/Timing (Low/On time · Medium/Delay · High/Business impact), current status, structured next actions (owner + due + critical) and corrective actions." },
      { t: "list", items: [
        "Every active customer should get one on a predictable cadence; base it on the week's approved hours (it's your invoice-defence record).",
        "Exports to a branded PowerPoint (title → agenda → status → plan → Q&A) and to Excel. History is kept; you mark a report sent.",
      ] },
    ],
  },
  {
    id: "plan",
    group: "Delivery cockpit",
    title: "Project plan (Gantt)",
    blocks: [
      { t: "p", text: "An interactive Gantt: a WBS table plus a timeline, phase rollup bars, task bars with progress and owner, milestones as diamonds. Inline-editable, drag to move/resize, reorderable, exportable to PDF. Bar/dot colour is driven by progress (100% = green)." },
      { t: "callout", tone: "info", text: "Percentage drives status: 0% = Not started, 100% = Completed, anything between = In progress." },
    ],
  },
  {
    id: "minutes",
    group: "Delivery cockpit",
    title: "Meeting minutes",
    blocks: [
      { t: "p", text: "Meeting minutes in the customer's template shape — date/time/location/minute-taker, a participants table, agenda, discussion, and next-steps with owners and dates. Generates a matching PDF and lives in its own tab (separate from Documents)." },
      { t: "p", text: "The document sender is your company for a direct customer, or the managing party for an engagement under a larger portfolio." },
    ],
  },
  {
    id: "raid",
    group: "Delivery cockpit",
    title: "RAID & issues",
    blocks: [
      { t: "p", text: "Risks, Assumptions, Issues, Dependencies and Decisions per project (and engagement). Open high/critical items past their date escalate the project's RAG to Red and surface as attention nudges in the cockpit and My Day." },
    ],
  },
  {
    id: "engagements",
    group: "Delivery cockpit",
    title: "Engagements",
    blocks: [
      { t: "p", text: "For a portfolio customer (e.g. Tungsten with Zambon, Bonfiglioli, Q8), end customers are cockpit-only 'engagement' streams under ONE project — never separate projects/budgets/invoices. An engagement bar switches the view; status/plan/RAID/minutes/documents can be scoped to the selected engagement (the checklist stays project-level)." },
    ],
  },
  {
    id: "guides",
    group: "Delivery cockpit",
    title: "Coaching guides",
    blocks: [
      { t: "p", text: "A 'How do I handle this?' helper in the cockpit: short, admin-editable playbook cards distilled from the SOPs (change requests, slipping dates, kickoffs, unhappy customers, escalation, go-live, and SAP delivery / budget / team situations). Pure guidance, never a gate. Managed at Admin → Coaching guides." },
    ],
  },

  // ---------------- Go-live ----------------
  {
    id: "cutover",
    group: "Go-live",
    title: "Cutover plan",
    blocks: [
      { t: "p", text: "A per-project go-live runbook (Delivery cockpit → Cutover plan, or the Cutover plans sidebar item). Owned by the assigned consultant, governed by the PM. Nothing auto-saves — you edit locally and press Save." },
      { t: "list", items: [
        "Numbered steps (3.1, 3.2 are sub-steps of step 3), a prerequisite column (which step must finish first), person responsible, start/end, duration in hours (0.25 = 15 min), and a status (Pending/In progress/Done/Blocked/Skipped).",
        "A parent step with sub-steps becomes a rollup header — its duration/dates/status/responsible are computed from its children and it's highlighted; a childless row is a normal task.",
        "Reference lists (TRANSPORT LIST, JOBS, table entries…) that a step points to — each exports as its own tab in the workbook, with a hyperlink from the step.",
        "Columns are resizable; export to a branded multi-tab Excel to share with the customer and every provider.",
      ] },
      { t: "formula", name: "Header rollup", expr: "duration = Σ children hours · start = earliest child · end = latest child · status: any blocked → Blocked; all done/skipped → Done; all pending → Pending; else In progress" },
    ],
  },
  {
    id: "uat",
    group: "Go-live",
    title: "UAT test scripts",
    blocks: [
      { t: "p", text: "Per-project customer UAT test scripts (Delivery cockpit → UAT scripts, or the UAT scripts sidebar item), modelled on the real customer workbook. Consultant-owned, PM-governed, explicit Save." },
      { t: "list", items: [
        "Functional areas (each with an overview and data requirements) → test cases: Description, Prerequisites, Expected results, Run by, Date run, Result (OK/KO/Redo/Not run), Reason for failure, Doc no, Comments.",
        "Each area rolls up OK/KO/Redo/Not-run counts; a Test Issue Summary logs defects (area/tab, test#, type, description, corrective action, assigned, open/closed, dates).",
        "Governance status: Draft → Ready → Sent to customer (with a sent date).",
        "Export recreates the customer format: a summary sheet, one tab per area, and the issue log.",
      ] },
    ],
  },
  {
    id: "golive-signals",
    group: "Go-live",
    title: "Go-live & UAT readiness signals",
    blocks: [
      { t: "p", text: "Two governance signals surface automatically in the cockpit banner and in the PM's My Day (in the 'Go-live & UAT' group), so the PM can push the consultant at the right time:" },
      { t: "list", items: [
        "UAT test script not sent — when a project is active and heading into UAT (UAT started, or go-live within 30 days) but the script status isn't 'Sent to customer'.",
        "Cutover not done — when UAT is accepted (or go-live is near) but the cutover isn't finished. It escalates to red inside 3 days of go-live.",
      ] },
    ],
  },

  // ---------------- Admin ----------------
  {
    id: "users-clients",
    group: "Admin",
    title: "Users & clients",
    blocks: [
      { t: "p", text: "Admins manage users (role, employment/cost rate, salary history, carried-in vacation) and clients. Everyone has a self-service Profile (name, title, phone, location, bio, avatar) — email, password and role stay admin-managed." },
    ],
  },
  {
    id: "settings",
    group: "Admin",
    title: "Settings & sign-in (SSO)",
    blocks: [
      { t: "p", text: "Sign-in is Microsoft Entra ID SSO for @al.routemates.it accounts, matched to an existing app user by email — SSO never creates users, and role/company always come from the local account. Password login can be toggled on/off in Admin → Settings (kept SSO-only unless flipped)." },
      { t: "p", text: "Admin → Settings also configures the timesheet nudge (daily/weekly reminders to people who haven't logged time, via email/Teams, with editable templates and exclusions)." },
    ],
  },
];
