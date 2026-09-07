<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# House rules

Rules for every agent session in this repo:

- **Context first.** Read `docs/PROJECT_CONTEXT.md` before changing anything. At the end of every
  session, append a dated entry to it summarizing what changed, including any new migration names.
- **Migrations.** Schema changes go through `prisma migrate dev --name <snake_case>`. Never edit a
  migration that has already been applied. One migration per feature. List new migration names in the
  session entry.
- **Money math is pure.** Monetary and date calculations live in pure functions in `src/lib/*.ts` with
  no Prisma import, so they stay unit-testable. Put new money/date math there — never inline in a page
  or a server action.
- **Decimals.** All monetary and hour amounts are Prisma `Decimal`. Convert with `Number()` only at the
  boundary; never mix `Decimal` and `number` in arithmetic.
- **Server actions.** They live in `actions.ts` next to the route, return `{ error?: string }`, and
  call `can(user, <action>)` from `src/lib/permissions.ts` before any write.
- **Permissions are explicit.** Every new page or action must declare which `Action` permission gates
  it. New permissions are added to the `Action` union and to `ROLE_PERMISSIONS` for every role
  explicitly.
- **Rate confidentiality.** Cost rates, salaries and margin are never returned to a user lacking
  `rates:view:any` — filter them out in the query, not in the component.
- **Definition of done.** `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`, and `pnpm test` all pass,
  and `docs/PROJECT_CONTEXT.md` is updated.
- **Stay in scope.** Do not refactor code outside the task's scope. Do not add dependencies without
  saying why.
