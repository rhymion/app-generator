# GCP Cloud Run Manual Operations

## Operations That Cannot Be Automated

### 1. Obtain Prisma Accelerate URL (disabled by default — direct socket is the production DB path)

> **Decision (2026-07-04, rca_267a §6): direct Cloud SQL socket (`DATABASE_URL`) is
> the default production DB path, not Accelerate.** Accelerate has never
> successfully reached this environment's Cloud SQL instance (P1001,
> `GOOGLE_MANAGED_INTERNAL_CA` TLS verification failure — see
> `rca_266a_accelerate_cloudsql.md` / `rca_267a_db_path_decision.md`). The Lord is
> pursuing this with Prisma support separately. **Do not follow this procedure for
> normal setup/deploy** — it is kept only for re-testing Accelerate once that
> support thread resolves.

Revival procedure (once Accelerate is confirmed reachable again):
1. Run gcp-setup.sh first and note the `DATABASE_URL_PUBLIC` displayed at the end.
2. Go to https://console.prisma.io
3. Create a project (or select existing one)
4. Enable Accelerate → enter `DATABASE_URL_PUBLIC` as the connection string
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
`lib/prisma.ts` use the direct socket path (current default).

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
