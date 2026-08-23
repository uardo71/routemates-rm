# Tungsten PS SOP → RM Ops PSA — gap analysis & enhancement proposal

Source: Tungsten Automation Professional Services **Standard Operating Procedures** library
(44 documents / 437 pages, last updated Jul 2026). Read in full and mapped against what RM Ops
currently has built. The SOPs assume a Salesforce Sales Cloud + CPQ + Certinia PSA + SharePoint +
Teams + NetSuite stack; RM Ops is the small-company equivalent we're building.

**Headline:** the SOP library is essentially the mature spec of the app we're building — the module
list lines up almost one-to-one. Two big takeaways:

1. **Most of the SOP "rules" are exactly the rule-based hints Enida needs.** The deterministic,
   no-AI guidance engine we agreed on gets populated directly from these SOPs — e.g. *status notes
   older than 30 days*, *unapproved billing milestone due this month*, *on-hold project with no open
   issue*, *weekly status overdue*, *don't quote extra work without the PM*. Every worklist below is
   both a governance check AND a "My Day" hint.
2. **The cheapest, highest-impact additions are governance worklists + a project lifecycle state
   machine**, not new modules. They make the tool tell a junior PM what's incomplete and what to do.

Priority key: **P1** quick win / high impact for Enida · **P2** valuable new capability ·
**P3** bigger module · **P4** reference-only (enterprise-scale, skip for a 10-person shop).

---

## Priority summary

| # | Enhancement | SOP(s) | What we have | Priority |
|---|-------------|--------|--------------|----------|
| 1 | **Project data-hygiene dashboard** (saved worklists: missing status/notes/PO/dates/classification, unapproved items, stale >30d) + "My projects" filter → feeds **My Day** | 21, 42, 3 | Delivery Cockpit overview signals only | **P1** |
| 2 | **Project Stage state machine** (Draft→In Progress→On Hold→Closing→Completed/Canceled) gating time / expense / billing | 41, 18, 39 | Milestone status + `timeEntryOpen`; no project-level gate | **P1** |
| 3 | **Weekly status cadence + overdue detection**, prefilled from that week's approved timesheets ("invoice defense"), minimal email variant | 33, 42, 39 | Cockpit status reports (PPTX/Excel), no cadence/overdue | **P1** |
| 4 | **Persistent RAG Project Status + Status Notes** with 30-day freshness rule + stale worklist | 42, 39 | RAG lives only inside a status report | **P1** |
| 5 | **Project Closure gate** (validation: open RAID=0, notes<30d, sponsor set, PS→TS done, 100%-or-override) → cascade close-flags to milestones/assignments | 35, 44 | Milestone completion + lock; no project-level closure gate | **P1/P2** |
| 6 | **Margin panel: Original/Current Budget · Actual · ETC · EAC** across Hours/Rev/Cost/Margin + editable **Agreed Margin %** + corrective-action prompts when EAC margin < agreed | 38 | Revenue report (forecast/earned/recognized + margins) | **P2** |
| 7 | **Billing-milestone approval gate** (Planned→Approved needs Actual Date + acceptance doc + **PO-received** check) + "unapproved due this month" worklist | 13, 4 | Manual invoicing register | **P2** |
| 8 | **Backlog Type + Notes** (Active/Drawdown/On Hold/Closing…) with category-prefixed notes | 3, 21 | none | **P2** |
| 9 | **Project Classification + Complexity** → required PM role + mandatory activity set | 19, 39 | billingType only | **P2** |
| 10 | **RAID enrichment**: Category/Priority/Impact/Likelihood (1–5), action-plan + next-action + review dates, internal/customer flag, **Escalated** toggle → notify escalation chain | 37, 20 | Cockpit RAID (lighter) | **P2** |
| 11 | **Change Request flow**: "Create CR" → linked opportunity + new budget/milestones/assignments + PO; block invoicing if timecards not mapped | 6, 23 | Opportunity amendments | **P2** |
| 12 | **Prebill / deposit ledger** (proforma vs invoice, credit-note reversal, unused-prepay handling) — matches the real Pirelli invoice-in-advance case | 17, 13 | Manual invoices + commission/credit notes | **P2** |
| 13 | **Cost Allocation** as typed, approval-gated milestone-hour transactions (6 types, 10% threshold, transfer math) | 7 | Money value-adjustments + reallocate hours | **P2/P3** |
| 14 | **Status-weighted revenue forecast** (Tentative 60% / Scheduled 100% × opportunity probability) + weekly snapshots + WoW variance | 29 | `AssignmentPlan`×rate, no weighting/snapshots | **P3** |
| 15 | **Skills matrix** (1–5 ratings + type taxonomy + "primary") → skill-based staffing filter + quarterly re-eval nudge | 30 | none | **P3** |
| 16 | **CSAT / Customer health** (NPS surveys, cadence by deal size, final-survey closure gate, negative-response escalation worklist; CSC captured at presales) | 31, 32 | none | **P3** |
| 17 | **Approver delegation** (open-ended delegate, notify prefs, "pending my/delegate approval" queue) | 1 | Fixed approver logic | **P2** |
| 18 | **"Prepare for Delivery" checklist gate** before a project goes Active (open time/expense, billable/review flags + notes, forecast inclusion, contacts, dates, repository link) | 18 | Generic playbook checklist | **P1/P2** |
| 19 | **Internal / Get-Well / At-Risk project types** (non-billable, soft hours cap, hours-based approval routing, no rev until booked) | 9, 12, 2 | `isInternal` flag | **P3** |
| 20 | **Document naming + Project Repository Link** (`[PR-#] - [Name] - [YYYYMMDD]`, folder taxonomy) | 34 | Documents module (kinds) | **P2** |
| — | Regions/legal-entity dimension; FX 3-rate model; MS Teams/Helpdesk provisioning; PSR presales SLA tool; Service-Estimator workbook | 26, 8, 10, 16, 23, 28 | partial / n/a | **P4** |

