# GCP Environment Automation Script Design

## 0. Objective (North Star)

Automate GCP (x-cloud) environment setup and teardown for generated apps using reproducible scripts,
eliminating manual dependencies to establish sustainable operation.

- Environment differences are absorbed by `.env.production.local` (per-project)
- PoC's `db push` is switched to `prisma migrate deploy` in production
- Automate Upstash / Prisma via API/CLI to the extent possible

---


## 1. Operation Sequence

Complete procedure for initial GCP environment setup through deployment:

### Step 1: Prepare .env.production.local

```bash
cp .env.production.local.example .env.production.local
# Fill in required values: PROJECT_ID / DB_PASSWORD / AUTH_SECRET / UPSTASH_EMAIL / UPSTASH_API_KEY
# PRISMA_DATABASE_URL can be left blank at this point (obtain in Step 3)
# DB_PASSWORD / AUTH_SECRET are generate-once-persist: if left blank,
#   gcp-env.sh will auto-generate on first run and write back to .env.production.local
```

### Step 2: Run gcp-setup.sh (idempotent infrastructure setup)

```bash
bash scripts/gcp-setup.sh
```

Operations performed (idempotent — safe to re-run):
- Enable GCP APIs
- Create Artifact Registry
- Create Cloud SQL instance/DB/user → obtain public IP (DATABASE_URL_PUBLIC)
- Create service account + IAM bindings
- Automatically create Redis DB via Upstash Management API → obtain REDIS_URL
- Register the following in Secret Manager:
  - app-database-url (DATABASE_URL socket)
  - app-nextauth-secret (AUTH_SECRET)
  - app-gcs-bucket-name (GCS_BUCKET)
  - app-redis-url (REDIS_URL)
- Create GCS bucket + IAM bindings
- At the end: **echo DATABASE_URL_PUBLIC → prompt to register in Prisma Console**
- **⚠️ app-prisma-database-url is not created yet (until Step 3 is complete)**

### Step 3: [Manual] Obtain Accelerate URL from Prisma Console (suspended now)

> **This step cannot be automated (Prisma Platform API does not support URL issuance)**
> See `docs/knowledge/manual-ops.md §1`

1. Go to https://console.prisma.io
2. Register the project connection using `DATABASE_URL_PUBLIC` output in Step 2
3. Enable Prisma Accelerate → obtain the issued `prisma+postgres://...` URL
4. Set it as `PRISMA_DATABASE_URL` in `.env.production.local`

### Step 4: Run gcp-deploy.sh (image build + deploy)

```bash
bash scripts/gcp-deploy.sh
```

Operations performed:
- Required check for PRISMA_DATABASE_URL (fail-fast to Step 3 if empty)
- Create/update app-prisma-database-url Secret (register URL obtained in Step 3)
- Docker image build + push to Artifact Registry
- Migration Job: prisma migrate deploy (uses direct DATABASE_URL socket — cannot go through Accelerate)
- Run seed
- Cloud Run Service deploy (atomic wiring):
  - `--add-cloudsql-instances` (for DATABASE_URL direct socket)
  - `--set-secrets`: PRISMA_DATABASE_URL / DATABASE_URL / AUTH_SECRET / GCS_BUCKET / REDIS_URL
  - `--set-env-vars`: AUTH_TRUST_HOST=true / NODE_ENV=production
- Output Service URL (`gcloud run services describe --format='value(status.url)'`)

### On Redeploy (no infrastructure changes)

```bash
bash scripts/gcp-deploy.sh  # Run Step 4 only
```

gcp-setup.sh is idempotent so re-running is safe,
but if there are no infrastructure changes, gcp-deploy.sh alone is sufficient.

### On Teardown

```bash
bash scripts/gcp-teardown.sh  # 2-step confirmation safety guard
```

Teardown: delete Upstash Redis (API) + delete GCP project (soft-delete).
Delete the Prisma Console project manually (see `docs/manual-ops.md §4`).

---

## 2. Deliverables (Implementation Phase after Approval)

| File path | Contents | DP dependency |
|------------|------|--------|
| `scripts/gcp-env.sh` | GCP variable definitions (for sourcing) | DP-1=B |
| `scripts/gcp-setup.sh` | Environment setup | DP-1=B, DP-2 |
| `scripts/gcp-teardown.sh` | Environment teardown | DP-1=B |
| `scripts/gcp-deploy.sh` | Redeploy (image build + deploy) | DP-1=B, DP-2 |
| `.env.production.local.example` | Secrets template | DP-1=B |
| `docs/knowledge/migration-guide.md` | Migration baseline procedure | DP-3 |
| (Upstash API section in gcp-setup.sh) | Auto-create Redis DB | DP-4=A |

---
