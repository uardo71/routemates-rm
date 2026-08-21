# Deployment plan — Azure App Service + PostgreSQL, files on SharePoint (Graph)

Status: **plan / not yet executed.** Decisions locked with the owner on 2026-08-13:
host on **Azure App Service + Azure Database for PostgreSQL**, store uploaded files in
**SharePoint via Microsoft Graph**. This document is the step-by-step; no code has been
changed yet. When it conflicts with the code, trust the code.

---

## 0. Target architecture

```
              ┌─────────────────────────── Entra ID (your M365 tenant) ───────────────────────────┐
              │   App reg #1  "RM Ops SSO"         (existing — user login, OIDC)                    │
              │   App reg #2  "RM Ops Files"       (NEW — app-only Graph, Sites.Selected)           │
              └───────────────────────────────────────────────────────────────────────────────────┘
                         ▲ SSO (browser)                         ▲ client-credentials (server→server)
                         │                                       │
   Users ──https──▶ Azure App Service (Linux, Node 20)  ──Graph──▶  SharePoint doc library
                         │  next start / server actions           (receipts + documents drive)
                         ▼
              Azure Database for PostgreSQL (Flexible Server, private)
```

Three things move to the cloud: the **Node app** (`next start`), **Postgres**, and the
**file storage** (today local `uploads/`, becoming a SharePoint document library). Everything
else (Auth.js JWT sessions, Prisma, the hand-rolled UI) is unchanged.

---

## 1. Prerequisites

- An **Azure subscription** (pay-as-you-go is fine for ~10 users).
- Azure CLI (`az`) installed and `az login`.
- Roles you (or an admin) need:
  - **Owner/Contributor** on the subscription (to create resources).
  - **Global Administrator** or **Privileged Role Admin** in Entra — to grant admin consent on the
    new Graph app and to run the `Sites.Selected` grant.
  - **SharePoint Administrator** or site owner — to pick/create the target site + library.
- A DNS record you control for the production hostname (e.g. `ops.routemates.it`).

---

## 2. Part A — Provision Azure (one-time)

Names below are examples — pick your own. Region: pick one near you (e.g. `westeurope`).

```bash
# Resource group
az group create -n rm-ops-rg -l westeurope

# --- PostgreSQL Flexible Server ---
az postgres flexible-server create \
  -g rm-ops-rg -n rm-ops-db \
  --tier Burstable --sku-name Standard_B1ms --storage-size 32 \
  --version 16 \
  --admin-user pgadmin --admin-password '<STRONG-PW>' \
  --public-access None      # private; App Service reaches it via VNet integration

# Create the app database + role (via psql once networking is set, or use the portal Query editor)
#   CREATE DATABASE erp_prod;
#   CREATE ROLE erp_app LOGIN PASSWORD '<APP-PW>';
#   GRANT ALL PRIVILEGES ON DATABASE erp_prod TO erp_app;

# --- App Service (Linux, Node 20) ---
az appservice plan create -g rm-ops-rg -n rm-ops-plan --is-linux --sku B1
az webapp create -g rm-ops-rg -p rm-ops-plan -n rm-ops-app \
  --runtime "NODE:20-lts"

# VNet integration so the app can reach the private DB (or use a Private Endpoint).
# Simpler alternative for a first cut: set PostgreSQL public access + a firewall rule
# allowing only the App Service outbound IPs. Private is preferred long-term.
```

Notes:
- **B1 App Service + B1ms Postgres** is plenty for 10 users; scale up later without redeploying.
- Turn on **App Service "Always On"** (General settings) so the Node process isn't recycled on idle.
- Postgres Flexible Server has **automated backups** (7–35 day retention) — keep them; still take
  periodic `pg_dump`s for portability (as we already do into `backups/`).

### Custom domain + TLS
- Add your hostname in App Service → **Custom domains**, create the CNAME, and enable the
  **free App Service Managed Certificate** (auto-renewing TLS). HTTPS is required for the auth cookies.

---

