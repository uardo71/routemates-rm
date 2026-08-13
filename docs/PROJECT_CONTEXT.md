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
