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

### Step 3: [Optional, currently disabled] Obtain Accelerate URL from Prisma Console

> **Decision (2026-07-04, rca_267a §6, Lord-approved cmd_267+addendum): the direct
> Cloud SQL socket path (`DATABASE_URL`) is the DEFAULT production DB path, not
> Accelerate.** Accelerate has never successfully reached this environment's
> Cloud SQL instance — it fails with P1001 due to `GOOGLE_MANAGED_INTERNAL_CA` TLS
> verification (see `rca_266a_accelerate_cloudsql.md` / `rca_267a_db_path_decision.md`
> in the internal reports). The maintainer is following up with Prisma
> support separately; this step is skipped for normal setup/deploy.
>
> Skip straight to Step 4 unless you are specifically re-testing Accelerate.

If re-testing Accelerate anyway (this step still cannot be automated — the Prisma
Platform API does not support URL issuance):
1. Go to https://console.prisma.io
2. Register the project connection using `DATABASE_URL_PUBLIC` output in Step 2
3. Enable Prisma Accelerate → obtain the issued `prisma+postgres://...` URL
4. Set it as `PRISMA_DATABASE_URL` in `.env.production.local`
5. See `docs/knowledge/manual-ops.md §1` for the revival toggle in
   `scripts/gcp-deploy.sh` (commented out, not deleted) that must also be re-enabled.

### Step 4: Run gcp-deploy.sh (image build + deploy)

```bash
bash scripts/gcp-deploy.sh
```

Operations performed (default = direct socket path, Option A):
- Docker image build + push to Artifact Registry (service + migrate images)
- Migration Job: `prisma migrate deploy` via direct `DATABASE_URL` socket
- Run seed
- Cloud Run Service deploy:
  - `--add-cloudsql-instances` (for DATABASE_URL direct socket)
  - `--set-secrets`: DATABASE_URL / AUTH_SECRET / GCS_BUCKET / REDIS_URL
  - `--set-env-vars`: AUTH_TRUST_HOST=true / NODE_ENV=production
  - `--max-instances=10` — paired with the `lib/prisma.ts` PrismaPg pool cap
    (`max: 2`) so 10 instances × 2 pool ≤ 20 connections, under the
    db-f1-micro `max_connections=25` ceiling (rca_267a §1/§6). If instance
    count or pool size changes, re-derive this budget.
  - Output Service URL (`gcloud run services describe --format='value(status.url)'`)

The Accelerate wiring (Step 0 secret registration + `PRISMA_DATABASE_URL`
guard + `--set-secrets` entry) is commented out in `gcp-deploy.sh`, not
deleted. To revive it: uncomment those three blocks, complete Step 3 above,
and set `PRISMA_DATABASE_URL` in `.env.production.local` — no other code
changes needed (`lib/prisma.ts` already branches on that variable).

**Scaling beyond the 10×2 budget**: raise the Cloud SQL tier to
`db-g1-small` (`max_connections≈50`) and adjust `--max-instances`/pool
`max` proportionally (e.g. 10×5=50) rather than reintroducing Accelerate
or an external pooler — see rca_267a §2 for why Managed Connection Pooling
(Enterprise Plus only) and a PgBouncer sidecar (Cloud Run has no sidecar
support) were both rejected.

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