## 3. Part B — App configuration (env vars)

Set these in App Service → **Configuration → Application settings** (they become env vars).
Prefer **Azure Key Vault references** for the secrets (`AUTH_SECRET`, DB password, Graph secret).

| Var | Value |
|---|---|
| `DATABASE_URL` | `postgresql://erp_app:<APP-PW>@rm-ops-db.postgres.database.azure.com:5432/erp_prod?sslmode=require` |
| `AUTH_SECRET` | **NEW** strong secret — `openssl rand -base64 33` (do not reuse the dev one) |
| `AUTH_URL` | `https://ops.routemates.it` (your prod origin, exact) |
| `AUTH_TRUST_HOST` | `true` (Auth.js behind the App Service proxy) |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | existing SSO app (client) id |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | existing issuer URL |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | **rotated** SSO client secret (see §7 — the old one was exposed) |
| `AUTH_ALLOW_PASSWORD_LOGIN` | omit (SSO-only) or `true` for the break-glass path |
| `GRAPH_TENANT_ID` | your tenant id |
| `GRAPH_CLIENT_ID` | **App reg #2** (files) client id |
| `GRAPH_CLIENT_SECRET` | App reg #2 secret **value** |
| `GRAPH_SITE_ID` | resolved SharePoint site id (see §5) |
| `GRAPH_DRIVE_ID` | resolved document-library drive id (see §5) |
| `FILE_STORAGE_BACKEND` | `sharepoint` (the env switch the new storage module reads; `local` keeps disk) |

Build/run on App Service:
- **Build command:** `pnpm install && pnpm build`
- **Start command:** `pnpm start` (i.e. `next start -p 8080`; App Service sets `PORT`)
- Ensure `pnpm` is available — set `SCM_DO_BUILD_DURING_DEPLOYMENT=true` and add a
  `packageManager` (already pinned) so Oryx uses pnpm, or build in CI (§6).
- `next.config.ts` already bumps `serverActions.bodySizeLimit` to 20mb — keep it.

---

## 4. Part C — Entra changes

### Existing SSO app (#1)
- Add the **production redirect URI**:
  `https://ops.routemates.it/api/auth/callback/microsoft-entra-id`
  (keep the localhost one for dev). No other change — RBAC still comes from the local user row.

### NEW app registration (#2) — file access only
Keep this **separate** from SSO so the daemon identity is isolated and independently revocable.

