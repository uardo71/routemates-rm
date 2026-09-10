# RM Ops — operations runbook

What runs on a schedule, how it is triggered, and how to check it. Production is
https://psa.routemates.it (Azure App Service `rm-ops-psa`, resource group `rm-ops-rg`).

## Scheduled jobs — `.github/workflows/daily-jobs.yml`

One GitHub Actions workflow, cron `0 6 * * 1-5` (06:00 UTC on weekdays: 08:00 Tirana in summer,
07:00 in winter). It POSTs three machine-to-machine endpoints on the live app, in order:

| Step | Endpoint | What it does |
| --- | --- | --- |
| Alerts | `POST /api/internal/alerts` | Runs every rule in `src/lib/alerts/rules.ts` for every company: financial (budget, invoice overdue, approvals waiting, expiry, milestone overdue, certification expiry) and delivery (status overdue, plan slipping, issue overdue, go-live readiness, Monday digest). |
| Nudge daily | `POST /api/internal/timesheet-nudge?mode=daily` | Reminds people who logged nothing yesterday. |
| Nudge weekly | `POST /api/internal/timesheet-nudge?mode=weekly` | Same for the week to date; the route itself only sends on the configured weekday, so calling it daily is correct. |

Every endpoint is **idempotent**: the alerts run marks the day in `AppSetting` (`alertsLastRun`)
once something was sent, and every alert is deduplicated forever by the `Notification` ledger's
unique `(kind, targetId, payloadHash)`. The nudge dedups per mode per day. Re-running the workflow
by hand can never double-send.

### Authentication

All three endpoints check the header `x-nudge-secret` against the app setting
`TIMESHEET_NUDGE_SECRET` (constant-time compare, `src/lib/internal-auth.ts`). The workflow reads it
from the repository secret **`NUDGE_SECRET`** — the two values must be identical.

- App side: `az webapp config appsettings list -g rm-ops-rg -n rm-ops-psa --query "[?name=='TIMESHEET_NUDGE_SECRET']"`
- GitHub side: repository → Settings → Secrets and variables → Actions → `NUDGE_SECRET`.
- A wrong or missing secret returns **401** and the step fails red — that is the signal to fix it.

### Channels

Alerts and nudges fan out through `src/lib/notify.ts`: Microsoft Graph mail (needs the `Mail.Send`
application permission with admin consent on the Entra app, and `GRAPH_MAIL_SENDER` set to a real
mailbox) and a Teams incoming webhook (`TEAMS_WEBHOOK_URL`). Until at least one is configured the
alerts run reports `noChannel: true`, records nothing in the ledger, and retries tomorrow — nothing
is lost, nothing is marked sent.

### Run it by hand

GitHub → Actions → **Daily jobs** → *Run workflow*. Tick **dryRun** to evaluate and print what
would go out without sending or recording anything. The alerts step prints
`sent / suppressed / noChannel`; the nudge steps print `mode, skipped, missingCount, notifications`.

Equivalent from a shell (dry run):

```bash
curl -sS -X POST "https://psa.routemates.it/api/internal/alerts?dryRun=1" -H "x-nudge-secret: $NUDGE_SECRET"
```

`force=1` bypasses the once-a-day marker (never the ledger) — use it after fixing a channel to send
the same day.

### In the app

`/admin/settings` → **Alerts** tab: master switch, email/Teams switches, per-rule enable and
thresholds (budget %, overdue day tiers, approval days, expiry window, certification days, digest
weekday), and **Preview today's alerts** — a dry run through the real runner.

### If nothing arrives

1. Actions → Daily jobs: is the last run green? A 401 means the secret; a 5xx means the app.
2. Alerts settings → Preview: are there candidates at all? `alreadySent: true` means the ledger
   already has them — expected on re-runs.
3. `noChannel: true` in the step output means neither mail nor Teams is configured.
4. Check the `Notification` table for today's rows (`channel`, `recipient`).

## Deploy — `.github/workflows/deploy.yml`

Push to `main` → install → prisma generate → tsc → lint → tests → build → OIDC login to Azure →
`prisma migrate deploy` against production → deploy the standalone bundle → curl until 200.
A red check never reaches production. Migrations run **before** the new code goes live.

## Database

Azure Database for PostgreSQL Flexible Server `rm-ops-db`, database `erp_prod`, role `erp_app`.
The firewall allows Azure services plus the office IP — from anywhere else `psql` times out; add the
current IP under Networking, or run read-only checks through the app.
