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