---

## Detail by theme

### A. Project lifecycle & governance (biggest, cheapest win)
- **Project Stage** (SOP 41): a real lifecycle where **only "In Progress" opens** time/expense/billing;
  Draft/On Hold/Closing/Completed/Canceled close them. On win-conversion the project stays **Draft
  until the PM moves it**. Add `Project.stage` + gating; add a "Draft project on a won deal" worklist.
- **Prepare for Delivery** (SOP 18): a checklist gate to move Draft→In Progress — open time/expense
  entry, billable + review flags with justification notes, include-in-forecast, customer contact +
  sponsor + billing contact, classification, go-live/expiry/warranty dates, repository link, status
  notes. Our playbook checklist becomes this concrete, enforced gate.
- **Project Status (RAG) + Notes** (SOP 42) and **Backlog Type + Notes** (SOP 3): persistent
  health + remaining-budget classification, both with a **30-day freshness rule**. Notes prefixed by
  category (Customer/Financial/Product/Resource/Schedule/Scope/Other).
- **Data-hygiene dashboard** (SOP 21): the single most "junior-PM-friendly" feature — a dashboard of
  saved worklists (missing status/classification/PO/dates/notes/contacts/repository, unapproved
  timecards & milestones, pending non-bill, stale notes) with a personal "my projects" filter. This
  IS Enida's "what do I need to fix" list and drops straight into **My Day**.
- **On-Hold rule** (SOP 39): On Hold requires Stage=On Hold + Status=Red + ≥1 open issue → enforce.
- **PM Activity Checklist by classification** (SOP 39) + **Classification/Complexity** (SOP 19):
  make the playbook checklist mandatory/optional per project classification, and store an
  Engagement-Manager-vs-Project-Manager role that toggles which activities apply.

### B. Status reporting (Enida's #1 weak point)
- **Weekly cadence, enforced** (SOP 33/39): every active project needs a status each active week.
  Detect overdue → surface on My Day. Two report shapes: full (cockpit deck) + **minimal email**.
- **Prefill from timesheets** (SOP 33): T&M = hours consumed this week; FP = milestone progress;
  validate the report aligns with that week's approved time (it's the customer's invoice defense).
- **Auto-cc Delivery Director + archive** the sent report to the project's documents.

### C. Financials
- **Margin framing** (SOP 38): Original Budget / Current Budget / Actual / **ETC** (schedule remaining)
  / **EAC** (estimate-at-complete) across Hours·Revenue·Cost·Margin·Margin%. Editable **Agreed
  Margin %**; when *Current-vs-EAC margin* goes negative, prompt the three fixes: (1) book a billable
  change request, (2) lower future scheduled hours, (3) do a cost allocation. Expenses excluded from
  margin (matches our overhead treatment). This is the owner's dashboard.
- **Services Forecast** (SOP 29): weight future revenue by **assignment status** (Tentative 60%,
  Scheduled/Closed 100%) × **opportunity probability**; snapshot weekly with prior-week variance;
  actuals only from **approved** timecards (= our "draft isn't actual"). Upgrade of our plan×rate forecast.
- **Cost Allocation** (SOP 7): the disciplined version of "reallocate hours" — typed, approval-gated
  transactions (% Complete, Contingency, Non-Bill, Planning Reduction, Pending Non-Bill, Transfer),
  a 10%-of-budget approval threshold, and the transfer cost/revenue conversion math. CAs can never
  increase budget revenue. Keep an immutable audit trail (we already do this for money adjustments).
- **FX** (SOP 8): distinguish a **daily "actual" rate** from a **fixed annual "budget" rate**
  (project/milestone/timecard amounts use the budget rate). P4 unless multi-currency reporting bites.