1. Entra → App registrations → **New** → "RM Ops Files", single tenant.
2. **Certificates & secrets** → new client secret → copy the **Value** → `GRAPH_CLIENT_SECRET`.
3. **API permissions** → Microsoft Graph → **Application permissions** → add **`Sites.Selected`**
   → **Grant admin consent**. (This alone grants access to *no* sites yet — that's the point.)
4. **Scope it to one site** — an admin grants this app write on exactly the target site
   (run as someone with `Sites.FullControl.All`, or via PowerShell/Graph Explorer):
   ```
   POST https://graph.microsoft.com/v1.0/sites/{siteId}/permissions
   {
     "roles": ["write"],
     "grantedToIdentities": [{ "application": { "id": "<APP2_CLIENT_ID>", "displayName": "RM Ops Files" } }]
   }
   ```
   Least privilege: the app can touch this one library and nothing else in SharePoint.

---

## 5. Part D — Resolve the SharePoint site + drive ids

Pick (or create) a document library, e.g. site **"RM Ops"** with a library **"App Files"**, with
two folders `receipts/` and `documents/`. Then resolve ids once (Graph Explorer or curl w/ a token):

```
# Site id  (host + server-relative path)
GET https://graph.microsoft.com/v1.0/sites/routemates.sharepoint.com:/sites/RMOps
   → id  →  GRAPH_SITE_ID

# Drive (document library) id
GET https://graph.microsoft.com/v1.0/sites/{siteId}/drives
   → pick the "App Files" library  →  id  →  GRAPH_DRIVE_ID
```

Store both as env vars (they're stable). Everything else is addressed by path under the drive root.

---

## 6. Part E — Deploy pipeline (GitHub Actions, recommended)

Build in CI (reliable pnpm + Prisma generate), deploy the built app, run migrations on release.

```yaml
# .github/workflows/deploy.yml (outline)
on: { push: { branches: [main] } }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4          # pnpm 9
      - uses: actions/setup-node@v4          # node 20, cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec prisma generate
      - run: pnpm build
      - run: pnpm exec prisma migrate deploy   # against prod DATABASE_URL (from secrets)
      - uses: azure/webapps-deploy@v3
        with: { app-name: rm-ops-app, package: . }
```

- Put `DATABASE_URL` and the publish profile in **GitHub Actions secrets**.
- `prisma migrate deploy` is safe/idempotent — applies `prisma/migrations/*` in order (it already
  includes `20260812130000_invoice_commission`).

---

## 7. Part F — SharePoint storage integration (code plan)

The whole file layer is behind **one module** (`src/lib/receipt-storage.ts`) plus two serve routes.
We introduce a backend switch so dev can stay on disk and prod uses SharePoint.

### 7.1 Packages
```
pnpm add @azure/identity @microsoft/microsoft-graph-client isomorphic-fetch
```

### 7.2 New module `src/lib/graph.ts`
- `ClientSecretCredential(GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET)`.
- A cached Graph `Client` using the `.default` scope (token auto-refreshes ~hourly).
- Helpers: `uploadFile(subdir, name, buffer, mime) → { itemId }`, `downloadFile(itemId) → stream`,
  `deleteFile(itemId)`.
- Small files (<4MB) → `PUT /drives/{driveId}/root:/{subdir}/{name}:/content`.
  Larger → `createUploadSession` + chunked `PUT` (our cap is 10MB, so sessions are the safe path for
  the bigger phone photos / PDFs).

### 7.3 Rewrite `receipt-storage.ts` as an adapter
Keep the **exact same exported surface** so callers don't change:
`saveReceiptFile(file, subdir)`, `deleteReceiptFile(ref, subdir)`, `isAllowedReceiptType`,
`MAX_RECEIPT_SIZE_BYTES`, and the `SavedReceipt` shape.
- `if (process.env.FILE_STORAGE_BACKEND === "sharepoint")` → call `graph.ts`; else current disk code.
- **`SavedReceipt.fileName` becomes the Graph `driveItem.id`** (opaque string). `originalName`,
  `mimeType`, `sizeBytes` stay identical — so the DB schema barely changes (see 7.5).
- `receiptFilePath()` is disk-only; under SharePoint the serve routes call `graph.downloadFile()`
  instead (see 7.4). Keep `receiptFilePath` for the `local` backend.

### 7.4 Serve routes — stream through Graph, keep our RBAC
`src/app/api/documents/[fileName]/route.ts` and `src/app/api/receipts/[fileName]/route.ts`:
- **Unchanged:** `requireUser()`, the company-scope 404, and the `can(user, …)` authorization.
  This is the key security property — **our roles gate every file**, not SharePoint sharing.
- **Changed:** instead of `readFile(receiptFilePath(...))`, when backend = sharepoint do
  `graph.downloadFile(doc.fileName)` and pipe the bytes back with the same `Content-Type` /
  `Content-Disposition` headers. (`doc.fileName` now holds the driveItem id.)

### 7.5 DB migration
Minimal — the driveItem id fits the existing `fileName` column (it's just a string), so the
**cleanest option is no schema change**: store the Graph item id where the on-disk name used to go.
- If you prefer explicitness, add `driveItemId String?` to `Document` and `ExpenseReceipt` and read
  that under SharePoint (nullable so existing local rows keep working). Optional.
- Either way, add a hand-written migration + `migrate deploy` per the usual workflow.

### 7.6 Files that change (scope)
```
NEW  src/lib/graph.ts
EDIT src/lib/receipt-storage.ts                       # backend switch
EDIT src/app/api/documents/[fileName]/route.ts        # download via Graph when sharepoint
EDIT src/app/api/receipts/[fileName]/route.ts         # same
(opt) prisma/schema.prisma + migration                # driveItemId columns, if chosen
```
Upload actions (`invoices/actions.ts`, `opportunities/actions.ts`, expenses) and all UI stay
**untouched** — they only call `saveReceiptFile` / `deleteReceiptFile`.

---

## 8. Part G — Migrate existing files (one-time backfill)

The current `uploads/` (25 files, receipts + documents) must move into SharePoint so old rows resolve:
- A `scripts/migrate-uploads-to-sharepoint.ts`: for each `Document` / `ExpenseReceipt`, read the
  local file, `graph.uploadFile(...)`, and rewrite the row's `fileName` (or `driveItemId`) to the
  returned item id. Idempotent (skip rows already pointing at a Graph id).
- Run it once after the code ships and env is set, with the current `uploads/` present.

---

## 9. Cutover checklist (go-live)

1. Azure resources provisioned (§2); custom domain + TLS live.
2. Postgres reachable from App Service; `erp_prod` + `erp_app` created.
3. Restore production data: `pg_restore … backups/erp_dev_YYYYMMDD.dump` into `erp_prod`
   (or `migrate deploy` for an empty schema, then import).
4. Entra: prod redirect URI added (#1); Files app (#2) consented + `Sites.Selected` granted to the
   one site; `GRAPH_SITE_ID` / `GRAPH_DRIVE_ID` resolved.
5. App settings (env) filled in, secrets in Key Vault; `FILE_STORAGE_BACKEND=sharepoint`.
6. Storage code shipped (§7); `pnpm build` clean; `migrate deploy` run.
7. Backfill existing `uploads/` → SharePoint (§8); spot-check a receipt + an invoice document open.
8. Smoke test: SSO login as a real user, create an invoice, upload a document (lands in SharePoint),
   open it (streams back through the authed route), expense with receipt, approvals.
9. Rotate the **SSO client secret** (was exposed in chat) and update the env.

---

## 10. Security & ops

- **Least privilege:** Graph app uses `Sites.Selected` scoped to one library — not `Files.ReadWrite.All`.
- **RBAC stays in the app:** files are only reachable through the authenticated serve routes; never
  hand out SharePoint links. SharePoint permissions are *not* a substitute for our role checks.
- **Secrets:** Key Vault references for `AUTH_SECRET`, DB password, `GRAPH_CLIENT_SECRET`. Set secret
  expiry reminders (Entra secrets expire — 6–24 months).
- **Backups:** Postgres automated backups on; keep periodic `pg_dump` to `backups/`. SharePoint files
  are covered by your M365 retention.
- **Logging:** App Service → Log stream / Application Insights for errors.
- **The break-glass login:** `AUTH_ALLOW_PASSWORD_LOGIN=true` still overrides the DB toggle if SSO
  ever breaks — document who holds that.

---

## 11. Rough monthly cost (order of magnitude, EUR)

| Item | ~Cost |
|---|---|
| App Service B1 (Linux) | ~€12 |
| PostgreSQL Flexible B1ms + 32GB | ~€15–25 |
| SharePoint storage | included in existing M365 |
| TLS cert / DNS | free / negligible |
| **Total** | **~€30–40 / month** |

Scale the App Service / DB SKU up only if it's ever needed; nothing here requires a redeploy to resize.

---

## 12. Open decisions / assumptions

- Site/library layout (one library with `receipts/` + `documents/` folders vs. two libraries) — pick
  during §5; the code only needs a drive id + folder name.
- Private networking (VNet/Private Endpoint) vs. firewall-allowlisted public Postgres for the first
  cut — start simple, tighten later.
- Whether to add explicit `driveItemId` columns (7.5) or reuse `fileName` — reuse is fine.
- CI (GitHub Actions) vs. `az webapp up` zip deploy — Actions recommended for the migrate-on-release step.
