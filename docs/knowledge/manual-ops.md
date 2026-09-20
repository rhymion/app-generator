# GCP Cloud Run Manual Operations

## Operations That Cannot Be Automated

### 1. Obtain Prisma Accelerate URL (disabled by default — the direct Neon connection is the production DB path)

> Accelerate is off by default (`PRISMA_DATABASE_URL` unset) — see the
> comment in `lib/prisma.ts`. This section is kept because `lib/prisma.ts`'s
> `PRISMA_DATABASE_URL` format guard and `docs/knowledge/DATABASE_TESTING.md`
> both cite it by number (`manual-ops.md §1`) — do not delete or renumber
> this section without updating those two references too.

Revival procedure:
1. Obtain the DB connection string to register — this is now the Neon
   `DATABASE_URL` from `.env.production.local` (see `scripts/gcp-env.sh`),
   not a Cloud SQL public IP.
2. Go to https://console.prisma.io
3. Create a project (or select existing one)
4. Enable Accelerate → enter the Neon `DATABASE_URL` as the connection string
5. Obtain the issued `prisma+postgres://...` URL
6. Set it as `PRISMA_DATABASE_URL` in `.env.production.local`
   ```bash
   # .env.production.local
   PRISMA_DATABASE_URL=prisma+postgres://accelerate.prisma-data.net/?api_key=...
   ```
7. In `scripts/gcp-deploy.sh`, uncomment the three Accelerate blocks (the
   `PRISMA_DATABASE_URL` guard, the Step 0 secret registration, and the
   `PRISMA_DATABASE_URL=app-prisma-database-url:latest` entry in the Step 4
   `--set-secrets` list) — they are commented out, not deleted, specifically
   for this revival path.
8. `lib/prisma.ts` already branches on `PRISMA_DATABASE_URL` being set, so no
   application code change is needed.
9. Run `bash scripts/gcp-deploy.sh`.

Without these steps, `PRISMA_DATABASE_URL` stays unset and `gcp-deploy.sh` /
`lib/prisma.ts` use the direct Neon connection path (current default).

### 2. Link GCP Billing Account

```bash
gcloud beta billing projects link $PROJECT_ID \
  --billing-account=BILLING_ACCOUNT_ID
# BILLING_ACCOUNT_ID: check with gcloud beta billing accounts list
```

### 3. Obtain Upstash Management API Key

1. Go to https://console.upstash.com
2. Account → Management API → Generate API Key
3. Set UPSTASH_EMAIL and UPSTASH_API_KEY in .env.production.local

### 4. Grant Cloud Run IAM Invoker Permission (for DRS organizations)

In DRS (Domain Restricted Sharing) organizations, --allow-unauthenticated cannot be used.
`scripts/gcp-deploy.sh` already applies the `--no-invoker-iam-check` alternative
unconditionally in its `gcloud run deploy` step (Step 4).

### 5. Confirm GCP Project Number (PROJECT_NUMBER)

```bash
gcloud projects describe $PROJECT_ID --format='value(projectNumber)'
```

### 6. Vercel Fresh Provisioning — three separate stages, not one script

**Update**: `vercel-setup.sh` no longer runs migration or seeding itself. It used to
(as Steps 3/4/5/5.5), but that was removed — `vercel-build` already runs
`migrate:deploy` on every deploy, making an earlier owner of that step redundant, and
seeding before any deploy has ever run means seeding a database with no schema yet.
The corrected flow is three separate scripts, run in order:

1. `scripts/vercel-setup.sh` (`app-template/scripts/vercel-setup.sh`, a symlink into
   the `app-generator` submodule) — provisions Neon/Upstash/Blob, links the Vercel
   project, injects env vars. Does **not** touch the database.
2. `scripts/vercel-deploy.sh [--prod]` — first deploy; `vercel-build` creates the schema
   via `migrate:deploy`.
3. `scripts/vercel-seed.sh [--prod]` — bootstraps tenant/admin data (`db:seed-baseline`,
   idempotent). Must run after step 2 — running it before any deploy fails because the
   target tables don't exist yet. Defaults to seeding the staging DB; `--prod` seeds
   production. Skipping this step for staging leaves it without a default tenant/admin
   user, making the first preview deploy unusable for manual testing.

See `app-template/docs/vercel-automation-design.md` for the full step-by-step breakdown
(§18/§19 cover the corrected three-stage ordering specifically).
