# Project context (continuity snapshot)

This file is a snapshot of accumulated working notes for this project, copied here on
2026-08-09 so a Claude Code session on a different machine has the same context that
built up locally over prior sessions (that local memory lives outside git and doesn't
travel with a clone). It won't be kept in sync automatically going forward — treat it as
a one-time bootstrap, not a live source of truth. When it conflicts with the actual code,
trust the code.

---

## Original ask (verbatim, first message of the project)

> i need to create an accounting system for my company, like an ERP
> it's a small one with 10 employees
>
> basically we sell services across different clients
> we have different roles within the company, we have developers, consultants, PM with
> different sales prices
> we have contractors
>
> we have opportunities, sales, projects, time entries, approval process, planning,
> revenues, budgets, gantts, milestones, scheduled, actuals, invoicing, forecasting,
> salaries and so on
>
> how can we do this, i need to manage my company, salesforce is too expensive, i need
> something for my company, so everyone can access within company, having different
> authorizations or limited things to view/edit and so on

Status of each named item as of 2026-08-09, so nothing on that list gets silently
dropped: **projects, time entries, approval process, planning, milestones,
scheduled/actuals, invoicing, salaries** — built (see below). **budgets** — partially
(milestone budget cost + hour reallocation; no company-wide budget rollup report).
**gantts** — explicitly tried as a drag/resize Gantt, then explicitly rejected by the
user in favor of the editable spreadsheet grid actually built for Planning. **revenues**
— invoicing gives actuals; no dedicated revenue report. **opportunities, sales,
forecasting** — never designed beyond this one-line mention. No fields, stages, or
workflow have been discussed for a CRM/opportunities module at any point since — if
picked up, it needs a real requirements conversation with the user first, not an assumed
design.

---

## RM Ops project — architecture, decisions, and gotchas

Building "RM Ops" — a custom internal PSA (Professional Services Automation) system at
this repo for a ~10-person services company (developers, consultants, PMs, contractors)
selling client work. Replaces Salesforce + separate PM/timesheet/invoicing tools, too
expensive for their size.

**Why:** User explicitly chose custom build over adapting ERPNext/Odoo, for tight fit to
their PSA-specific workflow (role-based sales rates, approval chains, contractor
handling). Payroll scope is deliberately cost-tracking only (feeds margin/budget math) —
no payslip/tax processing, that stays with their existing payroll provider.

