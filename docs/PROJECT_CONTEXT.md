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