### D. Billing / invoicing
- **FP billing gate** (SOP 13): Billing Milestone Planned→Approved requires **Actual Date + acceptance
  attachment + PO-received check**; "unapproved milestones due this month" worklist; twice-monthly
  generation cadence. Adds rigor to our manual register.
- **Pre-billing / deposit** (SOP 17): proforma vs real invoice, deposit ledger, credit-note reversal,
  $0-cost timecards to recognize unused prepay, VP-approval attachment, closure reconciliation gate.
  Directly models the **Pirelli invoice-in-advance** situation we already hit.
- **Billing/Expense Review flags** (SOP 4): "Review Needed" checkbox + notes + a "Reviewed" gate
  before an invoice line is releasable.
- **Carve-out** (SOP 5): license-funded free PS work → `carveOut` flag suppresses auto-invoice
  ($0 bill rate), manual monthly rev-rec. Niche (P3/P4).

### E. Delivery health, issues, closure
- **RAID** (SOP 37): enrich with Category (10 values), Priority/Impact/Likelihood 1–5, Owner,
  Action Plan + Next Action (+owner/date/history) + Review Date cadence, **Internal vs Customer**
  visibility, and an **Escalated** toggle that flags the project and notifies a configured escalation
  chain (PM→Delivery Director→VP→SVP). Saved views "My open issues", "Issues on my projects".
- **Project Closure** (SOP 35) + **PS→TS Transition** (SOP 44): a Stage=Closing state machine with
  pre-close validation gates (open RAID=0, notes<30d, sponsor set, transition done, 100%-or-override),
  auto-cascade of close flags to milestones/assignments, trigger CSAT, and an FP early-cancel
  VP/SVP approval chain. This is the natural extension of our milestone-completion/lock work.
- **At Risk** (SOP 2): approved budget to start delivery before the deal is won; no revenue until
  booked. **Get Well** (SOP 9) + **Internal Projects** (SOP 12): non-billable project types with a
  soft hours cap (warn, don't block) and hours-based approval routing (≤80h Region Leader / >80h up).

### F. Customer success (new differentiator)
- **CSAT / NPS** (SOP 31) + **Customer Success Criteria** (SOP 32): capture measurable success
  criteria at presales; periodic + final surveys with cadence set by deal size (A≥100k…D<25k);
  final survey auto-fires at Closing (closure gate); **negative response (NPS<7 or dissatisfied)**
  opens an escalation worklist (Internal Inquiry→Customer Inquiry→Assessment→Action→Completed,
  assess within 2 weeks). Even without sending real surveys, tracking sponsor + criteria + a manual
  health score gives a junior PM a "customer health" signal.

### G. Resourcing
- **Skills matrix** (SOP 30): per-person 1–5 ratings (None/Limited/Some/Comfortable/Strong/Expert) +
  skill-type taxonomy + "primary" flag + evaluation date; drive skill-based staffing filters and a
  quarterly re-eval nudge (reuse the timesheet-nudge engine).
- **Resource management** (SOP 24, 20): target **80–100% capacity** as the planner's benchmark;
  cancellable "resource requests" for unassigned demand; assignment dates already bound time entry.

### H. Presales / estimating / CRM (mostly P3/P4 at our scale)
- **Change Requests** (SOP 6): "Create CR" spawns a linked opportunity + new budget/milestones/
  assignments + PO; invoicing blocked until timecards map to the right milestone/PO. Upgrade of amendments.
- **PS Request** (SOP 23): a presales-request tracker with a 7-status state machine, Next-Action
  fields, and SLA timers/missed-SLA alerts — the Next-Action + SLA pattern is worth borrowing for the
  cockpit even if the full PSR isn't.
- **Service Estimating** (SOP 28): estimate→Quote→Project sync (= our win→create-project); the
  CPQ/PSA field-mapping table (list price/discount/sales price/total) is a ready reference.
- **Regions/legal entity** (SOP 26), **Approver delegation** (SOP 1), **Project Info list** (SOP 36:
  delivery-type + solution tags + business-problem/use-case/success-criteria fields = searchable
  portfolio), **Helpdesk/Teams** (SOP 10/16/40): reference or low priority.

---

## How this plugs into the SOP-hint engine (the Enida feature)
Each rule above becomes a deterministic trigger → SOP-cited hint on **My Day** / the workspace:
- status notes >30 days old → "Update your status notes (SOP: Project Status)."
- billing milestone Approved without a PO on file → "Get the PO before this can be invoiced (SOP: FP Billing)."
- project On Hold without an open issue → "Log the reason as an issue (SOP: PM Activity Checklist)."
- customer asks for extra work → "Don't quote it — route a change request (SOP: Project Work Management)."
- milestone date slipped → "Re-baseline and note it; consider a CR (SOP: Task Management / Change Requests)."
- project reaching Closing with open RAID → "Close or reassign open issues before closure (SOP: Project Closure)."

So building the governance worklists (P1 items) simultaneously builds most of the hint library.