**Stack:** Next.js 16 (App Router, TypeScript, Turbopack default), Postgres via
**Prisma 6.19.3 pinned deliberately** (not 7 — v7 removed the Rust engine and requires
driver adapters + prisma.config.ts, too bleeding-edge for a long-lived internal tool;
downgraded from the auto-installed v7), Auth.js v5 (beta) with Credentials provider + JWT
sessions (no DB session tables), shadcn/ui on **Base UI** primitives (not Radix — this
project's shadcn init pulled `@base-ui/react`), Zod, date-fns, pnpm.

**Environment setup notes (Windows, native install, no Docker):**
- nvm-windows managing Node — active version lives at `C:\nvm4w\nodejs`, NOT
  `C:\Program Files\nodejs`. Fresh shells often need `C:\nvm4w\nodejs` prepended to PATH
  manually before `pnpm`/`node`/`npx` resolve.
- PostgreSQL installed natively — service `postgresql-x64-17` (or matching version),
  superuser `postgres`/`postgres`. App role `erp_app` / `erp_dev_local_pw` owns database
  `erp_dev` (has CREATEDB for Prisma's shadow DB). `psql.exe` needs its full path
  (`...\PostgreSQL\17\bin\psql.exe`) if PATH doesn't resolve it.
- `pnpm dlx` can be unreliable (ENOENT on cache) — prefer `npx` for one-off runners.
- Dev server launch config lives at `.claude/launch.json`.
- Migration workflow: hand-write SQL migrations under
  `prisma/migrations/<timestamp>_<name>/migration.sql`, apply via
  `pnpm exec prisma migrate deploy` (non-interactive-safe, unlike `migrate dev`), then
  `pnpm exec prisma generate` — **stop the dev server first**, otherwise Windows
  file-locks the Prisma query-engine DLL (`EPERM`).

**Base UI gotchas (real library defects/quirks, not preferences):**
- `<Select>` renders raw `value` instead of the item's label unless you pass an `items`
  prop (`{value, label}[]` or `Record<string,label>`) to the root `<Select>`. Every
  Select usage in this codebase includes `items=`.
- `DropdownMenuLabel` (`Menu.GroupLabel`) must be wrapped in `DropdownMenuGroup`
  (`Menu.Group`) or it throws "MenuGroupContext is missing."
- Never pass a component/function (e.g. a `lucide-react` icon) as a prop from a Server
  Component into a Client Component — crosses the RSC boundary and crashes with "Only
  plain objects can be passed to Client Components." Pattern used: pass a string key,
  look the icon up in a `Record<string, LucideIcon>` inside the client component.
- Similarly, a Server Component must never pass an inline arrow/closure wrapping a server
  action (`action={() => someServerAction(id)}`) to a Client Component — use
  `.bind(null, id)` instead, which Next.js knows how to serialize across the boundary.
- **Real bug, fixed**: `Tabs.Panel`'s `hidden` attribute gets stuck `false` after
  switching tabs (its `mounted` state only flips via a CSS-transition-completion
  callback, which never fires without an actual transition) — panels stack visibly
  underneath the active one. Fixed by driving visibility off `inert` instead:
  `"[&[inert]]:hidden"` added to `TabsContent`'s className (`components/ui/tabs.tsx`).
- **Same bug family, `Dialog`**: overlay/popup gets stuck open (invisible but
  `pointer-events: auto`), silently eating clicks underneath. Fixed with
  `data-closed:hidden` on `DialogOverlay`/`DialogContent` (`components/ui/dialog.tsx`).
  Any Base UI component using `data-open`/`data-closed` exit-animation classes in this
  codebase is a candidate for the same bug if clicks mysteriously stop registering after
  a popup/dialog/tab interaction.

**Current architecture (as of 2026-08-09):**

- **Delivery hierarchy**: Project → Milestone → Assignment (person) / Task.
  `Project.billingType` (TIME_AND_MATERIALS | FIXED_PRICE | RETAINER) is the single
  source of truth for billing mode. `Milestone.salesPrice` means hourly rate for
  T&M/RETAINER, lump sum for FIXED_PRICE; `Milestone.cost` is budgeted cost (optional,
  defaults to 0 — a live-computed "implied cost from assignments" reference is shown
  alongside it, doesn't overwrite it); `Milestone.budgetHours` is an optional hour cap;
  `billable` flag for internal/non-billable milestones; `status`
  PLANNED→ACTIVE→COMPLETE→INVOICED; `timeEntryOpen` bool gates time entry independent of
  status.
- **Assignment**: per-milestone, snapshots `costRate` at creation (from
  `Employment.costRate`, salary-derived), optional `allocatedHours` cap, **required**
  `startDate`/`endDate` (NOT NULL), manual `status` ACTIVE/PAUSED/CLOSED. `costRate` is
  Admin/Finance-only (`rates:view:any`) — hidden from PMs in both display and forms;
  server ignores a submitted `costRate` from anyone without the permission.
- **No `JobTitle` model** — removed entirely (was redundant with
  `Milestone.salesPrice` for billing rate and `Employment.costRate` for cost rate).
  `Employment` uses a plain `trackEmployment` checkbox + start/end dates.
- **Time tracking is `TimeCard`-per-**assignment** (not per-week, not per-task)**:
  `TimeCard(id, userId, assignmentId, milestoneId, taskId=REMOVED, weekStartDate,
  status DRAFT/SUBMITTED/APPROVED/REJECTED, submittedAt, submittedById, approverId,
  decidedAt, comment)`. `TimeEntry.timeCardId` + `TimeEntry.taskId` — a card can hold
  entries across several tasks. No unique constraint on
  `(assignmentId, taskId, weekStartDate)` — multiple TimeCards can coexist for the same
  line (that's how post-approval corrections work: a new card, not mutating a frozen
  one). `Timesheet`/`Approval` models from earlier phases are gone.
- **`submittedById` vs `userId`**: distinct fields — `userId` is whose time it is,
  `submittedById` is who actually clicked Submit (a PM/Admin can proxy-submit for
  someone else). UI shows `"{submitter} (on behalf of {owner})"` when they differ.
- **Auto-approval is narrow**: only when the literal project manager
  (`Project.managerId === caller.id`) submits time for someone else, OR when the
  submitted line is a **negative-only correction** (see below) — regardless of who
  submits it. Admin proxy-submission does NOT auto-approve (lands in the normal queue,
  real PM as approver). Self-submission never auto-approves, even for the actual PM
  submitting their own hours. Save never sets any status but DRAFT; auto-approval only
  happens in Submit.
- **Negative-hours correction rules** (a line's sign has real semantics):
  1. A single TimeCard can never mix positive and negative cells (validated client +
     server side).
  2. A negative-only line is valid and submittable (not excluded like a zero-total line).
  3. A negative line can never undo more hours than are actually `APPROVED` on that
     assignment/task — blocked server-side if `abs(requested) > approvedTotal`.
  4. Submitting a negative-only line always auto-approves immediately, regardless of
     submitter — it's treated as "an undo of already-approved hours," not new work
     needing a decision.
- **PM scope is company-wide**, not limited to projects they personally manage — for
  both time-entry proxying (`/time`) and resource planning (`/planning`). The only thing
  still gated by literal project management is whether a submission auto-approves.
  Admins are unaffected (already saw/could edit everyone). PM does **not** have
  `clients:view`.
- **"Draft hours are not actual" principle**: only `TimeCard.status === "APPROVED"`
  hours count toward "Logged"/budget-progress displays and T&M invoice generation. Save's
  cap-remaining validation still sums *all* non-zero entries regardless of status
  (deliberate, prevents overallocation before decisions land).
- **Time grid UI** (`/time`, `week-grid.tsx`): one row per **card** (checkbox, status,
  submit, delete, recall, notes), task sub-rows underneath (hours-only, no status of
  their own), collapsed by default with a chevron toggle. Daily notes are
  **assignment-level, not per-task** — one shared note per (card, day), mirrored onto
  every task row's local state. Notes are `Textarea`, capped at 255 chars, both client
  and server. Delete is bulk, **draft-only**, **owner-only** (a proxy manager can never
  delete someone else's card). Bulk submit via per-row checkboxes + a header Submit
  button (nothing checked → confirm "submit all N draft lines?"; some checked → submits
  only those). Recall is per-line, owner-only, only while `SUBMITTED`.
  - **Client-generated new-card ids**: must never collide across weeks or across
    multiple new lines for the same assignment — final scheme is fully random
    `"new:" + crypto.randomUUID()`, tracked via explicit `cardKey` fields (not grouped
    implicitly by `assignmentId`). Any future "not yet saved" id that could become a
    permanent DB primary key must be scoped uniquely across repeats — don't reintroduce
    an assignment-only id for anything TimeCard-related.
  - Client components with `useState(propDerivedValue)` need a `key` prop at the usage
    site if they can be re-rendered in place with different props (client-side nav, tab
    switch) without a full page load — `<WeekGrid>` learned this the hard way (needed
    `key={targetUserId + week}` to reset state on Prev/Next).
- **Resource Planner** (`/planning`): editable spreadsheet grid (not a Gantt — an
  earlier drag/resize Gantt build was explicitly rejected), resource rows expand to
  per-assignment rows, hours typed directly into weekly cells = planned/scheduled hours,
  stored in `AssignmentPlan(assignmentId, weekStartDate, hours)` — deliberately separate
  from actual `TimeEntry` hours (meant to eventually drive a revenue forecast, not built
  yet). Capacity coloring on collapsed resource-week cells: yellow if <40h, green if
  =40h, red if >40h (exact hours, not a percentage band). Planned total can't exceed an
  assignment's `allocatedHours` (cross-check already implemented). Current-week column
  gets a `border-l-2 border-l-primary` (via `weekBorderClass(weekKey)` helper — don't
  reintroduce a bare `border-l` on any of planner-grid's 3 places that use it) plus a
  `CurrentWeekBadge` (pulsing "Now" pill with hover tooltip) in the header.
- **Scheduled vs actuals** (`/admin/scheduled-vs-actuals`): Planner-style grid comparing
  `AssignmentPlan` vs actual submitted `TimeEntry` hours (only counting entries whose
  `TimeCard.status !== "DRAFT"`), same current-week indicator as Planning. Available to
  both Admin and PM (gated on `planning:view`, same as Planning — "no restrictions").
  **Severity-ranked status coloring** (iterated 3 times per direct user feedback, this is
  the final version — don't revert to an earlier variant):
  `planned === 0` → rose-600 (worst — no planning at all, always flagged even if actual
  is also 0, never a blank/neutral cell); `actual === 0` → red-500 (planned but nothing
  submitted); `actual < planned` → amber-400 (partial); `actual >= planned` → emerald-500
  (matches/exceeds). Cells show stacked `P {planned}` / `A {actual}` labels (not just
  "20/40") so it's clear which number is which.
- **Approvals page** (`/approvals`): line-by-line `Table` (one row per pending
  `TimeCard`), bulk select + Approve/Reject toolbar, row click opens a detail `Dialog`
  styled like the time grid (reuses shared `TimeCardGrid` component), scrollable body
  (`max-h-[85vh] flex flex-col overflow-hidden` + `flex-1 min-h-0 overflow-y-auto`) so the
  footer stays reachable. Columns include Resource, Submitted by (distinct from
  Resource), Approver (the responsible PM), Status. Deciding sets `approverId` to
  whoever actually clicked Approve/Reject (not just whoever was pre-assigned at submit
  time).
- **Project detail page** (`/projects/[id]`): tabs (Overview/Milestones/
  Assignments/Time entries/Invoices) with live counts. Time entries tab is
  `TimeCard`-based (not raw `TimeEntry` count — that was a real bug, showed a
  confusing large number), clickable rows open a genuinely **read-only** detail dialog
  (no Approve/Reject actions) via shared `TimeCardGrid`.
- **Rate fields are `Decimal(_,4)`, not `(_,2)`** — computed rates (e.g. a lump sum ÷
  hours) need 4 decimals of precision; any new rate-like input should use
  `step="0.0001"` to match.
- **Currency**: `src/lib/format.ts` (`formatMoney`, `formatNumber`, `currencySymbol`) is
  used everywhere a monetary amount or its label is displayed — `Company.currency`
  drives the symbol, don't hardcode `$`/`€`. Assignment cost rate is always EUR
  regardless of company currency (salary-derived).
- **"Copy tasks from another milestone"** (template reuse) and **inline pencil-icon
  quick-edit** exist on the milestone Tasks table, in addition to full edit pages.

**Deferred / not yet built**: Opportunities/CRM pipeline, revenue forecast dashboard
consuming `AssignmentPlan`, employee-facing PTO/vacation/public-holidays, retroactive
per-time-entry historical cost basis (cost rate is a snapshot, not time-travel-accurate),
payment gateway integration, Routemates logo (waiting on user to supply the image), a
"beautiful grid" visual polish pass beyond the current light-theme flip.

**How to apply when resuming work**: Don't re-litigate the Prisma 6 vs 7 or Base UI vs
Radix choices — deliberate. Always pass `items` to `<Select>`. There is no `JobTitle`
model — don't reintroduce it. Don't reach for `Timesheet`/`Approval`/`entryGroup`/
`TimeCard.taskId` — none of them exist anymore. Don't widen auto-approval scope beyond
"literal project manager proxying" + "negative correction." As of the last session, the
app was browser-verified end-to-end across Admin/PM proxy-entry paths and the production
build was clean.

---

## Design reference (pending decision — do not assume an answer)

On 2026-08-08 the user shared `consulting-erp.html` (a self-contained prototype) as a
visual reference, calling the shadcn dark-blue theme "not good." They confirmed wanting
it applied as a dedicated redesign pass, sequenced *after* functional work — that pass
has not happened yet.

Reference palette/typography if that pass is picked up:
- **Typography**: IBM Plex Sans (UI text) + IBM Plex Mono for all numbers/data
  (tabular-nums).
- **Palette**: warm "paper" light theme — ink navy (#141F2B) sidebar, off-white paper
  (#EBEFF1) background, white cards, brass/gold accent (#A9812F), plus semantic
  green/rust/amber/blue for status.
- **Shape**: sharp corners (3px radius, not shadcn's rounded-lg default), thin 1px
  borders, subtle layered shadows.
- Distinctive components worth porting: rotated "stamp" status badges (dashed border for
  draft, rotated ±2deg), pill-style billing-type chips, stat cards with uppercase label +
  big monospace value + delta line, hierarchical planning-grid rows.

**Open question, unresolved**: a later same-day message asked for something "like
Salesforce" (blue-accent, white/light-gray dense corporate tables) when flipping to light
mode — the rest of that session's redesign work (Time Entry grid, Resource Planner,
Project page) actually followed the Salesforce/Tungsten-screenshot direction, not the
brass/paper ink-navy palette above. **Don't assume which one wins — ask the user before
starting a full grid-styling pass**, unless they've since told you explicitly (check
recent conversation first).

---

## Session update — 2026-08-09 (later the same day, pushed to git as commit `cf20644`)

Everything below was built in one continued session after the snapshot above was written,
then committed and pushed to `origin/main` (`https://github.com/uardo71/routemates-rm.git`).
The bootstrap note at the top of this file still applies — treat this as another one-time
layer, not a live source of truth.

**Leave management** (generalized from vacation-only to multi-type):
- `LeaveType` enum: `VACATION` (20 days/yr, uncapped carryover, prorated first year),
  `SICK` (uncapped, tracked only), `PATERNITY`/`MATERNITY` (one-time no-quota period,
  admin-picks exact dates). `LeaveRequest` model (renamed from `VacationRequest`) +
  `LeaveReturn` model for early/partial return-to-work (un-provisions the returned
  working days from Planning/Time Entry and, for vacation, gives the days back to the
  balance — supports both "back for good" and "back for a few days then out again").
- Admin-only approval (admin-direct-insert auto-approves); PM has company-wide read-only
  visibility; employees self-service only. Approval auto-provisions
  Assignment/Milestone/AssignmentPlan/TimeCard/TimeEntry via `src/lib/vacation.ts`.
- Albanian public holidays (`src/lib/holidays.ts`, hand-researched through 2030) shown as
  informational (never blocking) in Planner, Time Entry, and vacation request preview.
- UI at `/vacations` (`vacations-client.tsx`) — type selector, balance card, pending queue,
  "Record return" button (Admin-only, by design), `formatLeavePeriod()` helper so a range
  spanning a year boundary shows both years correctly.
- Real freeze-bug fix: `countWorkingDays` in `src/lib/vacation-calc.ts` is bounded
  (`MAX_VACATION_RANGE_DAYS = 400`, returns `-1` sentinel) so a mid-typo date can't hang
  the tab looping day-by-day.

**Expense tracking module** (`/expenses`, `/admin/expense-categories`):
- Built for the year-end accountant-report use case: `ExpenseCategory`, `Expense`
  (category, date, amount, currency, vendor, payment method, `paidBy` COMPANY/EMPLOYEE,
  owner/submitter/decider trio mirroring `LeaveRequest`), `ExpenseReceipt` (file
  attachments). Any employee can log a company-card expense or a personal reimbursement
  claim; auto-approval depends only on whether the **submitter** has `expenses:manage`
  (Admin/Finance), regardless of `paidBy` — a deliberate correction mid-build after the
  user clarified employees can be handed the company card too.
- Receipts stored on local disk (`uploads/receipts/`, gitignored, never in `public/`),
  served only through the authenticated route `src/app/api/receipts/[fileName]/route.ts`.
  `next.config.ts` `serverActions.bodySizeLimit` bumped to `20mb` for phone-camera photos.
- CSV export at `src/app/api/expenses/export/route.ts` (date/category/amount/paid-by/
  status/receipts-count/etc.) — the actual deliverable the user needs to send their
  accountant.
- 6 default categories seeded for the real company: Utilities, Office Supplies, Travel,
  Entertainment, Professional Services & Fees, Other.

**My Planning** (`/my-planning`): read-only, self-scoped mirror of the Resource Planner —
every employee can see what their PM scheduled for them. Reuses `PlannerGrid` from
`/planning` directly with `canManage={false}` (that prop already drives full read-only
rendering, no separate component needed). No permission gate — available to every role,
same as `/time` and `/vacations`.

**Resource Planner (`/planning`) additions**:
- Shows every active company user now, not just people with an existing assignment (role
  filter narrows who's listed; project filter only narrows which assignments show under
  each person) — via `src/components/multi-select-filter.tsx`, a checkbox-dropdown driven
  by comma-separated URL params (`parseList()` in `src/lib/utils.ts`). Same treatment
  applied to `/admin/scheduled-vs-actuals`.
- Assignment window validation: `savePlanAction` now rejects hours planned outside an
  assignment's own `startDate`/`endDate` (client grays the cells too).
- Drag-to-resize an assignment's end date directly from the grid — bidirectional (right
  to extend, capped at the project's end date; left to shrink, capped at the latest
  submitted/approved time entry). Stages into local state (`pendingEndDates`), only
  persisted on "Save plan" — never auto-saves.

**Projects/Milestones/Invoices UI redesign** (pure presentation pass, no schema/behavior
changes, done because the original flat label/value layout "looked poor, like someone
without taste"):
- Shared components: `src/components/stat-card.tsx` (pre-existing, reused), `info-field.tsx`
  (icon-led label/value), `initials-avatar.tsx` (deterministic-tint initials chip),
  `charts/donut-chart.tsx` and `charts/mini-bar-chart.tsx` — hand-rolled SVG/CSS, no
  charting library added (same call already made for the Planner grid vs. an external
  Gantt library).
- Projects list: avatar chips, status/billing badges, team size, hours-progress column,
  plus multi-select filters (status/client/manager/billing type) via `projects-filters.tsx`.
- Project detail Overview tab: KPI stat row (milestones/team/hours/invoiced) + a "hours by
  milestone" donut chart, replacing the flat info grid.
- **Reallocate hours between milestones moved from the Project Overview tab to each
  Milestone detail page** (scoped to that milestone + its siblings) — don't re-add it to
  the project page.
- Milestone page: stat row, icon-led info fields, "hours by assignee" donut chart.
- Time entries tab gets a weekly-hours bar chart (only shown when there's more than one
  week of data). Invoices list gets stat cards + a 6-month invoiced-value bar chart.

**Session timeout fix**: `src/auth.ts` sets `session.maxAge` to one day; `@auth/core`'s
JWT-strategy callback always stamps an explicit cookie `Expires` from that value
regardless of the `cookies.sessionToken.options` config, so
`src/app/api/auth/[...nextauth]/route.ts` strips `Expires`/`Max-Age` from the
`Set-Cookie` header after the fact — this is why that stripping code exists, don't remove
it thinking it's dead.

**Verification note for whoever picks this up**: everything above was typechecked,
linted, built (`pnpm run build`), and browser-verified live end-to-end, including a real
concurrent user session (Iljona submitting an expense with receipts, approved live).
One Base UI quirk worth knowing if you're browser-testing with an automation tool: plain
synthetic `click` events sometimes don't register on Base UI `Tabs`/`Select` triggers in
headless automation (aria-selected doesn't flip) — dispatching a full
`pointerdown`→`mousedown`→`focus`→`pointerup`→`mouseup`→`click` sequence fixes it. Real
mouse/touch input from an actual user is unaffected.

**How the local dev database relates to this repo**: the Postgres database (`erp_dev`,
real company data — 9 real users, live projects/expenses/leave requests) lives outside
git entirely, native-installed on the machine this was built on. See the "Environment
setup notes" section above for the DB role/connection details. If you're reading this
from a *different* machine and don't have that database yet, you need a dump transferred
from the original machine (pg_dump), not just a `git clone` — the schema comes from
Prisma migrations in this repo, but the actual data doesn't.

---

## Session update — 2026-08-10 (fresh Windows PC bring-up + three new modules)

Everything below was built in one session on a **new machine**, after standing the environment
up from scratch, and is committed to `origin/main`. Same bootstrap caveat as above — treat as a
one-time layer; when it conflicts with code, trust the code.

### Environment stood up on this PC (repeat on the next one)
- **nvm-windows 1.2.2** (winget `CoreyButler.NVMforWindows`), **Node 20.20.2** — active version
  symlinked at `C:\nvm4w\nodejs` (default). **pnpm 9.15.9** installed globally (matches
  `packageManager`). Fresh shells still need `C:\nvm4w\nodejs` prepended to PATH.
- **PostgreSQL 17.10** native (winget `PostgreSQL.PostgreSQL.17`), superuser `postgres`/`postgres`,
  service `postgresql-x64-17`. `psql` not on PATH — full path `C:\Program Files\PostgreSQL\17\bin`
  (added to user PATH, preserving `%NVM_HOME%`/`%NVM_SYMLINK%` as REG_EXPAND_SZ).
- App role **`erp_app` / `erp_dev_local_pw`** owns database **`erp_dev`** (CREATEDB). The dump was
  restored **as `erp_app`** (not postgres) so erp_app owns every object — the app connects with full
  access, no grants needed. `.env` has `DATABASE_URL` (erp_app→erp_dev) + a dev `AUTH_SECRET`.
- **Migrating to a new PC**: install nvm/Node20/pnpm/PostgreSQL17 as above; `git clone`;
  `pnpm install`; recreate `.env`; then get the data across — the DB lives outside git, so transfer
  a fresh `pg_dump` of `erp_dev` and restore it **as erp_app**, OR run
  `pnpm exec prisma migrate deploy` for an empty schema; copy `uploads/` (receipts, gitignored).
  **DB data (opportunities, invoices, plan edits from this session) is NOT in git** — only the
  schema (via `prisma/migrations`) is. Dump + restore to carry the data.

### Opportunities / CRM module (NEW — `/opportunities`)
Full sales pipeline → win → auto-create Project. Models **Opportunity / OpportunityLine /
OpportunityRevision** (+ enums `OpportunityStage`, `DiscountType`); `src/lib/opportunity.ts` (pure
quote math + stage metadata); actions in `src/app/(app)/opportunities/actions.ts`.
- Access: **SALES (finally activated) + PM + Admin** manage; **Admin-only approve**; FINANCE view.
  New perms `opportunities:view|manage|approve` in `src/lib/permissions.ts`.
- Stages: QUALIFYING → PROPOSAL_SENT → NEGOTIATION → PENDING_APPROVAL → WON / LOST / CANCELLED.
- Quote lines carry `quantityHours × unitPrice`; each becomes a **Milestone** on conversion.
  **OpportunityRevision** = immutable JSON snapshot per issued proposal (the negotiation/discount
  audit trail).
- **Discount is deal-level and stays at the PROJECT level** (Project gained `discountType`,
  `discountValue`, `contractValue`, `sowNumber`, `poNumber`) — **milestones keep LIST rates**, the
  discount is not baked into them. Optional PO. SoW/PO carried onto the project on win.
- **Fixed-price conversion**: `Milestone.salesPrice = line total (hours × unitPrice = lump sum)`.
  T&M/RETAINER: `salesPrice = unit rate`. (This was a real bug first — see below.)

### Revenue & forecast report (NEW — `/revenue`, perm `reports:view`)
`src/lib/revenue.ts` (pure `computeProjectRevenue`). **Admin + Finance only — PM was explicitly
removed** (owner-level financials). Per-project + company totals:
- **Forecast** = planned hrs × rate (T&M/Retainer) or contract value (fixed price).
- **Earned (accrued)** = approved hrs × rate, or **% completion** for fixed price.
- **Recognized** = **net of ISSUED/RECONCILED/PAID invoices** in the register (credit notes
  subtract) — replaced the earlier milestone/POC proxy per the "invoiced drives it" decision.
- **Unplanned capacity** = budget hrs − planned hrs. **Cost** = Σ approved hrs × snapshot cost rate
  (EUR). **Margin** + **Margin %** (against earned).

### Invoicing register rework (NEW model — `/invoices`)
**Not a document generator** — a **register + reconciliation ledger** against the user's external
**fiscal app** (which issues the real invoices). **Fully manual, no auto-generation** (removed the
old "Bill milestone" button + `billFixedPriceMilestoneAction` — user wants full control).
`src/lib/invoice.ts` (totals/labels); actions in `src/app/(app)/invoices/actions.ts`.
- Lifecycle **DRAFT → ISSUED → RECONCILED → PAID** (+ VOID). `InvoiceType` INVOICE / CREDIT_NOTE.
  `selfBilled` flag (German self-billing / Gutschrift — recorded for revenue recognition, not sent
  to the customer). **InvoicePayment** model = partial payments (outstanding = gross − Σ payments).
  **VAT** captured (`vatRate`; net from lines, gross = net + net×rate).
- **Reconciliation** fields: `fiscalNumber`, `fiscalReference`, `customerReference`. Register list
  has a **"Needs reconciliation"** worklist (ISSUED without a fiscal number).
- **Create bases**: from approved time (T&M), manual/partial amounts (the Pirelli "one FP rollout →
  3 invoices of chosen amounts" case), full-contract prefill, milestone prefill, credit note (can
  link the original it adjusts). `periodStart/End` now nullable (only time-based invoices set them).
- Status enum changed `SENT`→`ISSUED` + added `RECONCILED` (migration
  `20260810120000_invoicing_register`). Dashboard/project pages updated off `SENT`.

### Bugs fixed this session
- **Donut charts invisible app-wide**: ring colors were derived at runtime
  (`colorClass.replaceAll("fill-","stroke-")`), producing class names Tailwind never compiled → no
  stroke. Fixed with literal `FILL_TO_STROKE` / `FILL_TO_BG` maps in
  `src/components/charts/donut-chart.tsx`. (Any future runtime-built Tailwind class = same trap.)
- **Planner over-allocation**: an assignment's plan could exceed its `allocatedHours` if the
  allocation was lowered *after* planning (the save-time guard only checks the allocation as it was
  then). Added a guard in `updateAssignmentAction` (can't set allocation below already-planned).
  Also added a per-milestone **Planned** column on the project (red when planned > budget hrs).
- **FP milestone salesPrice** stored the rate, not the lump sum — fixed in the conversion and
  retrofitted Pirelli (Colombia 7500, Romania 13000).

### Project detail additions
"View opportunity" button (converted projects); a **Contract** block (list total / discount /
contract value + PO/SoW); Milestones tab gained **Planned** (vs budget, red if over), rate-gated
**Sales price** (rate/h; FP shows effective rate = lump ÷ budget hrs), and **Value** (total) columns.

### Deliberate decisions — do NOT re-litigate
- List-rate-on-milestone + **discount at project level** (never baked into milestone rates).
- **Fixed-price milestone salesPrice = lump sum** (line total).
- **Recognized revenue = invoiced** (the register), not a milestone/POC proxy.
- **Invoicing is fully manual** — nothing auto-creates an invoice (incl. project/milestone status).
- SALES role activated (opportunities). `reports:view` = **Admin + Finance only**.

### Open / next
- Invoice **line editing after DRAFT** = delete + recreate (no in-place line editor yet).
- Invoicing UI is functional but not design-polished (built fast).
- **Pirelli** ("eFLOW AP …") projects/opportunities are **test data** created this session to
  exercise the flow — safe to delete.

---

## Session update — 2026-08-11 (large session; committed to git as one batch)

Everything below was built across one long session and committed together (the working tree had
also accumulated two earlier uncommitted features — task-level planning and historical cost basis —
which are included in the same commit). Same bootstrap caveat: when this doc conflicts with code,
trust the code. Durable design decisions and the "why" also live in the local auto-memory
(`~/.claude/.../memory/`, outside git) — those do NOT travel with a clone, so the key ones are
restated here.

### Migrations added (all applied to erp_dev; apply with `migrate deploy` on a fresh DB)
- `20260810130000_assignment_plan_task_level` — `AssignmentPlan.taskId` (nullable) + a
  `NULLS NOT DISTINCT` unique on (assignmentId, taskId, weekStartDate); optional **task-level**
  resource planning (plan by task under an assignment, or at assignment level).
- `20260810140000_time_entry_cost_rate` — `TimeEntry.costRate` (frozen historical cost).
- `20260810150000_documents` — `Document` model + `DocumentKind` enum (invoice/opportunity file
  attachments).
- `20260810160000_vacation_carried_in` — `Employment.carriedInVacationDays` + `carriedInVacationYear`.
- `20260810170000_opportunity_amendment` — `OpportunityAmendment` model (change-orders).

### Features built this session
- **Historical cost basis**: `TimeEntry.costRate` is stamped at approval to the rate effective on
  the *worked date* (salary + FX), via `stampCostRatesForCards` (called from the approval hooks);
  `src/lib/cost-rate.ts`. Reports (Revenue, Budgets, Scheduled-vs-actuals) use this per-entry rate,
  falling back to the assignment snapshot. Backfill script:
  `scripts/backfill-time-entry-cost-rates.ts`. **A salaried person's hourly rate varies by month**
  (monthly salary ÷ that month's working hours) — this is intentional, not a bug.
- **Document attachments** (`Document` model, `/api/documents/[fileName]` authed serve route,
  `uploads/documents/`): attach PDFs/images to **invoices** (fiscal invoice / credit note / other)
  and **opportunities** (SoW / PO / other). Shared `src/components/documents-card.tsx` with
  collapse/expand for long lists. Upload/delete actions in the invoice/opportunity actions files.
- **Vacation manual carried-in**: admins set an opening vacation balance per employee on
  `/admin/users/[id]` (days + "as of Jan 1 of year"). `computeVacationBalance` seeds its year-walk
  from it (full annual entitlement from that year, no proration); blank = auto from hire date. Team
  balances table shows a read-only Carried-in column.
- **Opportunity amendments**: a WON opportunity takes change-orders (`createAmendmentAction`) that
  add hours after the deal closed — each amendment appends a **new milestone** (default) or grows an
  existing one, and bumps the project's `contractValue` / `budgetAmount` / `budgetHours`. Immutable,
  versioned audit record. UI: an "Amendments" card on the won opportunity (Admin-only, gated on
  `opportunities:approve`).
- **Time Entry ← planning**: a "Planned this week" card on `/time` shows the week's plan per
  assignment/task (even split across working days) with checkboxes + a **"Copy to timesheet"** button
  → injects the planned hours as DRAFT lines (blank notes; skips days already covered by leave/existing
  time). Also **relaxed the timesheet rule** so time can be logged at the **assignment level**
  (`taskId` null) even on milestones that have tasks — the old "must pick a task" check in
  `time/actions.ts` was removed; the grid renders such cards as a single leaf row.
- **Vacations page redesign** (`vacations-client.tsx` + new `absence-calendar.tsx`): a **team absence
  calendar** with a Month-grid ↔ Timeline toggle (colored by leave type, Albanian holidays marked),
  a company overview strip, per-person used-vs-available progress bars, Out-now / Coming-up panels,
  and expand/collapse on the team-balances + history tables.
- **Dashboard redesign** (`src/app/(app)/page.tsx`): role-aware reporting home. Admin/Finance get a
  KPI row + financial band (earned/forecast/gross/operating margin, open invoices) + bar charts
  (forecast by quarter, invoiced last 6 months) + donuts (hours by project, billable vs internal) +
  top-projects list + who's-out. PMs get delivery variants (no financials). Employees get their own
  week + an 8-week hours trend. Reuses the hand-rolled donut/bar chart components (no chart lib).
- **Revenue forecast margin**: `computeProjectRevenue` now also returns `forecastCost`
  (Σ planned hours × current cost rate) and `forecastMargin` (forecast revenue − forecast cost).
  Shown as a company tile + a "Fcst margin" per-project column. (Earned margin still uses historical
  cost; forecast margin uses current rates — that's the deliberate distinction.)
- **Budgets report**: budgeted cost now **derives** from allocated hours × current cost rate when a
  milestone has no manually-entered cost (manual still wins). Cost "Remaining" shows "—" (not a
  misleading red −actual) when no cost budget exists.

### Bugs fixed this session
- **Cost rate = €0 for some staff**: `computeHourlyCostRateEUR` only looked up ALL→EUR, but the FX
  row was entered EUR→ALL ("1 EUR = 105 ALL"). Added `convertToEUR` (handles either direction);
  recomputed all `Employment.costRate`. Exchange-rates page label clarified ("1 EUR = …").
- **Resource Planner "data disappears on Prev/Next"**: `PlannerGrid` seeds cells via
  `useState(initial)` (read once at mount); soft navigation reused the stale state. Fixed with a
  `key` on the range+filters so it remounts (same trap the Time grid's WeekGrid had). Applied to
  `/planning` and `/my-planning`. **Data was never lost — display only.**
- **Invoice from time dropped the last day of the period**: `TimeEntry.date` is stored at UTC
  midnight but the invoice period was parsed at LOCAL midnight (machine is UTC+2), so e.g. Jul-31
  hours fell just outside a "Jul 31" period end. `createInvoiceFromTime` now parses the period at
  UTC midnight with an inclusive end-of-day. **INV-0001 was generated before this fix and is still a
  DRAFT with the old (short) quantities — delete + recreate it for Jul 1–31 to correct it (delete
  frees the time entries).**
- **Scheduled-vs-actuals** showed float noise (e.g. 26.999999999999996) from summing even-split
  hours — now rounds cell + rollup totals to 2 dp.
- **Project navigation**: milestone/assignment back-links returned to the project **Overview** tab
  regardless of origin. Project tabs now honor a `?tab=` param; back-links point at the right tab.

### Real-data notes (production erp_dev)
- **Borana Dishani** is NOT a real employee — it's an account used to bill extra hours to a client,
  so her €0 cost rate is fine (leave as-is).
- **Indri Bejtja** is allocated 480h on AFW (not 960) because he was employed later — intentional.
- The 20/24/33/40 values currently in the **planner/timesheet** for the AFW week(s) are throwaway
  test values entered while debugging — clear/replace with real migrated data.

### Open / next (pick up here)
- **Deploy online** (the immediate goal): needs a Postgres host, a Node host for `next start`,
  env vars (`DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`), `prisma migrate deploy`, a restore of the
  `backups/` pg_dump, and a plan for `uploads/` (receipts/documents) — object storage or a mounted
  volume, since local disk doesn't persist on most PaaS. See the deployment notes handed over in chat.
- **Regenerate INV-0001** for July after the invoice-period fix (above).
- **App-wide date-display cleanup** (UTC `toISOString().slice(0,10)` shows a day early in +UTC
  timezones): the invoice *data* bug is fixed; the display-only cleanup across pages was started as a
  separate background task on the office PC and is NOT reflected here — redo/finish it if those
  off-by-one displayed dates still bother you.
- A manual (non-copy) way to add an assignment-level timesheet line by typing (today it arrives via
  the copy button); optional.

### Moving to another machine (short version)
Install Node 20 (nvm-windows) + pnpm 9 + PostgreSQL 17 (see the 2026-08-10 bring-up notes above);
`git clone`; `pnpm install`; recreate `.env` (`DATABASE_URL`, `AUTH_SECRET`); create the `erp_app`
role + `erp_dev` DB; **restore the data from the `backups/*.dump` transferred out-of-band**
(`pg_restore` as `erp_app`) OR `pnpm exec prisma migrate deploy` for an empty schema; copy `uploads/`
(receipts + documents, gitignored). The `backups/` dumps are gitignored — carry them on a USB/drive,
they don't travel with the clone.

---

## Session update — 2026-08-11/12 (this PC: Microsoft SSO + password toggle + menu/button redesign)

Everything below was built in one session on **this** PC and pushed to `origin/main`. Same
bootstrap caveat — one-time layer; when it conflicts with code, trust the code. This session did
**no schema-behavior changes to existing modules** — it added auth (SSO), one settings toggle, and
a presentation-only menu/button pass.

### Microsoft Entra ID SSO (NEW — sign in alongside credentials)
Single-tenant OIDC login for `@al.routemates.it` M365 accounts, **matched to existing app users by
email** (case-insensitive) — RBAC/role/companyId are preserved from the LOCAL user, never from
Entra. No new users are created by SSO; an Entra identity with no matching active app user is
rejected at the `signIn` callback. No `Account`/session DB tables (still JWT strategy, no adapter).
- **Files**: `src/auth.ts` — provider added **conditionally** (only when
  `AUTH_MICROSOFT_ENTRA_ID_ID` + `..._SECRET` are set), `signIn` callback (gates OAuth to the tenant
  `tid` + an active app user by email; credentials pass straight through), `jwt` callback extended
  with the `account` param so on a `microsoft-entra-id` sign-in it **re-keys `token.sub`/role/
  companyId from the local user by email** (Entra's `user.id` is the Entra `sub`, NOT our user id —
  this re-key is load-bearing, don't remove it). `src/app/login/*` — a **separate**
  `<form action={microsoftLoginAction}>` + submit button ("Sign in with Microsoft"); do NOT collapse
  it into `type="button"` + `formAction` (that renders inert). Adversarial review killed two bugs
  before they shipped: relying on optional Entra claims (`acct`/`xms_edov`) would have locked
  everyone out (dropped); the inert-button form issue (fixed).
- **`.env` (gitignored — recreate on each PC)**: needs three vars for SSO to activate —
  `AUTH_MICROSOFT_ENTRA_ID_ID="2d5d7ba9-7e36-4d60-96d9-a83c6b754735"`,
  `AUTH_MICROSOFT_ENTRA_ID_ISSUER="https://login.microsoftonline.com/7f078d31-3381-4e70-a30e-c24dd9846734/v2.0"`,
  and `AUTH_MICROSOFT_ENTRA_ID_SECRET="<the secret VALUE, not the Secret ID>"`. Tenant ID
  `7f078d31-…-c24dd9846734`, App (client) ID `2d5d7ba9-…-a83c6b754735`, single-tenant ("My
  organization only"). Redirect URI registered in Entra: `http://localhost:3000/api/auth/callback/
  microsoft-entra-id` (add the deployed origin's callback there before going live).
  **SECURITY TODO**: the client secret was pasted into the chat while setting this up — **rotate it
  in Entra** (create a new secret, copy the *Value* column not the *Secret ID*, update `.env`) and
  delete the old one. Without the three vars set, SSO simply doesn't appear and credentials login
  works as before.

### Admin toggle: enable/disable direct password login (NEW — `/admin/settings`)
Lets the owner run **SSO-only** but flip password login back on from inside the app if needed.
- **Model** `AppSetting { key @id, value, updatedAt }` (migration
  `prisma/migrations/20260812100000_app_settings/`) — a generic key/value store; the toggle lives
  under a single key. Applies via `prisma migrate deploy` on a fresh PC.
- **`src/lib/settings.ts`**: `microsoftConfigured()`, `getPasswordLoginSetting()` (default **true**),
  `setPasswordLoginSetting()`, `isPasswordLoginAllowed()`. Password login is allowed if SSO is NOT
  configured (can't lock yourself out before SSO works) **OR** the env override
  `AUTH_ALLOW_PASSWORD_LOGIN=true` is set **OR** the DB setting says so. **Server-enforced**:
  `authorize()` in `src/auth.ts` returns `null` when `!isPasswordLoginAllowed()`, so disabling it
  isn't just UI-hiding. The login form also hides the password fields when disabled.
- **Lockout escape hatch**: if you toggle password off and SSO later breaks, set
  `AUTH_ALLOW_PASSWORD_LOGIN=true` in `.env` and restart — that overrides the DB flag.
- **UI**: `/admin/settings` (gated `users:manage`), confirm-on-toggle, disabled when SSO isn't
  configured. Reachable from the user/app menu.
- **Current state**: password login is toggled **OFF** (SSO-only). That's why the login page shows
  only the "Sign in with Microsoft" outline button and no password fields / no default fill button.

### Menu redesign (presentation only — `sidebar-shell.tsx` + `sheet.tsx`)
Full sidebar rework: collapsible desktop rail + a real mobile drawer.
- **NEW `src/app/(app)/sidebar-shell.tsx`**: stateful client shell owning `collapsed` (seeded from
  cookie `rm_sidebar_collapsed` server-side → no FOUC) and `mobileOpen`. Desktop `<aside>`
  (`hidden md:flex`, width `w-60` ↔ `w-[4.5rem]`), a floating rotating collapse chevron, top/bottom
  scroll-fade masks, a glass mobile top bar (`md:hidden`, hamburger + theme-aware logo +
  ThemeToggle), and a Sheet drawer for mobile nav. `layout.tsx` reads the cookie for
  `defaultCollapsed` and renders `<SidebarShell>` around `children`.
- **NEW `src/components/ui/sheet.tsx`**: edge-positioned Base UI Dialog (Sheet/SheetContent/
  SheetTitle/SheetClose) with `data-closed:hidden` on Backdrop+Popup (the standard Base UI
  stuck-open guard) and a slide-in transition.
- **`sidebar-nav.tsx`** rewritten: string-key `ICONS` registry (icons never cross the RSC boundary
  as components), `collapsed`/`onNavigate` props, brass grow-in active rail, sharp `rounded-sm`,
  `aria-current`, collapsed-state tooltips via `<TooltipTrigger render={link} />`. `user-menu.tsx`
  gained a `collapsed` prop (avatar-only when collapsed) and sharp corners.
- Lint note: `React.useEffect(() => setMobileOpen(false), [pathname])` in `sidebar-shell.tsx` carries
  an intentional `// eslint-disable-next-line react-hooks/set-state-in-effect` — syncing overlay
  visibility to the route is deliberate, don't "fix" it.

### Button color fix (`src/components/ui/button.tsx`)
Default variant changed from brass fill (`bg-primary text-primary-foreground`, which had a poor
text/fill contrast) to **ink-navy on paper**: `bg-foreground text-background hover:bg-foreground/90`
(computed live as `rgb(20,31,43)` bg / `rgb(235,239,241)` text). Applies to every default `<Button>`
app-wide (primary actions: New/Save/Add/etc.). Brass (`--primary` `#a9812f`) is still the accent used
elsewhere (active nav rail, avatars, links). If ink-navy is ever unwanted, it's a one-line revert.

### Open / next (carry-over)
- **Rotate the Entra client secret** (exposed in chat) — see the SECURITY TODO above.
- Still true from prior sessions: deploy online; regenerate INV-0001 for July; the app-wide
  date-display (UTC off-by-one) cleanup; replace Pirelli test data when done exercising flows.

---

## Session update — 2026-08-13 (this PC: invoicing register polish + sales commission)

One session on this PC, focused entirely on the **Invoicing register** (`/invoices`) and its detail/new
pages. Pushed to `origin/main`. One migration added (apply with `migrate deploy` on the other PC).
Same bootstrap caveat — when this doc conflicts with code, trust the code.

### Migration added (applied to erp_dev)
- `20260812130000_invoice_commission` — adds `Invoice.commissionPercent Decimal(5,2)` and
  `Invoice.commissionFixed Decimal(12,2)`. Apply on a fresh/other DB with `pnpm exec prisma migrate deploy`.

### Sales commission discount — now % and/or fixed, any status (the main ask)
- The optional sales-commission discount is stored as a single negative **`InvoiceLine` whose
  description is EXACTLY `"Sales comision"`** (owner's required wording — do not "fix" the spelling,
  do not stuff metadata into that description; it's matched by string in several places). It flows
  through every total (net/VAT/gross), the register, and revenue recognition as a normal line — no
  special-casing in the totals math.
- Entered as a **percentage of the work-line net AND/OR a flat amount** (they combine:
  `discount = base * percent/100 + fixed`, where `base` = net of the non-commission lines). The two
  raw inputs persist on the invoice (`commissionPercent` / `commissionFixed`) so the Edit box
  round-trips and the % recomputes if lines change.
- **New server action `setInvoiceCommissionAction({ invoiceId, percent, fixed })`** in
  `invoices/actions.ts` — recomputes the base, upserts the `"Sales comision"` line when the result
  > 0, deletes it when 0, and stores the raw percent/fixed. **Works in ANY status** (DRAFT / ISSUED /
  RECONCILED / PAID) — only VOID is blocked. This is deliberate: a commission can be agreed after
  issuing, so it is NOT gated to DRAFT like the work-line editor. Const `COMMISSION_DESC` holds the
  exact string (can't be exported from a `"use server"` file, so the client re-uses the literal).
- **Edit dialog** (`invoice-detail-client.tsx`): the commission box is a standalone always-visible
  section (Percent-of-net input + "and/or" + Fixed-amount input + live Comision/Net/VAT/Gross), moved
  OUT of the `{isDraft && …}` line-editor block. On Save it calls `updateInvoiceAction` (work lines,
  DRAFT-only as before) THEN `setInvoiceCommissionAction` (commission, any status). The commission is
  no longer bundled into `linesPayload`.
- **New-invoice form** (`new-invoice-client.tsx`): same two-field commission control, now shown for
  BOTH bases (Manual AND From-approved-time), applied via `setInvoiceCommissionAction` right after the
  draft is created (no longer appended client-side as a raw line).
- Detail read-only lines table annotates the `Sales comision` row with its breakdown, e.g.
  `(5% of net + €100)`.

### Register overview redesign + search/filters
- **`invoices/page.tsx`** (server) now builds serializable rows and renders a new client table
  **`invoices/invoices-table.tsx`** with: a search box (invoice number, fiscal number, client,
  project, amounts), a **Client** filter, a **Status** filter, and a **service-month** picker
  (keeps invoices whose service period overlaps the chosen month), a Clear button, and an "X of N ·
  Filtered net" footer. KPI StatCards (Recognized net / Outstanding / Collected / To reconcile), a
  "Billed by service month" MiniBarChart, and the "Needs reconciliation" worklist stay in the server
  page above the table.
- **Service period** ("date of service") is first-class: `Invoice.periodStart/periodEnd` (already
  existed) is shown on the register (a "Service period" column, full-month → "Jul 2026", else a
  range) and the detail page; editable on New (Manual) + Edit via "Service from"/"Service to" date
  inputs. Parsed/stored at **UTC midnight**, read with UTC accessors (same tz discipline as
  everywhere else).
- Detail header action buttons restyled to consistent outline variants with lucide icons
  (Reconcile / Record payment / Edit / Void / Delete; Void+Delete destructive-tinted).

### Bug fixed this session
- **Project detail → Invoices tab showed 0** for manual/self-billed invoices. The query matched only
  invoices with a **milestone-linked line**; manual invoices carry `projectId` but no milestone line.
  Fixed `projects/[id]/page.tsx` to match `{ OR: [{ projectId }, { lines: { some: { milestoneId
  in … } } }] }`. This also feeds the project's "Invoiced" stat + tab count.

### Open / next (unchanged carry-over)
- Rotate the Entra client secret; deploy online; regenerate INV-0001 for July; app-wide UTC
  date-display cleanup; replace Pirelli test data. Line editing after DRAFT is still delete+recreate
  (no in-place editor beyond the commission box).

---

## Session update — 2026-08-13 (this PC: profile page, users/clients redesign, timesheet nudge)

Built in one session on this PC. Same bootstrap caveat — trust the code over this doc.

### Migration (applied to erp_dev; `migrate deploy` on a fresh DB)
- `20260813120000_user_profile` — adds `User.title/phone/location/bio/avatarUrl` (all nullable). No
  other schema changes this session.

### Self-service Profile (NEW — `/profile`, all roles, in the account menu)
- Users edit **their own** name, title, phone, location, bio — **never** email/password/role (those
  are admin-managed). `src/app/(app)/profile/` (page + `profile-form.tsx` + `avatar-uploader.tsx` +
  `actions.ts`). Actions are self-scoped to `requireUser().id`.
- **Avatar photo upload**: stored under `uploads/avatars/` (gitignored) via the shared
  `receipt-storage` helpers, served through an authed route `src/app/api/avatars/[fileName]/route.ts`
  (same-company check). `User.avatarUrl` holds just the filename; `src/lib/avatar.ts#avatarSrc` builds
  the URL. `InitialsAvatar` is now image-aware (`src` + `size` props; falls back to colored initials)
  — flows into the sidebar user menu (layout fetches avatarUrl), users list, and detail headers.
- New shared `src/components/role-badge.tsx` — color-coded role chips (Admin/Finance/Sales/PM/
  Employee/Contractor), used across profile + users pages.

### Users + Clients redesign (presentation)
- `/admin/users` (list + `[id]` detail) and `/admin/clients` (list + `[id]` detail) redesigned: KPI
  stat rows, hero headers (banner + avatar), role chips, sectioned edit forms. Admin can now also set
  a user's title/phone/location (added to `updateUserAction`).
- **Clients "Opportunities" column**: was "open opportunities" and showed `0` because both existing
  opps are **WON** (a won deal isn't open). Now shows total with an open/won split (`1 won of 1`), so
  it no longer reads as "no opportunities". Open stages = QUALIFYING/PROPOSAL_SENT/NEGOTIATION/
  PENDING_APPROVAL.

### Timesheet nudge (NEW — reminds people who haven't logged time)
Detection + notify, admin-configurable, deployment-agnostic. **No schema change** (config lives in
`AppSetting`).
- `src/lib/timesheet-nudge.ts` — `detectMissingTimecards(mode, opts)`. `daily` = yesterday; `weekly`
  = Mon-of-week…yesterday (today excluded). Skips weekends + Albanian holidays via `isWorkingDay`,
  and any date covered by an APPROVED `LeaveRequest`. Options: `includeContractors`, `excludedUserIds`.
  UTC-day matching (TimeEntry.date is UTC-midnight) — don't "fix" the UTC vs local split in there.
- **Email** `src/lib/graph-mail.ts` — app-only (client-credentials) Microsoft Graph `sendMail`,
  **reusing the existing Entra app reg + secret** (tenant parsed from the SSO issuer). Emails each
  missing person individually. **Requires a `Mail.Send` APPLICATION permission + admin consent on the
  app registration (Azure portal), and `GRAPH_MAIL_SENDER`** (a real tenant mailbox). SSO is delegated;
  this daemon path needs the app-only grant — already coded, just add the permission in the portal.
- **Teams** `src/lib/teams-webhook.ts` — one MessageCard to an Incoming Webhook (`TEAMS_WEBHOOK_URL`),
  listing everyone missing.
- **Entry point** `src/app/api/internal/timesheet-nudge/route.ts` — `POST ?mode=daily|weekly&dryRun&
  force`, gated by `x-nudge-secret` header (constant-time). NOT session-gated. **`src/proxy.ts`** (Next
  16's renamed `middleware.ts` — this is the app's auth guard) had `api/internal` added to its matcher
  exclusion so the route isn't 307'd to /login.
- **Admin config** on `/admin/settings` (now **tabbed**: Sign-in | Timesheet nudge;
  `nudge-settings-client.tsx`). Stored as JSON under AppSetting key `timesheetNudge` (see
  `TimesheetNudgeConfig` in `src/lib/settings.ts`): master enable, per-mode enable, weekly weekday,
  channel toggles, `includeContractors`, `excludedUserIds`, and editable email/Teams **templates**
  (placeholders `{firstName}{name}{dates}{count}{mode}` / `{count}{list}{range}{mode}`). Per-mode
  **once-a-day dedup** via `timesheetNudgeLastRun:*` keys, so a frequent external trigger is safe;
  weekly only fires on the configured weekday. `force=1` bypasses weekday+dedup (not the toggles).
- **Env vars** (in `.env`, gitignored — recreate per PC): `TIMESHEET_NUDGE_SECRET` (generated),
  `GRAPH_MAIL_SENDER` (blank — fill to enable email), `TEAMS_WEBHOOK_URL` (blank — optional).
- **Not wired**: no in-app scheduler. Trigger later with anything that POSTs the URL + header (Vercel
  Cron / GitHub Action / cloud scheduler / OS cron). Verified end-to-end via dry-runs against real
  data (401 on bad secret; daily/weekly detection; exclusion).

### Open / next
- **Add `Mail.Send` (application) + admin consent** in Entra to turn on nudge email; set
  `GRAPH_MAIL_SENDER` / `TEAMS_WEBHOOK_URL`. Still: rotate the Entra secret; deploy; wire the scheduler.

---

## Session update — 2026-08-13 (later: receipt-capture PWA)

Built in the same session. Trust the code over this doc.

### Migrations (applied to erp_dev; `migrate deploy` on a fresh DB)
- `20260813130000_expense_source_capture` — `Expense.source` (`ExpenseSource` MANUAL/CAPTURE, default
  MANUAL) + `Expense.captureData Json?` (raw OCR confidences/line-items).
- `20260813130100_expense_status_draft` — adds `DRAFT` to `ExpenseStatus` (own migration: Postgres
  can't use a new enum value in the same txn it's added). Captured-but-unconfirmed receipts are DRAFT.

### Receipt-capture PWA (NEW — `/capture`)
- Mobile-first standalone route **outside the `(app)` sidebar** (`src/app/capture/`), still auth-gated.
  Big "Capture Receipt" button → `<input capture="environment">`; client-side canvas compress
  (≤2000px, JPEG ~0.8) → POST `src/app/api/capture/route.ts` (session-gated).
- API: saves via existing `saveReceiptFile`, creates a **DRAFT** `Expense` (source CAPTURE) immediately
  (placeholder category = first one, amount 0, company currency), then best-effort Azure OCR, updates
  the draft + `captureData`, returns pre-filled fields. Confirm form (`capture-client.tsx`) reuses the
  expense field set; `confirmCapturedExpenseAction` moves DRAFT → PENDING/APPROVED via the existing
  auto-approval; `discardCapturedExpenseAction` deletes an abandoned draft + its file.
- **DRAFT is excluded** from the `/expenses` list and the CSV export (both filter `status != DRAFT`) —
  drafts live only in the capture flow. Don't remove those filters.
- **Azure Document Intelligence** `src/lib/document-intelligence.ts` — prebuilt-receipt over REST (no
  SDK), graceful: returns null / skips OCR when `AZURE_DOCINTEL_ENDPOINT`/`AZURE_DOCINTEL_KEY` are
  unset, so capture still works (manual entry). Env vars added to `.env` (blank).
- **PWA**: `public/manifest.json` (start_url `/capture`, standalone), minimal no-op-fetch
  `public/sw.js` (installability only, no caching — deliberately, so it can't serve stale authed
  pages), generated brand icons `public/icons/*`, `src/components/pwa-register.tsx`, root-layout
  metadata (manifest/apple-icon/theme-color). **`proxy.ts` matcher now also excludes `manifest.json`
  + `sw.js`** so uncredentialed manifest/SW fetches aren't 307'd to /login (don't remove).

---

## ⚠️ PENDING — not completed / not verified (DISCUSS COSTS FIRST — remind me on next steps)

The user wants to understand costs + discuss internally before switching these on. **When asked about
"next steps", surface this list.**

1. **Azure AI Document Intelligence (receipt OCR for /capture)** — resource **not provisioned**; the
   OCR path is **built but untested against real Azure** (graceful fallback works). TODO: create the
   Document Intelligence resource, set `AZURE_DOCINTEL_ENDPOINT`/`AZURE_DOCINTEL_KEY`, test a real
   receipt. Cost: ~prebuilt-receipt pricing (small for their volume) — see the cost breakdown.
2. **Microsoft Graph email (timesheet-nudge)** — `Mail.Send` **application permission + admin consent
   NOT yet added** in Entra; email path **built but untested**. TODO: add the permission + consent,
   set `GRAPH_MAIL_SENDER`, test. Cost: **$0 incremental** (reuses existing M365/Entra).
3. **Deploy online** — not done. Needs a host (compute), Postgres, a plan for `uploads/` (persistent
   disk vs object storage — local-disk works only on a single VM/persistent volume), domain + TLS,
   env vars, `migrate deploy`, data restore, and a scheduler for the nudge. See the cost breakdown.
4. **Rotate the Entra client secret** (older TODO — was pasted in chat during SSO setup).

Verification status of what IS built this session: typecheck + lint + production build all green;
PWA assets serve (manifest/sw/icons 200); capture flow's authenticated UI + the OCR + the nudge email
could NOT be runtime-verified here (no SSO login available to the agent, no Azure key, no Graph
permission). Treat those three as **"needs a live smoke test once provisioned."**

---

## Session update — 2026-08-17…19 (this PC: finance suite — expenses merge, Taxes, Vendor payments, UAT phases, numbering)

One long session on this PC. Six new migrations (all applied to erp_dev; run `migrate deploy` on the
other PC). Same bootstrap caveat — trust the code over this doc. Everything below typechecks + lints
clean; could NOT be runtime-verified by the agent (SSO-only login), so treat as "needs a live click-through".

### Migrations added (apply with `pnpm exec prisma migrate deploy`)
- `20260817120000_uat_acceptance` + `20260817120100_document_kind_uat` — project-level UAT fields +
  Document.projectId + `UAT_ACCEPTANCE` kind.
- `20260818120000_tax_payments` + `20260818120100_document_kind_tax` — TaxCategory/TaxPayment +
  Document.taxPaymentId + `TAX_NOTICE`/`PAYMENT_RECEIPT` kinds.
- `20260819120000_vendor_payments` + `20260819120100_document_kind_vendor` — Vendor/VendorPayment +
  Document.vendorPaymentId + `VENDOR_INVOICE` kind.
- `20260819130000_internal_numbering` — Opportunity.number + Project.number (unique per company),
  backfilled in creation order.
- `20260819140000_project_uat_phases` — `ProjectUatStatus` enum + Project.uatStatus + ProjectUatEvent
  (history), backfilled (accepted → ACCEPTED + a seeded history event).

### Expenses — categories merged in + redesign (`/expenses`)
- Deleted the separate `/admin/expense-categories` route; category management now lives in a
  **"Categories" dialog** on the Expenses page, **admin-only** (`expenses:manage`). Category CRUD moved
  into `expenses/actions.ts` (returns `{error?}`). Redesigned with KPI StatCards, a by-category donut,
  a monthly bar, category chips, paid-by pills.

### Taxes module (NEW — `/taxes`, admin-only, perm `taxes:manage`)
- Track tax obligations & payments (municipality, advance sales tax, rent, social/health, …). Managed
  **tax categories** (inline dialog). To-pay → Paid workflow; capture tax **period** (primary month
  dimension), amount, **serial/reference #**, authority, due/payment dates, notes. Attach **tax notice**
  + **payment receipt** via DocumentsCard. List has KPIs (Outstanding/Overdue/Paid YTD/this month),
  by-category donut, by-period bar, filters (category/status/month/search), detail page `/taxes/[id]`.
  Seeded categories: Municipality tax, Advance sales tax, Tax on rent, **Social & health contributions**.
  `src/lib/tax.ts` helpers.

### Vendor payments module (NEW — `/vendors`, admin-only, perm `vendors:manage`)
- Accounts-payable: **managed vendor list** + bills. To-pay → Paid; description, invoice/reference #,
  amount, invoice/due/payment dates, **optional project link** (subcontractor bills), notes. Attach
  **vendor invoice** + **payment receipt**. Same KPI/donut/bar/filters/detail pattern as Taxes. Seeded
  one **Accountant** vendor. `src/lib/vendor.ts`. Models Vendor + VendorPayment; project link is
  stored but NOT yet wired into project cost reports (future).

### Internal numbering (`src/lib/numbering.ts`)
- **Opportunity `O-########`** (8-digit), **Project `PR-#######`** (7-digit), unique per company,
  auto-assigned on create (incl. opportunity→project conversion, inside the tx). Derived from current
  max (not a count) so deletes never collide. Shown on both detail headers + list rows (mono).

### Project UAT — now a phased workflow with history (moved to its own tab)
- Was a single accepted-bool card on Overview. Now: **`/projects/[id]` → "UAT" tab**. Phases
  NOT_STARTED → SENT (for signature) → ACCEPTED, plus CHANGES_REQUESTED (re-send). Each transition
  logged in **ProjectUatEvent** (history timeline: who/when/note). `advanceProjectUatAction` replaces
  the old `setProjectUatAction`. `uatAccepted` mirrors ACCEPTED so the header phase-pill + the soft
  invoice-time warning still work. `uat-card.tsx` exports `PhasePill`. Signed acceptance doc attaches
  in the same tab.

### Fixes
- **Currency display**: Taxes/Vendors/Expenses aggregate tiles (KPIs, donut, bars, footer) were
  formatted in the company reporting currency (EUR) while records are in ALL. Now each page formats
  aggregates in the **predominant currency among its records** (and that's the default for a new
  record). Single-currency assumption; mixed-currency would need per-currency breakdowns.
- **Donut center label overlap**: long strings (e.g. `ALL 947,915.00`) overflowed the ring. DonutChart
  now shrinks the center font by length + clamps to the hole. App-wide.
- **Opportunity discount confusion**: discount is a single absolute deal-level value; the Proposal
  history now has a **"Change"** column (incremental Δ vs the previous version) so successive discounts
  (−1500, then −500) read naturally alongside the running total. Contract math was already correct.

### Also
- `docs/DEPLOYMENT_AZURE_SHAREPOINT.md` — full plan to host on **Azure App Service + PostgreSQL** and
  move file storage to **SharePoint via Microsoft Graph** (decided; NOT executed). Azure CLI installed
  on this PC; `az login` done but **no Azure subscription exists yet** (must create a PAYG sub in the
  Routemates Srl tenant before provisioning).
- `start-dev.bat` — double-click launcher for the dev server (sets PATH + `pnpm dev`), since the agent's
  server gets reaped between turns.

### Open / next (carry-over)
- Rotate the Entra client secret; create the Azure subscription then execute the deploy plan; wire
  vendor-payment project links into project cost/margin reports (optional); optional CSV export for
  Taxes/Vendors (like Expenses). Prior items still stand (regenerate INV-0001, replace Pirelli test data).

---

## Session update — 2026-08-20…22 (this PC: PM Delivery Cockpit + milestone completion/adjustments)

One long session. **Nine migrations** (all applied to erp_dev; `migrate deploy` on the other PC).
Two new deps: **exceljs** and **pptxgenjs** (set as `serverExternalPackages` in next.config.ts) — so
`pnpm install` on the other PC after pulling. Typechecks + lints clean; could NOT be runtime-verified
by the agent (SSO-only login) — needs a live click-through.

### The Delivery Cockpit (NEW — `/delivery`, perm `delivery:manage` = PM + Admin)
A PM governance workspace, separate from the finance/Projects module.
- **Overview** (`/delivery`): the PM's projects (managed-only) with RAG health + signals (started,
  team, checklist %, last status, open RAID, UAT). Admin sees all.
- **Per-project cockpit** (`/delivery/[projectId]`): tabs **Status reports · Plan · Checklist · RAID ·
  Minutes · Documents**.
- **Status reports** realigned to the customer's real deck (see the Zambon PPTX): **Progress %**,
  **Severity/Timing** (Low/On time · Medium/Delay · High/Business impact), **Current status**,
  **Next actions** (structured: owner + due + Critical), **Corrective actions**. Exports a **PowerPoint**
  (pptxgenjs, Title→Agenda→Project Status→Project Plan→Q&A) **and Excel** (exceljs). History kept; mark
  sent. Routes: `src/app/api/status-reports/[id]/pptx|export`.
- **Plan**: an editable **Gantt** (`plan-client.tsx`) — WBS table + timeline, phase rollup bars, task
  bars with progress + owner, milestones as diamonds; reorder up/down; "Add standard SAP plan" seeds a
  dated baseline. Feeds the PPTX Project Plan slide. Model `PlanTask` + `PlanTaskStatus`.
- **Checklist**: the company **playbook** (`PlaybookTask`, admin-editable at `/admin/playbook`)
  auto-applied to every new project (`src/lib/playbook.ts#applyPlaybookToProject`, called from project
  create + opportunity→project). Project-level (not per engagement).
- **RAID** (`RaidItem`), **Minutes** (`MeetingMinutes` + action items), **Documents** (extended
  `Document` kinds + accepts Office/email files by extension in the delivery lib).
- **Engagements** (`Engagement`) — **the Tungsten model**: end customers (Zambon, Bonfiglioli, Q8) are
  **cockpit-only** streams under ONE project, **never separate Projects**. An engagement bar switches
  the view; status/plan/RAID/minutes/documents carry an optional `engagementId` and filter to the
  selected engagement (checklist stays project-level). **Important**: an earlier build wrongly modeled
  these as real sub-projects (`Project.parentProjectId`/`endCustomer`) — that was reverted; the two
  ZAMBON shells were converted to engagements under PS – Tungsten Portfolio and the extra Project rows
  deleted. The parentProjectId/endCustomer columns still exist but are unused (project forms no longer
  set them).
- `src/lib/delivery.ts` (labels/RAG/severity), `delivery/actions.ts` (all cockpit CRUD).

### Milestone completion + value adjustments (Pirelli case)
- **Complete a milestone** → dialog captures a **completion note**, **locks time entry**
  (`timeEntryOpen=false`), stamps `completedAt`/`completionNote`, and **recognizes the full fixed-price
  value** even with 0 logged hours (revenue.ts fixed: per-milestone — COMPLETE/INVOICED earn full
  effective value; in-progress earn their own % of completion). Reversible.
- **Value adjustments** (`MilestoneAdjustment`): on the milestone page, "Adjust value" records
  Remove/Absorb amount + reason + **optional link to an Opportunity** (the new PO). Shows Original →
  Adjustments → Effective value with history; effective value flows into revenue (recognized/earned).
  Use for the "Austria self-managed / moved to a new €9.3k intercompany PO" flow.

### RBAC tightening
- **PM sees only their own**: projects they **manage** (`visibleProjectIds` PM branch = managerId), and
  opportunities they **own/submitted** (opportunities list + detail).

### Migrations added (apply with `pnpm exec prisma migrate deploy`)
`20260820120000_delivery_cockpit`, `20260820130000_delivery_status_hierarchy_minutes`,
`20260820130100_document_kind_delivery`, `20260822120000_project_plan`, `20260822130000_engagements`,
`20260822140000_milestone_completion_adjustments` (+ the earlier `20260819140000_project_uat_phases`,
`20260819130000_internal_numbering`, `20260812130000_invoice_commission` from prior sessions).

### Open / next (carry-over)
- Optional drag-to-resize on the Gantt bars (currently edit via row dialog).
- Rotate the Entra secret; deploy to Azure; wire vendor-payment project links into cost reports.

---

## Session update — 2026-09-07 (this PC: in-app notifications, test runner, and the finance-accuracy pass)

One long session. **Six migrations** added (all applied to erp_dev; run `migrate deploy` on another PC).
Adds the repo's **first test runner**. Same bootstrap caveat — when this doc conflicts with code, trust
the code. Typecheck + lint + build + 109 unit tests all green; the UI could NOT be click-through
verified by the agent (staff login is SSO-only), so behaviour was verified by unit tests plus
read-only scripts run against the real `erp_dev` data — see the verification notes per section.

### Migrations added (apply with `pnpm exec prisma migrate deploy`)
- `20260907150000_ticket_notifications` — in-app notification model.
- `20260907160000_company_currency_eur` — sets `Company.currency` to EUR (the reporting currency).
- `20260907170000_assignment_bill_rate` — `Assignment.billRate` + `TimeEntry.billRate`.
- `20260907180000_client_payment_terms` — `Client.paymentTermsDays`.
- `20260907190000_employment_weekly_capacity` — `Employment.weeklyCapacityHours` (default 40).
- `20260907200000_vendor_payment_milestone` — `VendorPayment.milestoneId`.

### In-app notifications + menu fixes
- `src/lib/notifications.ts`, `ticket-notify.ts`, `notifications-actions.ts`,
  `components/notification-bell.tsx`.
- **The bell panel renders through `createPortal` to `document.body`** with fixed positioning and
  viewport clamping — a 320px panel inside a 240px `overflow-hidden` sidebar was being clipped.
  Don't move it back inside the sidebar tree.
- Sidebar shell pinned to `h-dvh` so page scroll no longer drags the menu; nav grouped/collapsible.

### Test runner (NEW — the repo had none)
- **Vitest 5, node environment (no jsdom)**, `vitest.config.ts` with the `@/` → `./src` alias.
  `pnpm test` / `pnpm test:watch`. Tests live in `src/lib/__tests__/`.
- **109 assertions** across revenue, invoice, budget, vacation-calc, fx, wip and capacity.
- Pure helpers extracted from `cost-rate.ts` (`hourlyRateFromMonthly`) to make them testable.
- **Note**: `vitest.config.ts` uses ESM syntax and emits a Vite `configLoader: 'native'` warning on
  every run. Harmless; silence it later by renaming to `.mts` or setting `"type": "module"`.

### Multi-currency reporting (`src/lib/fx.ts`)
- `convertCurrency` / `convertWith` generalize the old EUR-only `convertToEUR`: identity → direct →
  inverse → **triangulation through EUR**. `loadRateResolver` resolves a rate *as of a date*.
- **Every rollup converts at the row's own economic date** (invoice: `recognitionDate ?? issueDate`;
  vendor bill: `invoiceDate ?? paymentDate ?? createdAt`).
- **Rows with no rate are NEVER summed at 1:1 and never silently dropped** — they are collected as
  `ExcludedGroup[]` and rendered by `src/components/fx-warning.tsx`. Keep that contract.

### Bill rate + per-consultant realization
- `Assignment.billRate` snapshots the milestone sales price for T&M/RETAINER (null for FIXED_PRICE),
  editable only with `rates:view:any`. `TimeEntry.billRate` is **frozen at approval** in
  `stampCostRatesForCards`, mirroring the historical cost-rate stamp. **No backfill** — pre-existing
  entries fall back to the assignment snapshot, then the milestone list rate.
- Pure `realizationMetrics` in `revenue.ts`; a "Per consultant" tab on `/revenue`
  (`consultants-tab.tsx`, `src/lib/realization-data.ts`). **Gated on `rates:view:any` at the query
  layer** — do not expose this data through any path that skips that check.

### Unbilled revenue / WIP (`/revenue/unbilled`)
- Pure `wipMetrics` (earned / invoiced / unbilled / overBilled). `src/lib/wip.ts` is the **pure** half
  (grouping, age buckets) and `wip-data.ts` the server half — split because a client component
  importing a `server-only` module breaks the build.
- The detail view groups project → milestone → month with age buckets **0-30 / 31-60 / 61-90 / 90+**
  (inclusive upper edges — 90 is NOT yet "90+"). XLSX export at `/api/revenue/unbilled/export`.
- **`createTimeInvoiceAction` was rewritten**: it now selects entries, creates lines and claims the
  entries **inside ONE transaction**, prices lines at the frozen **bill rate** (hours-weighted
  average, with `amount` as the source of truth), and **refuses to attach an entry already linked to
  a line** (`updateMany ... WHERE invoiceLineId IS NULL`; a short count rolls the whole invoice back).
  That closed a real TOCTOU race where two concurrent invoices could steal each other's time entries.
  Don't "simplify" the guard away.
- `/invoices/new` offers a project's unbilled time on selection, with a one-click "Bill all of it".

### AR aging, overdue and DSO (`/invoices`)
- Pure helpers in `invoice.ts`: `agingBucket`, `daysOverdue`, `dso`, `effectiveDueDate`,
  `countsTowardAR`. **`daysOverdue` is 0 ON the due date** (due today isn't late); buckets have
  inclusive upper edges at 30/60/90.
- Per-client aging matrix + a company total row; StatCards for Outstanding / Overdue / Oldest overdue
  / 90-day DSO. **Outstanding is now signed — credit notes subtract** (it previously added them).
  The duplicate "Outstanding" card was removed from the register KPI row.
- `Client.paymentTermsDays` defaults an invoice's due date at creation and back-fills the aging date.
  Invoices with **neither** land in a **"No due date"** bucket — deliberately never guessed.

### Capacity-aware planner (`/planning`, `/planning/availability`)
- `Employment.weeklyCapacityHours` (default 40) models part-timers and contractors; **a day is
  `weeklyCapacityHours / 5`**, so deductions scale with the contract instead of a fixed 8h.
- `src/lib/capacity.ts` (pure) + `capacity-data.ts` (server). The planner deducts Albanian public
  holidays **and approved leave**, apportioned per week; a holiday inside a leave range is counted
  **once** (as a holiday), because `isWorkingDay` already excludes holidays. `LeaveReturn` days are
  excluded — the person was actually at work.
- `capacityTone(booked, available)` replaces the hardcoded `CAPACITY_PER_WEEK = 40`. Resource rows
  read **`booked / available`** with the deduction spelled out in the tooltip. **A zero-capacity week
  is FULL, not FREE** — nothing to give must never advertise as available.
- **NEW `/planning/availability`** — the bench view: free hours per person per week, a company bench
  total, and filters for week range / role / minimum free hours. Answers "who is free in October".
- Saving a plan **warns without blocking** when a cell pushes someone past their available hours.
- `/my-planning` shares `PlannerGrid` and was wired to the same capacity, or it would have kept the
  old flat-40 colouring.
- **Verified against real data**: Christmas week 2025-12-29 → 24h available (2 holidays), not 40;
  week of 2026-08-10 → Enida and Indri at 8h (4 days' leave each).

### Subcontractor cost in project margin
- `computeProjectRevenue` splits cost into **`internalCost` / `externalCost` / `totalCost`**, and
  **`margin = earned − totalCost`**. `forecastMargin` also carries committed external cost (via
  `forecastTotalCost`) — otherwise the forecast column reintroduces the same inflated margin.
- `src/lib/external-cost.ts` loads project-attributed vendor bills, FX-converted at the bill's own
  date. **Both `TO_PAY` and `PAID` count — committed cost is cost.**
- `/revenue` shows **Internal cost** and **Subcontractor** as separate columns; `/budgets` annotates
  actual cost with `(+X ext.)`; the project page gains an **External costs** card (gated on
  `rates:view:any`, filtered in the query, not the component).
- `VendorPayment.milestoneId` lets a bill be pinned to a milestone (server-validated to belong to the
  selected project) so fixed-price milestone margin is accurate.
- **Verified end-to-end** on real data with a temporary bill that was created, measured and deleted:
  margin moved by exactly −3000 and the row was removed (DB back to its original 1 vendor bill).

### Portal accounts were leaking into staff lists (fix)
- `CUSTOMER` users are customer-portal logins tied to a Client, added in the ticketing session. Every
  page that lists *people who work here* was still selecting them, so they appeared as planner
  resources, proxy time-entry targets, leave/expense owners, delivery-plan owners, headcount, and —
  worst — as **assignable people on the milestone assignment form**.
- Fixed with one shared filter, **`STAFF_ONLY` in `src/lib/permissions.ts`**, applied to `/planning`,
  `/planning/availability`, `/admin/scheduled-vs-actuals`, `/time`, `/vacations`, `/expenses`,
  `/delivery/*/cutover`, `/delivery/*/uat`, the milestone assignment form, `/admin/settings` (nudge
  exclusions), `/admin/users`, and the dashboard headcount.
- **Deliberately NOT applied** to `tickets/page.tsx`, `tickets/board`, and `api/tickets/export`:
  those fetch every user only to build a `nameById` map, and a customer who reported a ticket must
  stay resolvable. Use `STAFF_ONLY` for "who works here", never for name lookups.
- Verified on real data: 10 active users → 8 staff (Fabio Magni and Portal Tester removed).

### Bank charges on invoice payments
- `InvoicePayment.bankFee` (migration `20260907210000_invoice_payment_bank_fee`). **`amount` is the
  cash that reached the account; `bankFee` is what the bank withheld in transit.**
- **An invoice is settled by `amount + bankFee`** — the customer parted with both. `outstanding()`
  counts it that way, so a €1,000 invoice paid as €997 + €3 fee now closes and flips to PAID instead
  of sitting forever showing €3 outstanding. A genuine underpayment still shows as a real balance.
- New pure helpers in `invoice.ts`: `paymentSettles`, `totalBankFees`, `cashCollected` — the last one
  keeps "cash we actually received" distinct from "debt the customer discharged".
- The payment dialog takes the received amount plus the fee and previews what it settles; the
  payments table shows Received / Bank fee / Settled.
- **Not done**: the fee is recorded but not posted as an expense, so it doesn't yet reach company
  margin. Worth wiring into the expense/cost side if the totals matter.

### Open / next (carry-over)
- **Write-off is not a real state**: every euro of approved work is now either unbilled or invoiced,
  but nothing can be explicitly written off (no flag/reason on `TimeEntry`), so aged WIP is only a
  proxy. Add it if the three-way split needs to be genuine.
- **`nextInvoiceNumber` uses `count + 1`** (`invoices/actions.ts`) — deleting an invoice makes the
  next number collide with an existing one. It should derive from max, as `numbering.ts` already does.
- Invoice line editing after DRAFT is still delete + recreate (beyond the commission box).
- Unchanged from before: rotate the Entra client secret; deploy to Azure; regenerate INV-0001 for
  July; replace the Pirelli test data.

---

## Session update — 2026-09-08…10 (this PC: LIVE on Azure, deploy pipeline, and the per-client Support workspace)

**The app is now in production at https://psa.routemates.it.** One migration this session
(`20260910120000_client_team_members`, applied to BOTH `erp_dev` and the Azure `erp_prod` via the
pipeline). Same bootstrap caveat — when this doc conflicts with code, trust the code. tsc + lint +
build + 127 tests green; visibility rules verified by a read-only script against real data.

### Production topology (all in Azure subscription "Routemates PSA", resource group `rm-ops-rg`, region **Italy North**)
- **PostgreSQL Flexible Server `rm-ops-db`** (PG 17, Burstable B1ms, 32 GiB, HA off, ~$20/mo). West
  Europe is blocked for new subscriptions by a Microsoft `sys.blockwesteurope` policy — don't retry it.
  Database **`erp_prod`**, app role **`erp_app`** (owns schema `public`). Public access + firewall:
  "allow Azure services" + the office IP (re-add if the office IP changes).
- **App Service `rm-ops-psa`** (Linux, Node 22 LTS, Basic B1, Always On, ~$13/mo). Runs the Next
  **standalone** bundle (`output: "standalone"` in next.config.ts) with startup command
  **`node server.js`** — NOT `npm start`; the standalone package.json still says `next start` and
  that fails. Real hostname is `rm-ops-psa-dmasfvd5g6afh2c8.italynorth-01.azurewebsites.net`
  ("secure unique default hostname" appends a token; `<name>.azurewebsites.net` does NOT resolve).
- **Custom domain `psa.routemates.it`** → CNAME + `asuid.psa` TXT at **Aruba** (routemates.it's DNS),
  free App Service managed certificate, SNI. `AUTH_URL=https://psa.routemates.it`; the Entra SSO app
  has the redirect URI `https://psa.routemates.it/api/auth/callback/microsoft-entra-id`.
- **Files: Azure Blob** (storage account `rmopsfiles`, private container `uploads`), selected by
  `AZURE_BLOB_SAS_URL` (a **container-scoped SAS URL with `/uploads` before the `?`**). App Service's
  filesystem is wiped on every restart/deploy, so local `uploads/` is dev-only. All 46 existing files
  were copied up with `scripts/upload-files-to-blob.ts --apply`.
- App settings: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_MICROSOFT_ENTRA_ID_*`,
  `AZURE_BLOB_SAS_URL`, `WEBSITE_RUN_FROM_PACKAGE=1`. Set via portal or `az webapp config appsettings set`
  (the portal's Apply silently failed once — verify with `az webapp config appsettings list`).

### Deploy pipeline (`.github/workflows/deploy.yml`)
- **Push to `main` deploys.** Steps: install → prisma generate → **tsc → lint → tests → build** (a red
  check never reaches prod) → OIDC login → **`prisma migrate deploy` against prod BEFORE the code goes
  live** → deploy `.next/standalone` → curl the real hostname until 200.
- Auth is **OIDC federated credential** on Entra app `github-deploy-psa` (subject
  `repo:uardo71/routemates-rm:environment:production`), role **Website Contributor** scoped to the one
  app — no publish password anywhere. GitHub **environment `production`** holds `AZURE_CLIENT_ID`
  (the app registration's client id, NOT the service principal object id), `AZURE_TENANT_ID`,
  `AZURE_SUBSCRIPTION_ID`, `PRODUCTION_DATABASE_URL`.
- **Working loop from now on**: change → test locally against `erp_dev` → push `main` → live in ~5 min.
  `erp_prod` is the real data from here; copy prod→local when realistic data is needed, never the
  reverse. `feature/delivery-suite` was merged into `main` (main had been 9 commits behind).
- Local gotcha that bit twice: **never run `pnpm build` into the same `.next` the dev server uses** —
  the mixed manifest made `/invoices/new` 404. Stop dev, `rm -rf .next`, build, `rm -rf .next`, restart.

### Storage abstraction
- `src/lib/storage.ts`: one interface, two backends (local disk default; Blob REST when the SAS URL is
  set — no SDK, matching `graph-mail.ts`/`document-intelligence.ts`). `receipt-storage.ts` keeps its
  public API (`saveReceiptFile`/`deleteReceiptFile` unchanged at ~30 call sites); serve routes use
  `readReceiptFile` (null ⇒ 404). Path traversal is guarded once, for both backends.

### Fixes shipped this week
- **`LayoutProps<"/">` removed** from `src/app/layout.tsx` — it's generated into `.next/types`, so a clean
  checkout (CI) failed `tsc`. Props are typed explicitly now.
- **Per-consultant revenue was 0** for everyone: bill-rate chain ended in `: 0` and nothing had a frozen
  rate. Pure `effectiveBillRate()` in `revenue.ts` falls back to the milestone — for **FIXED_PRICE that's
  `salesPrice / budgetHours`**, never the lump sum. Used by realization AND the WIP loader.
- **Fixed-price work excluded from time-based WIP** (`TIME_BILLED_TYPES` in `wip.ts`): valuing 148.8h
  against a €9,300 lump sum had produced €1,383,840. FP unbilled value comes from earned − invoiced.
- **Still-to-bill is measured against the register** for every billing type (`command-center.ts`).
  Manually-typed invoices never set `invoiceLineId`, so linkage-based counting double-counted (98h on
  Mindsquare were both invoiced and "unbilled"). `linkTimeEntriesToInvoice` now attaches approved time
  to manual invoices on create/update (project + service period, whole entries only, oldest first).
  **`scripts/link-manual-invoice-time.ts` backfills existing invoices — dry-run done (29 entries /
  92.5h), `--apply` NOT yet run.**
- **Time grid "Hours without a task"**: an assignment-level line can now be typed by hand (needed to
  reverse approved hours with a negative line on a task-bearing milestone).
- **Milestone rows show the deal discount** (Michele's feedback): list value/rate struck through, with
  the post-discount figure — via shared pure `contractValueScale()` used by both the Revenue report and
  the project page. Fixed price only; revenue math was already correct, only the display wasn't.

### Support workspace — per-client tickets, DevOps-style (the big feature)
- **`ClientTeamMember`** (`clientId`, `userId`, `role` LEAD|MEMBER, unique per pair). The AMS team for
  an account. **Membership is the access gate, and it RESTRICTS non-admins** (owner's explicit choice):
  - `assignedClientIds(user)` → `"ALL"` for ADMIN, else the clients they're on.
  - `visibleTicketWhere(user)` is now **async**: admin sees all; everyone else sees their clients'
    tickets **plus anything they raised/are assigned/created** (safety net — nothing vanishes).
  - `canManageClientTickets(user, clientId)` gates every triage action; `tickets:manage` alone no
    longer does (or the scoping would be cosmetic). All 13 role gates in `tickets/actions.ts`, the
    detail page (404 not 403 when off-team), the attachment route and saved views were converted.
  - **EMPLOYEE/CONTRACTOR have no role permissions at all**, so membership is the ONLY way they get to
    work a queue. Staffing is admin-only (`users:manage`) because it grants access.
  - Migration **seeded** so nobody lost access on day one: Admin/Finance/Sales/PM onto every client that
    existed, plus anyone already on a client's tickets. New clients start with an empty team.
- Routes: **`/tickets` = clients overview** (card per client: open / breached / unassigned / critical /
  resolved-7d / team / last activity, busiest first; company KPI row); **`/tickets/c/[clientId]` =
  workspace** (stat tiles, the queue locked to that client, Team card, client switcher, New ticket
  pre-filled via `?clientId=`); **`/tickets/all`** = the old flat cross-client list. Board/settings unchanged.
  Sidebar "Support" group: Clients overview / All tickets / Board.
- **Columns are sortable by clicking headers** (arrow indicator); `sortRows` falls back to the column's
  display text so custom "cf:" fields sort too. `TicketsClient` gained `lockedClient` + `embedded`.
- Team management UI: `client-team-card.tsx` on the workspace and on `/admin/clients/[id]`.
- Verified on real data: Iljona (EMPLOYEE, on Pirelli) sees Pirelli's 2 only; Borana sees Tungsten's 1;
  unstaffed employees see 0; PM Enida (seeded onto all 4) and Admin see all 3.

### Open / next
- **Run the invoice backfill**: `pnpm exec tsx scripts/link-manual-invoice-time.ts --apply`.
- **Secrets exposed in chat during setup, still to rotate**: the Blob SAS (valid to 2035),
  `AUTH_SECRET`, and the old Entra client secret (delete it now that SSO works on the new one).
- Timesheet nudge still has no scheduler; `Mail.Send` consent still not granted.
- **Contingency on quotes** (Michele): model estimate + contingency, discount consumes contingency first,
  estimate-vs-actual accuracy — needs a requirements conversation (and the controller) before building.
- Vitest config `configLoader` warning; `nextInvoiceNumber` count+1 collision; write-off not a real state.

---

## Session update — 2026-09-10 (later: notification service + operational alerts)

One migration (`20260910130000_notifications`, applied to erp_dev; the pipeline applies it to prod on
deploy). tsc + lint + build + **151 tests** green. The UI tab and the endpoint could NOT be
click-through verified (SSO-only); the rules are covered by unit tests, the runner by a dry-run path.

### Notification channel (`src/lib/notify.ts`)
- `notify({ subject, html, recipients, teamsTitle?, teamsText?, channels? })` is THE fan-out: Graph
  mail per recipient (a recipient may carry its own subject/html — the nudge personalises per
  person) + one Teams post. **Channels are isolated**: every send is wrapped, so one address bouncing
  or the webhook being down never stops the other channel. `*Configured()` guards live here.
- The timesheet nudge route now calls it. **No behaviour change** — same gates, same dedup, same JSON
  response shape (`notifications.email.{configured,sent,errors}` / `teams.{configured,status}`).
- `src/lib/internal-auth.ts` — the shared-secret gate (`x-nudge-secret` = `TIMESHEET_NUDGE_SECRET`),
  extracted from the nudge route and reused by `/api/internal/alerts`. One secret for all internal
  routes, on purpose.

### Sent-alert ledger (`Notification` model)
- `(kind, targetId, payloadHash)` is UNIQUE — that constraint IS the "never send the same alert
  twice" guarantee. The runner **claims the row before sending** (insert; P2002 ⇒ someone else has
  it) so two overlapping runs can't both send, and **deletes the claim if nothing was delivered** so
  tomorrow retries. `channel`/`recipient` are a comma-joined summary of the fan-out, for audit.
- `Opportunity.poValidUntil` added (same migration) — the PO *expiry*; `poDate` is the issue date.
  Editable on the opportunity's SoW/PO card.

### Rules (`src/lib/alerts/rules.ts`, pure; config in `alerts/config.ts`, runner in `alerts/run.ts`)
- **Predicates are Prisma-free** and take `(data, ruleCfg, isSent)`; `isSent` makes suppression
  testable in the predicate, the DB unique is the hard layer beneath. The `payloadKey` defines "the
  same alert": a threshold in the key ⇒ once per threshold; a date in the key ⇒ re-fires if moved.
- `project_budget` — approved hours vs `budgetHours` AND internal cost (historical rate, EUR) vs
  `budgetAmount`, each crossing 80/100% (configurable). Once per (metric, threshold) → PM.
- `invoice_overdue` — ISSUED/RECONCILED with outstanding > 0, ≥1/14/30 days past `dueDate` (≥, so a
  missed day still fires once) → `invoices:manage` holders.
- `approval_stale` — SUBMITTED timecards (→ approver, else `timesheet:approve:any`) and PENDING
  expenses (→ `expenses:manage`) waiting > 3 days. Once per item.
- `expiry` — ACTIVE assignment `endDate`, and WON opportunity `poValidUntil`, within 30 days
  (inclusive both ends) → PM + the person / owner, de-duplicated.
- `milestone_overdue` — `endDate` < today and not COMPLETE/INVOICED (due *today* is not overdue) → PM.
- **`/api/internal/alerts`** (`POST ?dryRun&force`) runs every company; **idempotent per day** via
  AppSetting `alertsLastRun` (set only when something was sent, so an empty day can re-run); `force`
  bypasses the day marker but never the ledger.
- **Admin UI**: `/admin/settings` → **Alerts** tab — master/email/Teams toggles, per-rule enable +
  thresholds, and **"Preview today's alerts"** (dry run through the real runner, sends nothing).
  Config key `alerts` in AppSetting, deep-merged onto defaults (`mergeAlertsConfig`).

### Open / next
- **Wire a scheduler**: one daily `POST https://psa.routemates.it/api/internal/alerts` (and the two
  nudge modes) with the secret header — GitHub Actions cron is the zero-cost option.
- Email still needs `Mail.Send` app permission + consent and `GRAPH_MAIL_SENDER`; Teams needs
  `TEAMS_WEBHOOK_URL`. Until one is set the runner reports `noChannel` and records nothing.
- Everything from the earlier 2026-09-08…10 entry still stands (invoice backfill `--apply`, secret
  rotations, contingency-on-quotes conversation).

---

## Session update — 2026-09-10 (later: audit log)

One migration (`20260910140000_audit_log`, applied to erp_dev; the pipeline applies it to prod on
deploy). tsc + lint + build + **166 tests** green. The trigger was proven on erp_dev (UPDATE and
DELETE on `AuditLog` both raise); the UI could NOT be click-through verified (SSO-only).

### Model (`AuditLog`) — append-only by construction
- `{ id, companyId, entityType, entityId, action, actorId, at, summary, diff Json }`, indexes
  `(entityType, entityId, at)` and `(companyId, at)`. **No FK to User on purpose**: deleting an actor
  must never cascade into or null out an audit row. Actor names are resolved at read time
  ("Deleted user" when gone).
- **A DB trigger rejects UPDATE, DELETE and TRUNCATE** on the table (`audit_log_immutable()`), so no
  application path — including Prisma — can rewrite history. There is deliberately no admin action
  that touches rows. Don't add one.
- `diff` holds `{ label, parent?, fields }`: `fields` is the `{ field: { from, to } }` map, `label`
  the human handle used in the summary (invoice number, milestone name, person), `parent` the record
  whose History card should list the entry (an invoice line → its invoice, a milestone → its
  project). `loadAuditFor` queries by entity OR by `parent` (Json path filter), so removed lines and
  payments still show on the invoice they belonged to.

### Code
- **`src/lib/audit-diff.ts` (pure, tested)**: `diffFields(before, after, fields?)` normalises
  Decimal (duck-typed `toNumber`, no Prisma import) and Date, skips `id/createdAt/updatedAt/
  companyId/passwordHash`, ignores relations/Json blobs, and lists only set values on create /
  existing values on delete. `isMoneyField(name)` matches money by name
  (`amount|price|rate|cost|fee|value|salary|commission|margin`, minus `…Hours/Date/Type/Id/…`), so a
  new money column on an audited model is **redacted by default rather than leaked by omission**.
  `redactDiff` keeps "changed" but hides values (`•••`); `summarize` builds the one-liner.
- **`src/lib/audit.ts` (server)**: `recordAudit(tx, { entityType, entityId, action, actor, before,
  after, fields?, label?, parent?, note? })` — takes the caller's **transaction client**, so the row
  commits or rolls back with the change. An update with no field change writes nothing.
  `presentAudit` / `loadAuditFor` / `loadAuditLog` apply **rates:view:any redaction at the query
  layer**; the stored summary carries real amounts, so a redacted reader gets a summary rebuilt from
  the redacted diff. `parseAuditFilter` is shared by the page and the export.
- **Wired inside existing transactions** (array `$transaction`s were converted to interactive ones;
  writes that had no transaction were wrapped in one): every invoice lifecycle/edit/commission/
  delete action, invoice lines (per-line create/update/delete in the edit dialog), payments
  (create/edit/delete + the PAID flips they cause), milestone create/update/status/time-entry
  toggle/adjustments, assignment create/update (cost + bill rate), salary add/delete, employment
  upsert/delete, timecard approve/reject (`decideApprovalsAction`), leave decisions (both branches —
  `provisionLeave` gained an `onApproved(tx, before, after)` hook so the admin direct-insert path
  audits too), expense decisions, every opportunity stage change (incl. proposal issue, submit,
  recall, lost, reject, WON + the Project/Milestone rows created on conversion), amendments
  (milestones grown/created + the project's contract fields), and `updateProjectAction`.
- **Derived cost rate is audited too**: `recomputeEmploymentCostRate(userId, onChanged?)` runs its
  update in a transaction and calls the hook when the rate actually moved — the callers record an
  `Employment.costRate` entry. `cost-rate.ts` itself does NOT import `audit.ts` (it is imported by
  unit tests and scripts, which cannot load `server-only`); the hook pattern keeps it that way.
  Same reason `vacation.ts` uses a hook instead of importing `recordAudit`.
- **UI**: `src/components/audit-history-card.tsx` (server component) — "History" card on the
  invoice, project (Overview tab, after External costs) and opportunity pages. **`/admin/audit`**
  (new permission **`audit:view`**, ADMIN only; "Audit log" under Admin in the sidebar): entity /
  actor / date-range / summary-search filters as plain GET params, latest 500 rows, and
  **Export XLSX** at `/api/admin/audit/export` (same query string, one row per changed field,
  same redaction).

### Not audited (on purpose, out of scope)
Planner hours, assignment status/end-date drags, ticket workflow, delivery cockpit CRUD, time-entry
saves, document uploads, settings. Add `recordAudit` inside their transactions if they ever need it.

### Open / next
- Everything from the earlier 2026-09-10 entries still stands (scheduler secret `NUDGE_SECRET` on
  GitHub, channel config, invoice backfill `--apply`, secret rotations, contingency-on-quotes).

---

## Session update — 2026-09-11 (cutover plans + UAT scripts per end customer, people on engagements)

One migration (`20260911100000_cutover_plans_uat_scripts_engagement_members`, applied to erp_dev; the
pipeline applies it to prod). tsc + lint + build + 166 tests green; access rules proven by a script
on erp_dev (see below). Owner's report: a cutover plan built for BEKO (an end customer under the
Tungsten portfolio project) showed at project level, and only ONE cutover plan / UAT script could
exist per project — no way to have one per phase or per end customer.

### What changed
- **`CutoverPlan` and `UatScript` are first-class containers.** Many per project; each optionally
  belongs to an `Engagement` (end customer). `CutoverTask`/`CutoverList` carry `planId`;
  `UatArea`/`UatTestCase`/`UatIssue` carry `scriptId`. The DRAFT → READY → SENT governance moved
  from `Project.uatScriptStatus/uatScriptSentAt` (dropped) onto each `UatScript`.
  `CutoverTask.engagementId` was dropped — the editor never set it, which is why BEKO's plan looked
  project-level. The migration backfilled one "Cutover plan" / "UAT test script" per project that
  had any rows and attached everything to it. **BEKO's plan is now a project-level plan named
  "Cutover plan" — rename it and move it to BEKO from the plan's "Rename / move" button.**
- **Routes**: `/delivery/[projectId]/cutover` and `/uat` are now LISTS grouped by end customer
  (`runbook-list-client.tsx`, shared by both kinds: create, rename, move to an end customer, delete);
  the editors moved to `/delivery/[projectId]/cutover/[planId]` and `/uat/[scriptId]`. Exports are
  `/api/cutover/[planId]/export` and `/api/uat/[scriptId]/export` (title + filename carry the end
  customer and the plan/script name). `/cutover` and `/uat` list every plan/script across the user's
  projects, grouped by project. The cockpit's "UAT scripts" / "Cutover plans" buttons and the two
  readiness banners carry `?eng=` so the list preselects the end customer for "New".
- **`EngagementMember`** — people assigned to an end customer, managed from the engagement bar
  (Add dialog, a "people" chip beside the selector, and the Manage panel). `setEngagementMembersAction`
  replaces the set; only active staff are accepted. Access rules (`src/lib/permissions.ts`):
  - `canAccessProjectDelivery` and `visibleProjectIds` now also pass for engagement members, so a
    consultant assigned only to BEKO can open the project's cutover plans / UAT scripts.
  - `engagementScope(user, projectId)` → `"ALL"` for whoever manages the project and for people on
    the whole project through a milestone assignment; otherwise the engagement ids they are members
    of. Plan/script lists, the editors, the cross-project indexes and the create/update actions all
    filter by it (project-level items are always in scope). It is a scoping rule, not an access gate.
  - Cockpit signals (cutover readiness, "UAT script not sent") are computed over the plans/scripts of
    the selected end customer ("Overall" = all). Delivery overview aggregates across all of them.
- Deleting an engagement keeps its plans/scripts (they fall back to project level) — same rule as
  status reports / RAID / minutes.

### Verified on erp_dev (script, cleaned up after)
Borana (EMPLOYEE, not on the Pirelli project): no delivery access → assigned to an engagement →
access true, scope = that engagement only, project visible in her lists; a second plan created on the
same project (2 plans); deleting the engagement left the plan with `engagementId = null`.

### Not done
- Engagement members are not yet shown on the Delivery overview cards or used for "Responsible"
  defaults inside the cutover grid.
- The UI could not be clicked through (SSO-only login).

### Follow-up the same day — documents that create entries, plan deletion, end-customer focus
Migration `20260911110000_document_cutover_kind_and_links` (applied to erp_dev; prod via the pipeline).
tsc + lint + build + 170 tests green.
- **"Cutover plan" is a delivery-library document type** (`DocumentKind.CUTOVER_PLAN`).
- **A "Meeting minutes" or "Status update" file creates its entry.** `uploadDeliveryDocumentAction`
  now, in the same transaction, creates a `MeetingMinutes` (title from the file name, date parsed from
  it — `src/lib/doc-naming.ts`, pure + tested — else today) or a `StatusReport` (seeded from the latest
  report in the same scope so the overview keeps its health/progress until the PM edits it), and links
  the file through `Document.minutesId` / `Document.statusReportId` (SetNull: the file outlives the
  entry). The Minutes / Status updates cards show the attached file with a paperclip.
- **Plan deletion**: a per-row trash icon in the plan grid, and a "Delete plan" button that removes
  every task in the current scope (`clearPlanAction`) — status updates, minutes, documents untouched.
  Status updates and minutes already had per-row delete.
- **Cockpit buttons follow the viewed end customer**: "UAT scripts" / "Cutover plans" carry `?eng=`;
  the list then shows only that end customer's runbooks ("Showing BEKO only · Show all"), and when
  there is exactly one it redirects straight into the editor.

### Follow-up — Portfolio moved out of the cockpit toggle (`/portfolio`)
No migration. tsc + lint + build + 170 tests green. Owner's report: the "Overview" (customer cards)
inside the delivery cockpit was hidden behind a view toggle and unusable at 100+ customers.
- **`/portfolio`** is its own page and sidebar entry (Delivery group, under "Delivery cockpit"), with
  a "Portfolio →" shortcut in the My Day header. `/delivery` is now purely My Day.
- **Cards → a dense triage table** (`portfolio-client.tsx`), worst health first: summary strip where
  every chip is also a filter (Red/Amber/Green, Status due, Tasks overdue) plus All / Needs
  attention; sortable columns (Health, Workspace, Customer, Progress, Last status, Issues, Overdue);
  "Group by client" with collapsible sections; search; sticky header; filters/sort mirrored to the
  URL with `replaceState` so they survive opening a workspace and coming back.
- **`src/lib/delivery-home.ts`** holds the shared data model (one Prisma pass → day items, stats,
  upcoming, workspace rows) so `/delivery` and `/portfolio` can never disagree on RAG / "status
  due". The cockpit's back link reads `?from=portfolio` (legacy `from=overview` still accepted).
- Built in a separate chat/worktree, reviewed and merged here; the UI was not clicked through.

### Follow-up — legacy local-midnight dates repaired; audit values expandable
Migration `20260911120000_normalize_date_only_columns_utc` (applied to erp_dev; prod via the pipeline).
- **Root cause of the "dates changed by themselves" audit rows**: date-only columns written while
  the app ran on the UTC+2 office PC were stored at LOCAL midnight (22:00 UTC of the previous day),
  read back one day early, and re-saved as UTC midnight — so an unrelated edit logged
  `issue date 2026-08-09 → 2026-08-09`. The migration shifts every date-only column whose value is
  exactly 22:00:00 or 23:00:00 to UTC midnight of the intended day (56 columns; `AssignmentPlan` and
  `TimeEntry` guard their unique keys with NOT EXISTS). Real timestamps are untouched.
  `invoices/actions.ts#parseDate` now parses `YYYY-MM-DD` at UTC midnight, so it cannot recur.
  Production runs in UTC, so new writes there were already correct.
- **Audit UI**: long text values (notes, descriptions) show a 40-char preview with "show full" that
  expands to the complete before/after in place — History card and `/admin/audit` share `FieldLine`.

---

## Session update — 2026-09-11 (skills & certifications; end customers can be completed)

Two migrations (`20260911130000_skills_certifications`, `20260911140000_engagement_status`; applied to
erp_dev, prod via the pipeline). tsc + lint + build + **183 tests** green. UI not clicked through
(SSO-only).

### Skills & certifications (Prompt 12) — staffing starts from a filter
- **Model**: `Skill { companyId, name, category }` (`SkillCategory`: SAP_MODULE / TECHNOLOGY /
  LANGUAGE / INDUSTRY / METHODOLOGY; unique per company+name), `UserSkill { userId, skillId, level
  1–5 (DB CHECK), lastUsedYear }`, `Certification { userId, name, issuer, issuedDate, expiryDate,
  documentId? }` — the certificate file is a `Document` of the new kind `CERTIFICATE` (served by
  `/api/documents/[fileName]` to the owner, `users:manage` and `people:search`).
- **Permissions**: `skills:manage` (ADMIN) for the catalogue; `people:search` (ADMIN, PM, SALES)
  for Find people / matrix / read-only person pages.
- **Pure `src/lib/skills.ts` (tested)**: `matchPeople(people, requirements, { minFreeHours })` —
  full matches first, then fewest missing, then Σ level, then free hours; `parseRequirements` /
  `serializeRequirements` (URL form `skillId:minLevel,…`, default min 3); `skillCoverage` (gap =
  MISSING when nobody is at 3+, SINGLE when one person); `certificationStatus` (EXPIRING within 90
  days inclusive). `STARTER_SKILLS` is the one-click SAP-practice seed.
- **Pages**: `/profile` gains Skills (level dots, last-used year) + Certifications (file attach)
  cards — self-service only (`profile/skills-actions.ts`, always scoped to the caller).
  `/admin/skills` — catalogue CRUD + "Add SAP starter set". `/people` — Find people: required
  skills with a minimum level each + a window (start, weeks, min free hours) using
  `src/lib/availability-data.ts#loadAvailability` (same booked/available arithmetic as
  `/planning/availability`); one URL answers "who can do a DRC rollout in French from October".
  `/people/matrix` — people × skills heatmap with gap columns highlighted. `/people/[userId]` and
  `/admin/users/[id]` show the read-only `SkillsSummary`.
- **Alert**: `certification_expiry` rule (default tiers 90 and 30 days, key = expiry date + tier so
  a renewal restarts; never fires once expired) → the person + `users:manage`. Configurable on the
  Alerts settings tab.

### End customers can be completed; a closed project reads as completed
- `Engagement.status` (ACTIVE / COMPLETED) + `completedAt`; "Mark completed" / "Reopen" beside the
  Viewing selector and in the Manage panel (`setEngagementStatusAction`). **The umbrella project's
  status is untouched** — BEKO can be done while the Tungsten portfolio stays open.
- `WorkspaceRow.completed` = project COMPLETED/CANCELLED or engagement COMPLETED. Done workspaces:
  no status-due nudges, no day items, no upcoming, rag GREEN with label "Completed"/"Cancelled";
  the Portfolio hides them by default behind a "Completed (N)" chip; the cockpit shows a neutral
  Completed pill instead of the RAG and suppresses the attention/UAT/cutover banners.
- Fix: the "← Portfolio" back link survives tab switches and end-customer switches (`?from=portfolio`
  is kept by `tHref` and the engagement bar's `keepParams`).

### A1 · Wave 1 defects (delivery cockpit) — five commits, 2026-09-11
Two migrations (`status_report_drop_next_steps`, `project_track_overall_status`). 190 tests green.
1. **Issues tab** (`raid`): `RaidClient` was never rendered and My Day's issue nudges deep-linked to a
   missing tab. Label `Issues (n)` = non-closed items in scope; new entries default to ISSUE; search
   box; "Open only" default filter (other RAID types remain in the type filter).
2. **Status-report fields**: `accomplishments` and `decisionsNeeded` are in the editor, the card,
   the Excel and the PPTX (status slide shrinks the status box / splits the bottom strip when they
   exist). `nextSteps` dropped — structured actions cover it. `reportData()` no longer nulls them.
3. **Three RAG dimensions**: schedule/budget/scope selects ("Same as overall" until changed —
   stored equal to overall when following), three small pills on the card and the PPTX severity
   card, and health everywhere = `worstRag(overall, schedule, budget, scope)` (pure, tested).
4. **Silent exemptions**: `WorkspaceRow.tracking` = TRACKED / ADHOC / OFF. "Ad-hoc — not tracked"
   and "Programme level — not tracked" tags on the cockpit hero and the Portfolio row.
   `Project.trackOverallStatus` (toggle in Manage end customers) makes a programme's Overall scope
   customer-facing for status chasing; Overall then always appears as a workspace row.
5. **Plan/PPTX**: Gantt paginated at 30 rows per slide ("Project Plan (i/n)"); phase progress is
   duration-weighted (`phaseProgress`, inclusive days, plain average when any task has no dates),
   shared by the plan grid and the deck; `paginate` helper. Both pure + tested in `src/lib/delivery.ts`.

### A2 · Wave 2 — Actions register (2026-09-11)
Migration `20260911170000_action_owner_user`. 197 tests green. Build green. Not clicked through (SSO).
- **Owner link**: `ownerUserId` (+ `ownerUser` relation, SetNull) on `PlanTask`, `RaidItem`,
  `StatusReportAction`, `MeetingActionItem`; free-text `owner` stays for client-side people. The
  migration **backfills** by exact, case-insensitive, trimmed name match against ACTIVE users of the
  same company, skipping ambiguous names; on erp_dev it linked 19 of 20 (one abbreviated "Sindi" left
  as text). `scripts/report-action-owners.ts` prints linked vs text-only per source (needs the
  server-only shim on NODE_PATH). `StatusReportAction.done/doneAt`, `MeetingActionItem.doneAt/createdAt`
  added (createdAt backfilled from the minutes' date so age is honest).
- **Editors**: `src/components/owner-combobox.tsx` — free text plus a list of active staff; picking
  stores name + id; typing an exact name links too (`resolveOwner`). Used in the plan dialog (the
  inline row keeps a datalist input that links on exact match), RAID dialog, status-report actions,
  meeting actions. Server side, `validOwners()` only keeps ids that are active staff of the company.
- **`/actions`** (Delivery menu, everyone): `src/lib/actions-register.ts` (pure: one row shape,
  `enrichAll` with age/overdue, worst-first order, filters, sort, summary — tested) +
  `actions-register-data.ts` (server: `actionScope` — delivery managers see the projects they manage,
  admins all, everyone else only their own; `loadOpenActions`; `completeActionAtSource`: RAID →
  CLOSED, meeting/status action → done+doneAt, plan task → 100%/COMPLETED; owner or project manager
  only). Filters mine / unassigned / overdue / project / source / search, sortable columns, inline
  done tick, XLSX at `/api/actions/export` with the same query string.
- **Cockpit Overview** gets an "Actions" card (open actions in scope, worst-overdue first, top 6,
  link to the register); **My Day** header shows "N my actions" (`DayStats.myActions`, counted
  cross-project by `countMyOpenActions`).

### A3 · Wave 3 — status updates that write themselves (2026-09-11)
No migration. 202 tests green. Build green. Not clicked through (SSO).
- **"New status update" seeds from the latest report in scope** (`seededDraft` in
  `status-reports-client.tsx`): cadence, overall + schedule/budget/scope RAGs, last progress %, and
  every action still open or closed after that report's date (`actionsToCarry`, pure) — carried rows
  are boxed with a "carried" badge. Summary, accomplishments, corrective actions, decisions and
  notes start blank.
- **Period auto-fill** (`defaultPeriod`, pure + tested): weekly = 7 days ending on the report date;
  monthly = day after the previous period (else the 1st) → report date; ad-hoc = continues from the
  previous period when there is one. Follows cadence/report-date changes until the PM edits the
  period by hand (`periodTouched`).
- **"This period" panel** (read-only, debounced `periodHoursAction`): approved hours in the period
  split by person, plus cumulative approved hours vs `Project.budgetHours`. Source of truth is ONE
  loader: `loadApprovedEntries()` in `src/lib/realization-data.ts`, now shared by the per-consultant
  realization and `approvedHoursForPeriod()` (hours only — no rates — so PMs may read it). Time is
  logged per project, so an engagement's figure is its project's figure (said so in the UI). The
  same line goes on the PPTX status slide (under the stat cards) and into the XLSX meta rows.
- **Plan-vs-report warning** (`progressMismatch`, > 15 points, never blocks): "The plan says 40% —
  is the report right?" under Progress %, using duration-weighted `phaseProgress` of the tasks in scope.
- `DAY_HINT.NO_STATUS` / `STATUS_DUE` coaching text now describes exactly this flow.

### A4 · Wave 4 — delivery alerts + Monday digest (2026-09-11)
No migration. 215 tests green. Build green.
- **One definition of "due"**: `src/lib/delivery-signals.ts` (pure) — `statusChase` (due strictly
  past one cadence; tier 2 strictly past two; never-reported ⇒ due at once, tier from the project
  start; ad-hoc / non-customer-facing / done ⇒ never), `overduePlanTasks`, `overdueRaidItems`,
  `highOpenRaidItems`, `overdueActions`, `goLiveReadiness` (UAT window ≤ 30 days or UAT started;
  cutover due ≤ 14 days or on acceptance; urgent ≤ 3), `isoWeek` / `isoWeekday`. `delivery-home.ts`
  (My Day + Portfolio) now calls these instead of its inline copies, and so do the alert rules.
- **Rules** (`alerts/rules.ts`, config + meta + merge in `config.ts`, data via
  `alerts/delivery-data.ts`): `status_overdue` (keys `<lastReportDate|first>:x1` / `:x2` → PM),
  `plan_slipping` (key = due date, per task → PM + `ownerUserId`), `issue_overdue` (key = due date →
  PM + owner; HIGH/CRITICAL also `users:manage`), `golive_readiness` (keys `uat:<uatStatus>` and
  `cutover:<goLiveDate>` → PM), `delivery_digest` (one per PM per ISO week on the configured weekday,
  default Monday; sections status due / overdue tasks / issues past due / go-live ≤ 14 days, deep
  links built from `AUTH_URL`). Completed engagements and closed projects are excluded at load time.
- Alerts settings tab lists the five new rules (digest weekday select); the dry-run preview covers
  them because it runs the real runner.
- **Scheduler**: `.github/workflows/daily-jobs.yml` (added in the Prompt 8 follow-up) already POSTs
  `/api/internal/alerts` and both nudge modes at 06:00 UTC on weekdays with `NUDGE_SECRET`. It is now
  documented in **`docs/RUNBOOK.md`** (auth, idempotency, channels, manual dry run, troubleshooting).
  The repository secret `NUDGE_SECRET` must equal the app setting `TIMESHEET_NUDGE_SECRET`; a 401 in
  the workflow log is the signal it is not set.


---

## Session update — 2026-09-11 (fix: absorbed milestone value inflated the other milestones)

Owner's report: on PR-0000006 (Pirelli, fixed price) every milestone showed a post-discount rate
and value HIGHER than list (€62.50/h struck through, €65.21/h; €11,500 → €11,999.44). The contract
value is €185,000 = Σ list, and one milestone had €7,700 absorbed onto another PO. The deal scale
was `contractValue / Σ(list + adjustments)` = 185,000 / 177,300 = 1.043 — the absorbed money
resurfaced as a premium on everything else, in the project page, the Revenue report and the
Command Center's unbilled view alike.

- **Fix**: the scale denominator is the LIST total, before adjustments, everywhere
  (`revenue.ts computeProjectRevenue`, `projects/[id]/page.tsx dealScale`, `command-center.ts`,
  the last now via the shared `contractValueScale`). Model: `contracted = (list + adjustment) ×
  contractValue / Σ list`. Recording an adjustment never changes `contractValue`, so the contract
  is measured against list; an absorbed amount simply leaves the earnable total. Pirelli now earns
  €177,300 when fully delivered, and no milestone is shown above list.
- Tests: the earlier "negative adjustment" test encoded the bug (it dropped the contract value by
  the adjustment); replaced with the Pirelli case plus a combined discount + adjustment case.

### A5 · Wave 5 — a plan that means something (2026-09-11)
Migration `20260911180000_plantask_owner_effort_baseline` (applied to erp_dev; prod via the pipeline).
236 tests green. Build green. Not clicked through (SSO).
- **Schema** (`PlanTask`): `estimatedHours Decimal(8,2)`, `milestoneId` → Milestone (SetNull),
  `taskId` → Task (SetNull; narrows actuals to one task of that milestone), `baselineStart`,
  `baselineEnd`, `dependsOnId` → PlanTask (self-FK, SetNull, finish-to-start). `ownerUserId` already
  existed from A2.
- **Pure `src/lib/plan-schedule.ts` (tested)**: `wouldCreateCycle` (self + transitive + stored loops),
  `cascadeShift` (BFS over dependents, each moved once, undated sides stay undated), `finishDelta`
  (push = change of the DUE date; a start-only resize pushes nobody), `slipDays` (due − baseline end),
  `planSlip` (latest due − latest baseline end over baselined tasks; null when none), `formatSlip`,
  `weightedProgress` (effort when every task has an estimate > 0, else duration when every task is
  dated, else plain count — never mixes bases; milestones ignored), `planActualHours`.
  `delivery.ts#phaseProgress` now delegates to `weightedProgress`, so the grid, the PPTX Gantt, the
  print/PDF plan and the status editor all show the same number.
- **Baseline**: "Set baseline" on the plan header (`setPlanBaselineAction`) freezes current dates for
  every dated task in scope WITHOUT a baseline; audited on the Project ("Plan baselined (N tasks)").
  It never overwrites — a second click ("Baseline N new") only baselines tasks added since. Drags and
  edits (`updatePlanTaskAction`) never write baseline columns. Grid: Slip column (`+N d` rose /
  `−N d` green), phase slip, a thin ghost bar (or dashed diamond for gates) at the baseline position.
- **Dependencies**: "Starts after" in the edit dialog (options that would loop are not offered; the
  server refuses them anyway). `updatePlanTaskAction` moves every downstream task by the same delta in
  the same transaction and returns the shifted rows; the grid shows them and a 10-second toast with
  **Undo** (`setPlanDatesAction` restores exact dates for the moved task and its dependents, no
  cascade). A link icon on the task name shows the predecessor.
- **Actuals**: "Time logged on" milestone (+ optional task) and "Estimated hours" in the dialog. The
  cockpit page sums APPROVED `TimeEntry` hours by (milestoneId, taskId); the Actual / est. column
  shows `12 / 40h` with a bar (rose when over). Hours only — no rates.
- **Portfolio**: `WorkspaceRow.slipDays` = `planSlip` of the workspace's plan; sortable "Slip" column.
- **Status editor**: a new update's Progress % is prefilled with the plan's weighted % (the last
  report's figure only when there is no plan), with a "Suggested from the plan — weighted by …" hint.

### Fix — manual invoices billed per task (Neptune / Mindsquare) looked unbilled (2026-09-11)
No migration. Owner's report: `/revenue/unbilled` showed Neptune SME at 46h / €2,300 (July) and
−20h / −€1,000 (August) although every hour was invoiced — Mindsquare is billed one invoice per
task, each line named after the task ("[P019912] Systemservice …", 25.5h).
- **Three linker defects** (`linkTimeEntriesToInvoice`): it ignored the task on the line (oldest
  entries of the milestone, any task — P020571 time sat on the P019912 invoice); it re-ran on every
  edit without counting what was already linked (INV-0012 held 46h on a 25.5h line); and it never
  linked negative corrections, so +4/−4 planning pairs left the −4 behind as negative "unbilled".
  July's four invoices predated the linker and the old backfill was never applied on prod.
- **Pure `src/lib/invoice-time-link.ts` (tested with the real July/August data)**: `resolveLineTask`
  (the task's `[code]` in the line description, else its name with or without the code; ambiguous ⇒
  none), `buildUnits` (assignment × task × day, net; a later-day correction folds into the latest
  earlier day of the same stream), `netZeroEntryIds`, `allocateUnits` (task lines take their task's
  units while they fit → untagged units fill the period's remaining room in date order, carrying
  over between lines so the PERIOD total is exact → lines naming no task take leftovers that fit).
- **`src/lib/invoice-time-link-db.ts`** (not server-only, shared with the script):
  `relinkInvoicePeriod(db, projectId, periodStart, periodEnd, { apply })` re-matches every non-void
  invoice of the project with that exact service period; lines created from approved time
  (milestone-tied and linked to exactly their quantity) are never touched; the rest are cleared and
  re-matched in one transaction. `relinkForInvoice` is the live hook (invoice create + edit).
- **Unbilled view** (`wip-data.ts`) drops entries whose unit nets to zero.
- **Prod repair: NOT yet applied.** A dry run against prod shows 31 entries to re-link across July
  and August, leaving both periods at 0h unbilled (July exact per period, within one day per invoice
  — a logged day can't be split between two invoices). Apply with
  `DATABASE_URL=<prod> pnpm exec tsx scripts/link-manual-invoice-time.ts --apply`; it saves the
  previous links to `backups/relink-*.json` (gitignored) before writing.

### Actions register — save ticks, keep completed actions visible, completed list (2026-09-11)
Migration `20260911190000_action_completion_tracking` (applied to erp_dev; prod via the pipeline).
252 tests green. Build green. Not clicked through (SSO).
- **Owner's ask**: ticking an action closed it instantly and it vanished. Now ticks are STAGED: the
  row crosses out with an amber "unsaved" ring, a save bar (Save / Discard, plus a leave-page
  warning) applies them all at once (`saveActionChangesAction` → `setActionsDone`, all or nothing
  after per-item permission checks). Saved completions stay in the Open view, crossed out, for the
  visit; unticking a completed action stages a reopen (issue → Open, status/meeting action → not
  done, plan task → 0% / NOT_STARTED).
- **Open / Completed / All** views (`ActionView`, `filterActions({ view, pinned })`), sortable by
  completion time; Status column shows "Completed <date> · <who>". Scope unchanged: admins all,
  project managers their managed projects, everyone else their own. Export honours `view` and adds
  Completed on / Completed by.
- **Schema**: `PlanTask.completedAt/completedById`, `RaidItem.completedAt/completedById`,
  `StatusReportAction.doneById` + `carriedFromId` (self-FK, SetNull), `MeetingActionItem.doneById`.
  "By" columns are plain ids (no FK) so history survives a deleted user. Backfill: completed plan
  tasks / closed issues get `updatedAt`; carry chain linked by same text in the previous update.
- **Every close path records who/when**: plan grid/dialog (`planCompletion`), issue dialog
  (`raidCompletion`), register, status and minutes editors (`doneFields(completionChange(...))`).
  `completionChange(wasDone, wantDone)` is the one pure rule (tested).
- **Two existing bugs fixed on the way**: the status-update editor did not send `done`, and both it
  and the minutes editor deleted + recreated every action on save — so editing a report reopened its
  completed actions and reset their age, and minutes re-stamped `doneAt` on every save. Both editors
  now update actions IN PLACE by id.
- **Carried status actions appear once**: a new update's carried rows point at the action they
  continue (`carriedFromId`, keeping its age and, if done, its completion); the register, the
  cockpit Actions card and "my actions" count only the newest copy (`carriedTo: { none: {} }`).

### Fix - unbilled view hid July behind August's corrections; "Re-match with invoices" button (2026-09-11)
No migration. 253 tests green. Build green.
- **Bug in the netting shipped with the Neptune fix**: `wip-data.ts` cancelled corrections using the
  UNBILLED entries only. Neptune's August +4h planning copies sit (wrongly, old linker) on an invoice,
  so their -4h corrections looked orphaned and `buildUnits` folded them back into Indri's last July
  days - the page showed July at 26h/14 entries instead of 46h/20. The netting now loads every
  APPROVED entry of the same assignments (invoiced or not) before deciding what cancels. Tested with
  the real July/August shape.
- **`/revenue/unbilled` -> "Re-match with invoices"** (`invoices:manage` only, `rematch-button.tsx` +
  `revenue/unbilled/actions.ts`): previews, then applies, `relinkInvoicePeriod` for every manual-
  invoice billing period of the company - the same routine as `scripts/link-manual-invoice-time.ts`
  and the live create/edit hook. This is the in-app way to run the Neptune repair (still NOT applied
  on prod by the agent; a dry run shows 31 entries across July and August -> 0h unbilled).

### Prompt 6 - Project lifecycle: gating, Prepare for Delivery, closure gate, hygiene worklist (2026-09-11)
Migrations `20260911200000_project_readiness_fields` and `20260911200100_project_lifecycle_closure`.
`ProjectStatus` is the state machine - no second stage field.
- **Pure `src/lib/project-stage.ts` (tested)**: `TRANSITIONS` / `checkTransition` / `allowedTransitions`
  (PLANNED -> ACTIVE|CANCELLED; ACTIVE -> ON_HOLD|COMPLETED|CANCELLED; ON_HOLD -> ACTIVE|CANCELLED;
  COMPLETED -> ACTIVE admin only; CANCELLED -> PLANNED admin only), `entryBlock` / `entryChangeBlock`
  (only ACTIVE takes new time; internal projects exempt; approved time never re-validated; a cell is
  judged only when its hours change, and clearing to 0 is always allowed), `invoiceBlock` (PLANNED and
  CANCELLED refused; ON_HOLD and COMPLETED still invoice), `readinessChecks`, `closureChecks`
  (status fresh = within 30 days inclusive), `gateDecision` (all green, or admin + written reason).
- **One status path**: `projects/lifecycle-actions.ts#changeProjectStatusAction` - legality, gate,
  override fields, `recordAudit` inside the transaction. Closing cascades: every milestone's
  `timeEntryOpen` -> false and every ACTIVE assignment -> CLOSED, one audit row each.
  `writeOffMilestoneAction` / `undoMilestoneWriteOffAction` (`Milestone.writtenOffAt/ById/Reason`).
  The edit form no longer sets status; new projects start PLANNED (internal ones ACTIVE).
- **Gate wired into**: `time/actions.ts` save (per changed cell, vs stored entries) and submit,
  both invoice create paths, `planning/actions.ts` save, and the pickers: time page (pickable only on
  ACTIVE/internal), `/planning` + `/my-planning` (non-active rows shown greyed + read-only only when
  they carry plan hours; tooltip = status), planner project filter. **Expenses have no project link in
  the schema, so there is nothing to gate there** - if an expense ever gets a project, call
  `entryBlock` in `createExpenseAction`.
- **Readiness fields**: `Project.sponsorContactId` (FK Contact, SetNull), `poWaived` + `poWaivedReason`,
  `activationOverrideReason/At/ById`; closure: `uatNotApplicable`, `closureOverrideReason/At/ById`.
  Edit form gained sponsor (from the client's contacts), SoW, PO, PO waiver; every gate/hygiene fix
  link lands on `#field-<name>` with a `target:` ring.
- **Project page**: lifecycle buttons (legal moves only) open the Prepare for Delivery / closure dialog
  with green/red checks, fix links, UAT-not-applicable and unbilled-acknowledge ticks, inline
  milestone write-off, and the admin override (reason required). "Started with override" badge while
  the readiness checks still fail; "Closed with override" on a completed project. A banner says why
  time entry is closed. `?lifecycle=start` opens the start dialog (hygiene link).
- **Day-one backfill** (in the closure migration): non-internal PLANNED/ON_HOLD projects with approved
  time in the last 60 days -> ACTIVE, each logged in `AuditLog` with actor `system` (shown as
  "System"). COMPLETED/CANCELLED are deliberately left alone. On prod the dry query found nothing to
  change (every project with recent time was already ACTIVE; Pirelli Intercompany is COMPLETED with
  approved time on 2026-08-17 and stays COMPLETED).
- **Hygiene** `src/lib/hygiene.ts` (pure, tested) + `hygiene-data.ts` loader: won deal not started,
  active no PO/waiver, active no end date, on hold with no open issue, no status ever, status older
  than 30 days, milestone past end not complete, all assignments ended but milestone open for time
  (milestone-level, to avoid one item per person), approved time with no budget hours, client with no
  sponsor on any live project, active with no manager. Surfaced on `/portfolio` (Hygiene card, chip
  per check filters the table, list with Fix links), in My Day (`HYGIENE` kind, "Data hygiene" group,
  INFO), and the `hygiene_weekly` alert (per PM per ISO week; unmanaged projects -> admins).

### Fix - audit history showed raw ids for linked records (2026-09-11)
No migration. The History card showed `sponsor contact id — → cmsq4lbh…` after setting a sponsor.
`audit-diff.ts` now knows which fields point at another record (`REFERENCE_FIELDS`: sponsor, manager,
owner, client, project, milestone, task, end customer, opportunity, invoice, the "…by" user fields)
and labels them by what they are; `presentAudit` resolves the ids to names (company-scoped, projects
and opportunities as "number name", a vanished record as "(deleted)") when the history is READ, so
old entries read right too. Rebuilt summaries keep their note (`summaryTail`, legacy wording aware).

### Change requests: a gated lifecycle with no SLA; any attachment on tickets (2026-09-11)
Migration `20260911210000_change_request_lifecycle`. A ticket of type `change_request` is a CR.
- **Stages = the type's statuses** (keys are load-bearing): evaluation → development → unit_testing →
  uat → go_live → closing → closed, plus rejected. The migration rewrote the existing type per company
  (submitted/under_review → evaluation, approved/scheduled → development, implemented → go_live; old
  statuses deleted once empty; admin-added statuses kept after the lifecycle). Prod had 3 CRs, all
  "Submitted" → Evaluation. The seed (`DEFAULT_TICKET_CONFIG`) matches.
- **No SLA**: `TicketTypeDef.slaExempt` (true for CRs; a "No SLA" tick on any type in ticket settings,
  which clears or re-applies existing tickets' deadlines). Every deadline write goes through
  `sla.server.ts#slaDeadlines(…, slaExempt, base)` — create (staff + portal), priority, client or type
  change. Null deadlines already drop out of breach counts, SLA pills and the board.
- **Pure `src/lib/change-request.ts` (tested)**: `CR_STAGES` (purpose, owner, the next steps that get
  each stage done), `crMoveKind` (forward one stage at a time; back to any earlier stage; reject from
  any open stage; reopen Closed → Closing, Rejected → Evaluation), `exitChecks` (evaluation: assessment
  + estimate > 0 + customer approval name and date; development: assignee + planned go-live; unit
  testing: results or a file filed under Unit testing; UAT: sign-off name and date; go-live: date;
  closing: Resolution written), `decideCrMove` (back/reject/reopen need a reason; reject/reopen and
  overriding red checks are the client team's call — `canManageClientTickets`; people only on the
  ticket can move forward when green and send back), `timeInStages`, `nextStepState`.
- **Status can't be set directly on a CR** — the status menu, board drag, `setTicketStatusAction`,
  `applyWorkflowAction` and the portal all refuse with `CR_MOVE_ONLY`; moves go through
  `tickets/cr-actions.ts#moveChangeRequestAction` (ticket status + `ChangeRequestStageEvent` + an
  activity line with the note/override, one transaction, participants notified).
- **Models**: `ChangeRequest` (1:1 ticket: assessment, estimate h, quote ref, approval by/on/ref,
  planned go-live, transports, unit test results/date, UAT sign-off by/on/notes, go-live date, next
  step + owner (plain id) + due) and `ChangeRequestStageEvent` (append-only: from/to/move/note/override/
  by/at). `startChangeRequest` writes both when a ticket is created as, or changed into, a CR.
- **Ticket page**: a Lifecycle panel (stepper with time per stage, "Now: <stage>" with its purpose and
  steps, the checks to move on, Move / Send back / Reject / Reopen dialog, next step with owner/due and
  an overdue flag, stage history); the CR record replaces the SLA card and saves with the ticket's Save
  (moves are disabled while there are unsaved changes); header shows stage · time · "no SLA".
  Client workspace shows "N change requests in flight" by stage and overdue next steps.
- **Attachments, every ticket**: a Files section lists every file (added there or in the discussion);
  CR files are filed under a stage (`TicketAttachment.stageKey`, re-filable). Any type is accepted except
  programs/scripts (`src/lib/file-types.ts`, tested), 25MB a file, 45MB a batch. The serve route shows only
  images/PDF inline; everything else downloads as octet-stream with `nosniff`, so an uploaded HTML/SVG
  can't run in the app's origin. `serverActions.bodySizeLimit` → 50mb and **`proxyClientMaxBodySize` →
  50mb** — proxy.ts made Next buffer only 10MB and pass a silently truncated body on.
- Not done: CR next steps aren't in the Actions register or alerts yet; the portal shows the stage name
  only (no stepper); CR billing (estimate → quote/amendment) is not linked.

### Portfolio: attach project plans (any file type) (2026-09-11)
No migration. Owner's ask: attach project plans from the Portfolio, any attachment type.
- **Delivery library takes any file** except programs/scripts (`attachmentError` in `src/lib/file-types.ts`,
  25MB a file) — the old extension allow-list refused MS Project `.mpp`, Primavera `.xer` and the like.
  `uploadDeliveryDocumentAction` accepts several files at once (`files`, or the legacy `file` field); a
  Minutes / Status update kind still creates one entry per file; stored files are removed if the
  transaction fails.
- **Portfolio "Plan" column**: the workspace's newest "Project plan" file (link), `+N` to the Documents
  tab for the rest, and an **Attach** button (`portfolio/attach-dialog.tsx`: type defaults to Project plan,
  several files, drag and drop) that uploads into that workspace — the project or the end customer's
  stream. `WorkspaceRow.planFiles` comes from `delivery-home.ts`; project-level plan files make a
  programme's "Overall" row appear, like any other project-level item.
- `/api/documents/[fileName]` now serves only images/PDF inline; everything else downloads as
  octet-stream with `nosniff` (same rule as ticket attachments).

### Support redesign — Phase 0.5: data-correctness fixes (2026-09-11)
Migration `20260911220000_ticket_field_archive` (additive: `TicketFieldDef.archivedAt`, `archivedById`).
The owner is redesigning Support in phases with strict rules (plan + file list before edits, stop
before migrations, fix only the named items, every refusal names what and why). This phase:
1. **Custom fields are archived, never deleted.** `deleteFieldAction` stamps `archivedAt/By`; values
   stay. `loadTicketConfig` keeps archived fields out of `types[].fields`/`globalFields` (so out of
   settings lists, both new-ticket forms, the ticket's editable fields, the change-type dialog and the
   "Add column" picker) and returns them as `archivedFields` for display only: the ticket page and the
   portal (customer-visible ones) show existing values read-only with an "archived field" tag; a saved
   list column already using one reads "Name (archived)" (`customColumnsOf` in `serialize.ts`); Excel
   too. Settings lists them read-only under "Archived (N)"; editing an archived field is refused.
   `applyFieldValues` only loops live fields, so a save never touches archived values.
2. **Workspace export pins the client by id** (`clientIds: [lockedClient.id]`).
3. **People and clients match by account id**: `TicketRow` carries `requesterId/assigneeId/clientId`;
   "Assigned to me" / "Raised by me" compare ids; assignee/client filters store ids. Views saved with
   names are translated on read by pure `normalizeFilters` (filters.ts) — no DB write; a shared name
   keeps all its accounts, a vanished name keeps matching nothing (`missing:` sentinel).
4. **Refused assignee/priority changes are reported**: `applyWorkflowAction` returns `rejected`
   (`WORKFLOW_REJECTION` in `lib/ticket.ts`); the ticket page toasts each. Save order unchanged.
5. **Create keeps the restriction but says what it didn't keep**: `createTicketAction` redirects with
   `?dropped=requester,assignee&why=team|noclient`; the ticket page shows `createDropNotices` in a
   dismissible banner. (Due date was never dropped — the server always saved it.)
6. **Internal tick refused → told**: `addCommentAction` returns `notice: INTERNAL_NOTE_REFUSED`; the
   composer toasts it (portal never offers the tick).
Tests: `src/lib/__tests__/ticket-filters.test.ts`.

### Support redesign — Phase 1: two lifecycle modes (STATUS and STAGE) (2026-09-12)
Five migrations, each applied and committed on its own; the owner authorised them one at a time.
- **A `20260911230000_ticket_lifecycle_modes`** (schema, additive): `TicketLifecycleMode` enum;
  `TicketTypeDef.lifecycleMode` (default STATUS) + `slaApplicable` (backfilled `NOT slaExempt`;
  slaExempt stays as an unread legacy column — the duplication objection is recorded in the schema);
  `TicketStageDef` / `TicketStageGate` / `TicketGateCheck`; `TicketFieldDef.stageId`; `Ticket.stageId`;
  `TicketStatusDef.archivedAt/archivedById`. Stage and gate `key`s are stable slugs — seeds and code
  resolve by them. Nothing reads any of it yet.
- **B `20260912090000_bug_stage_mode_seed`**: Bug → STAGE. Stages Triage (starting) · In progress ·
  Fix verification · Closed (terminal); gates Reproduced + Severity set (Triage), Fix verified in test
  environment; Severity/Environment/Steps moved onto Triage; slaApplicable false.
- **C `20260912091000_bug_tickets_to_stages`**: Bug tickets map by status CATEGORY — DONE/CANCELLED →
  Closed, everything else → Triage — and the Bug status list is archived (never deleted), so a ticket
  still shows its old status read-only and switching the type back restores it. No-op today (0 bugs).
  `scripts/migrate-bug-stage-mode.ts` dry-runs exactly this.
- **D `20260912092000_change_request_stage_set`**: CR's 7 stages + 9 gates as rows, its record as 14
  stage-scoped `TicketFieldDef`s, and existing `ChangeRequest` column values COPIED into
  `TicketFieldValue` (skips empty, never overwrites). CR → STAGE, each ticket's stage set from its
  status key. CR statuses are deliberately NOT archived yet: its code still writes a status on every
  stage move. "Rejected" has no stage (agreed gap) — status stays its truth there.
- **E `20260912093000_rollback_plan_general_panel`**: corrects D. Stage-scoping "Rollback plan" would
  have hidden it, since the panel renders a fixed set of values; it stays on the general panel until
  the redesigned stage panel can render arbitrary stage fields.
- **Panel plumbing swap (no UI change)**: `src/lib/change-request-fields.ts` (pure, tested) is the one
  mapping draft key ↔ field key; `change-request.server.ts#crDraftFrom/loadCrDraft` builds the panel's
  values from stage-scoped field values; `cr-actions.ts` writes them through
  `ticket-fields.ts#applyValuesForFields` (new export) and keeps only the next step on the
  `ChangeRequest` row. The old columns are left untouched, unused, so it is reversible.
  `loadTicketConfig` now splits `types[].fields` (general panel) from `types[].stageFields`, so
  stage-scoped fields never appear on the general panel, the new-ticket form or column pickers.
- Still to come in Phase 1: the generic stage panel/stepper/gate checklist UI (STAGE types other than
  CR have no stage UI yet), resolvedSlaPolicy surfacing, portal-ticket notifications to the client
  team, settings editors for stages/gates, and archiving CR's statuses once nothing writes them.

### Support redesign — Phase 1: the generic stage UI (Bug runs on stages in the app) (2026-09-12)

**No migration** — this is the UI and wiring over the stage rows migrations A–E already created.
tsc + lint + build + **381 tests** green. Not clicked through (SSO-only login), but walked end to end
against real `erp_dev` data by `scripts/walkthrough-bug-stages.ts` (see below).

- **Baseline first**: `src/lib/__tests__/change-request-panel-render.test.ts` (+ its snapshot) was
  committed on its own, BEFORE the refactor, capturing the Change request panel's markup exactly as it
  rendered. After the extraction it still passes — the panel's HTML is byte-identical. It stays as the
  regression guard on that panel; re-run it after touching anything under `tickets/[id]`.
- **`src/lib/ticket-stages.ts` (pure, tested — 19 cases)**: the DB-driven sibling of
  `change-request.ts`. `sortStages` (order, ties by key), `startingStage`, `nextStage`,
  `earlierStages`, `closeTarget` (the terminal stage as an early escape — **null when the terminal
  stage is already the next one**, because then closing IS the gated forward move), `reopenTarget`
  (the last open stage before a terminal one), `stageMoveKind` (FORWARD one at a time / BACK to any
  earlier / CLOSE into a terminal from anywhere / REOPEN), `gateChecks` (a gate is green only when
  someone ticked it), `decideStageMove` (forward needs every gate ticked or the support team's written
  override; back, close and reopen each need a reason; close and reopen are the team's call),
  `stageTimes`, `STAGE_MOVE_ONLY`.
- **The stage-move ledger is `ChangeRequestStageEvent`** for every STAGE-mode type. Its name is
  historical — no column on it is change-request-specific — and reusing it keeps one history table and
  needs no migration. Renaming it needs one, so it waits for the next authorised migration.
- **`loadTicketConfig`** now loads each type's `stages` (with gates and their ids), and exposes
  `lifecycleMode` + `slaApplicable`. **Archived statuses are split out** (`statuses` = live,
  `archivedStatuses` = retired) exactly like archived fields, so a retired list leaves every status
  dropdown, board column and filter. `initialStatus` falls back to the archived list: a STAGE-mode
  ticket still needs a `statusId` (the column is required), and carrying one the old list recognises is
  what keeps the type reversible. New: `isStageMode`, `initialStage`.
- **`slaApplicable` is now the flag the code reads** (create, priority change, type change, portal
  create). The legacy `slaExempt` is still written in step by the settings form so the two can't
  disagree.
- **`tickets/stage-actions.ts`**: `moveTicketStageAction` (rules → `Ticket.stageId` + a stage event +
  an activity comment + participant notification, one transaction) and `setGateCheckAction` (tick or
  untick a gate of the ticket's **current** stage only). A move into/out of a terminal stage also
  **keeps the legacy status in step with the open/closed sense** (`statusForStage`), so everything that
  counts tickets by status category — lists, the client overview, SLA — still reads a stage ticket right.
- **Direct status setting is refused for a STAGE-mode type** (`setTicketStatusAction`,
  `applyWorkflowAction`, `setPortalStatusAction`) with `STAGE_MOVE_ONLY`, mirroring `CR_MOVE_ONLY`.
- **`tickets/[id]/stage-lifecycle.tsx`** is the extracted panel both lifecycles draw: stepper with
  time in stage, the current stage's purpose/steps, the checks to move on, an optional sidebar, stage
  history and the move dialog. It renders; it does not decide. `CheckList` gained an optional
  `onToggle` — hand-ticked gates render as buttons, computed checks render exactly as before.
  `change-request-panel.tsx` is now a model-builder over it (its own rules unchanged);
  `tickets/[id]/stage-panel.tsx` is the generic one, plus `TicketStageFields` — the stage-scoped
  fields grouped under their stage, riding the ticket's own draft and Save (that is why Bug's
  Severity / Environment / Steps, moved onto Triage by migration B, are reachable again).
- **Create paths**: a new ticket of a STAGE-mode type gets `stageId` = the starting stage and a START
  event — staff (`createTicketAction`) and portal (`createPortalTicketAction`) alike; changing a
  ticket's type moves it onto the new type's starting stage, or off stages entirely.
- **Settings** shows a STAGE-mode type's stages and gates **read-only** (the stage/gate editors are
  still to come) plus its retired statuses, so the Workflow column isn't simply blank for Bug.
- **`scripts/walkthrough-bug-stages.ts`** (`--apply` to write): reads Bug's real stages and gates,
  drives them through the pure rules and makes exactly the writes the actions make. Run live on
  `erp_dev`: 30/30 checks pass. It left **TKT-00000005 "[walkthrough] Stage-mode Bug"** alive, in
  Triage, both gates ticked, with a real stage history — open it to click the UI. Re-running reuses
  that ticket rather than piling up.

**Known gaps (unchanged or new, all deliberate)**: a company seeded fresh today still gets Bug in
STATUS mode — the stage sets come from migrations, not the seed, so `isStageMode` requires
`stages.length > 0`; the portal shows a stage name only (no stepper); stage/gate settings editors,
`resolvedSlaPolicy` surfacing, portal-ticket notifications to the client team, and archiving CR's
statuses once nothing writes them are all still to come.

### Support redesign — Phase 1 item 11: portal-raised tickets notify the client's team (2026-09-12)

No migration. A ticket raised from the customer portal told nobody: on a portal ticket the requester
IS the customer, so `notifyTicketParticipants` had no staff recipient and the queue only showed it to
whoever happened to look.

- **`ticket-notify.ts#notifyClientTeam`** — a sibling of the existing fan-out, same table, same bell,
  no new pathway: recipients are the client's `ClientTeamMember`s whose user is still active, minus
  the actor, written with one `createMany`. **Empty team falls back to the company's active admins**
  (owner's call: a ticket with nobody watching defeats the feature); the return value says who was
  told and whether the fallback fired.
- **One call site**, at the end of `createPortalTicketAction` before the redirect, with
  `kind: "CREATED"` / `summary: "raised a ticket from the portal"`. Staff creation is untouched, so it
  still notifies only a new assignee. `src/lib/__tests__/ticket-notify-wiring.test.ts` asserts that
  single call site structurally — wire it into a staff path and that test fails.
- **`scripts/verify-portal-notify.ts`** (`NODE_PATH=scripts/shims pnpm exec tsx …`) calls the real
  helper against real local data and cleans up after itself. Run on erp_dev: Fabio Magni (Pirelli) →
  Enida, Iljona, Uard; Portal Tester (Tungsten) → Borana, Enida, Uard; customer never notified;
  staff-created ticket → 0; a team-less client → the admins. 8/8 checks passed.
- **`scripts/shims/server-only/`** — new: the shim maintenance scripts need to import server modules
  (`report-action-owners.ts` already documented needing one; there wasn't one in the repo).

### Support redesign — Phase 1 item 10: SLA policy source, and slaApplicable finally gates the UI (2026-09-12)

No migration. The resolution order (client override > company policy > built-in default) already
existed in `resolveSlaTargets` and every STORED deadline already followed it — but nothing displayed
it, and one screen bypassed it entirely.

- **`sla.ts#pickPolicy` (pure, tested)** is now the single statement of the order, with
  `SlaSource`/`SLA_SOURCE_LABEL` ("Client override" / "Company policy" / "Built-in default").
  `sla.server.ts#resolvedSlaPolicy` returns `{ targets, source }` in one query; `resolveSlaTargets`
  delegates to it, so display and calculation cannot drift. `companySlaPolicies` feeds screens that
  re-resolve per client in memory.
- **The new-ticket form was the bug**: its priority dropdown read the hardcoded `SLA_HOURS`,
  ignoring the company policy, the client override AND the client picked in the form. It now shows
  the resolved targets for the chosen client (the client select became controlled so it re-resolves
  as you change it) and names the source underneath.
- **The ticket page** shows the source as a chip beside the SLA card's target line. The card's
  numbers were always right — they are derived from the ticket's own stored timestamps.
- **`slaApplicable` gates SLA everywhere**: no SLA card, no header pill, no list pill, no board pill,
  and a no-SLA type can never be counted "breached" (overview tile, workspace tile, and the breached
  focus all skip it). `TicketRow.slaApplicable` carries the flag; `slaState` returns hidden for it.
  This is what stops Bug tickets showing deadlines.
- **No deadline is recalculated.** No `slaDeadlines` call changed. Bug tickets keep their stale
  stored deadlines in the database — hidden, unused, reversible. A live SLA a client is being
  measured against cannot move because of this change.
- **Before/after** (`scripts/sla-source-before-after.ts`, temporary override on Pirelli, removed
  again): new-ticket form for Medium went from `respond 8h · resolve 3d` (built-in, wrong) to
  `respond 1h · resolve 4h (Client override)`; Tungsten with no override still reads the built-in
  default and says so; Pirelli's stored ticket deadlines were identical before and after, and its Bug
  ticket displays no SLA at all.
- Flag: the stage pill's "· no SLA" text is unchanged, by request.

### Support redesign — Phase 2: the stage panel and the SLA badge, restyled (2026-09-12)

No migration, no logic change: rendering only. The stage-move and gate-check actions, the loaders
and the SLA resolution from item 10 were not touched. tsc + lint + **399 tests** green.

- **The accent decision, settled — do not re-litigate.** The owner's mockup used a teal brand colour
  on a warm ground. Support keeps the app's own **brass** (`--primary`) instead, so it looks like the
  rest of the product; the mockup's structure, semantics and typography were taken, its hue was not.
  A teal accent would either make Support look unlike every other module or become an app-wide
  repaint, which is a separate decision.
- **Five semantic tokens added** (`globals.css`, both themes, mapped through `@theme inline`):
  `--success` / `--success-soft`, `--warning` / `--warning-soft`, `--danger-soft`. The app had none —
  components hardcoded `emerald-*` / `amber-*` / `rose-*` literals. Red keeps the existing
  `--destructive`. Light-mode `--warning` is **#8a6410**, NOT chart-4's #d9a441: the lighter value is
  about 2:1 as a foreground on its soft ground and fails to read. Contrast won, deliberately.
- **The gate mark is the point of the phase.** An incomplete gate is an **empty ring** — no colour,
  no icon. It used to be a red `CircleX`, which framed "not done yet" as an error; that pattern is
  what the redesign set out to remove. Done is a filled `--success` disc with a white check. **Red is
  reserved for a gate that is genuinely late, which nothing can be today** — `TicketStageGate` has no
  target date, so "overdue" has no data to stand on. Defining it (per-gate due date? a time-in-stage
  threshold?) is an OPEN DECISION and needs its own migration; it was deliberately not invented.
- **The stepper**: completed stages are a filled brass circle and the connector fills brass behind
  you; the current stage is brass on `--accent` with a ring; future stages are a plain number on card.
  Rose is kept for a flow that genuinely stopped (a rejected change request).
- **`SlaBadge` (`tickets/sla.tsx`) is the single SLA chip** — four states and no more: On track ·
  At risk (inside 4h, the threshold the old amber pill already used) · Breached · No SLA. It reads
  the ticket's own stored deadlines, which `sla.server.ts` wrote from the resolved policy; it
  resolves nothing itself. Used by the ticket header, the list column and the board card (compact
  variant: words only, clock in the tooltip), replacing three separately-styled treatments.
  `slaState` and `SlaPill` were deleted once nothing called them.
  **Where it deliberately draws nothing**: a type with no SLA, a stopped clock (resolved/cancelled),
  or a ticket with no target. `kind` still reports `none`, and `showNone` can draw it — but no screen
  passes that, because none of them showed anything for those cases before. Don't add a "No SLA" chip
  to the list or board without asking: it would land on every change request and bug row.
- **The Change request snapshot was regenerated on purpose** (`vitest -u`): the panel's markup changed
  by design, so the guard now holds the new output. Two of its three snapshots moved (the record
  section did not). A fourth case was ADDED — a change request with the customer's approval missing —
  because every previous fixture had all its gates ticked, so no snapshot contained an incomplete
  mark at all. That test also asserts `not.toContain("circle-x")` outright, so the red cross cannot
  come back even through a careless snapshot update.

### Support redesign — Phase 3 + 4: one lifecycle per ticket, one consolidated Support surface (2026-09-12)

No migration. Two phases landed together; no server action, loader or permission rule was touched.
tsc + lint + build + **410 tests** green.

**Phase 3 — the ticket page shows exactly ONE lifecycle.**
- The Change request panel used to stack SIX cards (Evaluation, Customer approval, Development, Unit
  testing, UAT, Go-live) on every CR whatever stage it was in; `TicketStageFields` had the same
  all-stages shape and only LOOKED like one panel because Bug has fields on Triage alone. Both now
  render **the stage the stepper is on**, inside the lifecycle panel itself (`stageBody`).
  The six-card stack and its `Group` helper are deleted, not hidden.
- **The stepper is the selector**: click a step to look at another stage. It shows that stage's
  purpose, fields and gates with an amber "Viewing — not the active stage" chip; its gates are
  read-only there, matching the server, which only accepts a tick on the ticket's current stage.
  Past stages stay editable — they always were, and making them read-only would remove function.
- Page layout: 60/40. LEFT = Description + the lifecycle. RIGHT = Details (requester, created),
  Classification, SLA (STATUS types only), general fields, Resolution. **Files and Discussion follow
  the mode**: on a STATUS-mode ticket the left column would otherwise be a lone Description, so they
  move there and the right column is pure metadata; on a stage type they stay on the right.
  The objection about Discussion at 40% is recorded at the top of `ticket-detail-client.tsx`.
- Snapshots regenerated on purpose again, and a fixture ADDED whose gate is unmet, asserting
  `not.toContain("circle-x")` and that no other stage's fields render.

**Phase 4 — Support is one surface, not five pages that each invented a header.**
- **`support-shell.tsx`** wraps `/tickets`, `/tickets/all`, `/tickets/board`, `/tickets/c/[id]` and
  `/tickets/settings`: same title block, same **Clients · All tickets · Board** switcher, same
  New ticket, and **Configure on every one of them** — it used to exist only on All tickets.
  `support-kpis.tsx` is the same four tiles everywhere, each one a link into what it counted.
- **The clients overview is a dense triage table** (`clients-table.tsx`), worst first: Open,
  Breached, Unassigned, Critical, Oldest open, Resolved 7d, Last activity, Team. Sortable, searchable
  (name or team member), chips that filter, state mirrored to the URL. The card grid is gone — it was
  unusable past a couple of dozen accounts, exactly what happened to `/portfolio`.
  `src/lib/support-overview.ts` is the **pure, tested** half: `attentionScore` (breached > critical >
  unassigned > open), `needsAttention`, `isQuiet`, `sortClients`, `filterClients`, `summarize` — so a
  chip's count and the rows it shows can never disagree.
- **`filter-bar.tsx` replaced three rows of always-open chip groups** with: search + the five focus
  chips + ONE Filters popover (Type, Status, Priority, Assignee, Client, Open only, Raised by me) +
  **active filters listed back as chips you can click off**. Shared by the list and the workspace.
  **"Clear all" now really clears** — it used to reset to `EMPTY`, which still carried `onlyOpen`, so
  a filter stayed on. It sets `{}`.
- **The group labelled "Stage" is called "Status"** — it filters status CATEGORIES, and since the
  lifecycle work "stage" means something else. That collision was a real defect.

**Known gaps, deliberate**: there is still no filter BY stage (TicketRow carries no stage key — it
needs `serialize.ts` and the queries, so it is its own change); the board has the shell but not yet
the filter bar or saved views; the overview was not click-tested at 50+ accounts (agent has no
sign-in), only proven by unit tests and a production build.

### Navigation: "Back" means back; and the donut label fits any amount (2026-09-12)

No migration. tsc + lint + build + **414 tests** green.

- **`src/components/back-link.tsx`** — every detail page hardcoded a link to its own index, so opening
  a project from the Dashboard or the Command center and pressing Back dumped you on `/projects`,
  losing where you came from. `BackLink` goes one step back when there IS an in-app step
  (`router.back()`), and falls back to the index href when you landed directly (bookmark, e-mail deep
  link, fresh tab). It stays a real `<a href>`, so ctrl/middle-click still opens a new tab.
  **`src/app/(app)/nav-depth.tsx`** counts in-app navigations per tab in `sessionStorage`
  (`rm_nav_depth`); depth > 1 is what "there is somewhere of ours to go back to" means. Mounted once
  in the app shell. Storage blocked (private mode) ⇒ depth 0 ⇒ the index link, never a dead control.
  Converted: invoices (new + detail), people (matrix + person), revenue/unbilled, taxes, tickets/new,
  time-cards, vendors, and the four delivery back links (cockpit, cutover, UAT, runbook list).
- **A client Support workspace had no visible way out**: the shell marks the Clients tab as the
  current page there, so it reads as "you are here" rather than a way back. `SupportShell` now takes
  `back={{ href, label }}` and the workspace shows "← Clients overview" above the title; ticket
  settings shows "← Support".
- **Donut centre label**: stepping through three Tailwind sizes by string length was not enough —
  `€177,300.00` is 11 characters, landed on `text-sm`, and at 14px that is ~92px of tabular mono
  inside an 84px hole, so it painted over the ring. The size is now COMPUTED from the space available:
  `(hole − 6) / (longest unbreakable run × 0.62em)`, clamped to 9–18px. The binding constraint is the
  longest run WITHOUT a space, because the label wraps at spaces (`ALL 12,345,678.00` breaks after
  `ALL`). A value with no space and no room left is clipped with the full figure in the `title`
  tooltip — clipping is survivable, painting over the ring is not.
  `src/lib/__tests__/donut-label.test.ts` pins the arithmetic, including the exact value that
  overflowed and the fact that the old 14px rule did not fit it. Amounts only grow; this holds.

### Every page that sits under something now has a Back (2026-09-13)

No migration. tsc + lint + build + 414 tests green. Follows the BackLink work from 2026-09-12.

- **`/projects/[id]` had no back affordance at all** — the owner's report. It now shows
  "← Projects". Same for **`/planning/availability`** ("← Planning"), which only had week pagination.
- **Every remaining hardcoded back link in the app is now `BackLink`**, so all of them go one step
  back when there is an in-app step and fall back to their index otherwise: admin clients (list +
  new), admin users (list + new), admin exchange rates (new), opportunities (detail + new), projects
  (new + edit), the whole milestone subtree (milestone, edit, new, tasks new/edit/copy, assignments
  new/edit), the ticket detail page, and both customer-portal pages. 35 files render one now.
- **The portal mounts `NavDepthTracker` too** (`src/app/portal/layout.tsx`), so a customer's "← My
  tickets" behaves the same way instead of always jumping to the index.
- **Deliberately NOT given a back link**: the ~30 sidebar destinations (`/projects`, `/expenses`,
  `/planning`, `/tickets`, every `/admin/*` index …) — they are top-level, the sidebar is their nav,
  and "← Projects" on `/projects` is nonsense. Also left alone: `/profile` and `/help` (reached from
  the account menu), and the "← Prev" WEEK PAGINATION on the planner, availability, time,
  my-planning and scheduled-vs-actuals — those arrows move a date range, they are not navigation.
