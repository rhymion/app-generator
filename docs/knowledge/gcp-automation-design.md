# GCP Environment Automation Script Design

## 0. Objective (North Star)

Automate GCP (x-cloud) environment setup and teardown for generated apps using reproducible scripts,
eliminating manual dependencies to establish sustainable operation.

- Environment differences are absorbed by `.env.production.local` (per-project)
- PoC's `db push` is switched to `prisma migrate deploy` in production
- Automate Upstash / Prisma via API/CLI to the extent possible

---


## 1. Operation Sequence

Complete procedure for initial GCP environment setup through deployment. **The
order below is load-bearing** — `gcp-deploy.sh` (Step 3) needs the `Dockerfile`
that only `generate-code` (Step A) produces, and `generate-code` only produces
the GCP artifacts when `x-cloud` is already enabled at the time it runs.
Running `generate-code` before enabling `x-cloud` — then discovering the
missing `Dockerfile` in Step 3 and patching one in by hand instead of going
back to Step A — silently leaves the upload route on the default Vercel Blob
path instead of GCS, because both artifacts come from the same generator gate
(`code_generator/generate.py`, the `x-cloud` block) and only a real
`generate-code` re-run switches both together.

### Step A: Enable `x-cloud` and run `generate-code`

```bash
# code_generator/json_schema.yaml — uncomment and fill in:
#   x-cloud:
#     enabled: true
#     provider: gcp
#     service: cloud_run
#     region: asia-northeast1
npm run generate-code
```

This emits the multi-stage `Dockerfile` + `.dockerignore` at the project
root (untracked by git — neither committed nor listed in `.gitignore` — so
they show up as untracked files after this step; regenerated on every
`generate-code` run), sets `next.config.ts`'s
`output: 'standalone'`, and switches the upload/serve routes to
GCS-Signed-URL (overriding the default Vercel Blob routes). None of these
exist in the tree beforehand. This step is a hard requirement of Step 3
(`gcp-deploy.sh`) — but, as verified below, NOT a requirement of Step 2
(`gcp-setup.sh`), which runs to completion without it.

### Step 1: Prepare .env.production.local

```bash
cp .env.production.local.example .env.production.local
# Fill in required values: PROJECT_ID / DATABASE_URL / DIRECT_URL / AUTH_SECRET /
#   UPSTASH_EMAIL / UPSTASH_API_KEY / SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
# DATABASE_URL / DIRECT_URL are Neon connection strings obtained from the Neon
#   console (pooled endpoint / unpooled endpoint respectively — see
#   docs/knowledge/prisma-direct-vs-pooled-connection.md). This script does not
#   provision Neon itself; reuse the same Neon project as the Vercel deployment
#   if there is one, or create a new Neon project first.
# PRISMA_DATABASE_URL can be left blank at this point (obtain in the Accelerate
#   revival procedure, docs/knowledge/manual-ops.md §1, if ever needed)
# AUTH_SECRET is generate-once-persist: if left blank,
#   gcp-env.sh will auto-generate on first run and write back to .env.production.local
```

### Step 2: Run gcp-setup.sh (idempotent infrastructure setup)

```bash
bash scripts/gcp-setup.sh
```

Does not read or depend on any `generate-code` output (verified 2026-08-12,
re-verified after the Cloud SQL→Neon reconnection: the script contains no
reference to `Dockerfile`/`docker build` at all). Step A above is not a
prerequisite for this step, but do it first anyway per the sequence above —
there is no benefit to deferring it.

Operations performed (idempotent — safe to re-run):
- Enable GCP APIs
- Create Artifact Registry
- Create service account + IAM bindings
- Automatically create Redis DB via Upstash Management API → obtain REDIS_URL
- Register the following in Secret Manager:
  - app-database-url (Neon `DATABASE_URL`, pooled)
  - app-direct-database-url (Neon `DIRECT_URL`, unpooled — used only by the
    `app-migrate` Job, see Step 3 below)
  - app-nextauth-secret (AUTH_SECRET)
  - app-gcs-bucket-name (GCS_BUCKET)
  - app-redis-url (REDIS_URL)
- Create GCS bucket + IAM bindings

There is no longer a Cloud SQL instance/DB/user to create, no public IP to
obtain, and no "register in Prisma Console" prompt at the end — the DB is
already provisioned (as a Neon project) before this script runs; it only
reads the connection strings from `.env.production.local` and registers them
as secrets. Accelerate (`PRISMA_DATABASE_URL` / `app-prisma-database-url`)
stays off by default, same as before this change — see
`docs/knowledge/manual-ops.md §1` if it is ever re-enabled.

### Step 3: Run gcp-deploy.sh (image build + deploy)

```bash
bash scripts/gcp-deploy.sh
```

**Requires the `Dockerfile` from Step A to already exist at the project
root** — the script's own internal "Step 1" (`docker build -f
"${PROJECT_ROOT}/Dockerfile"`) has no existence check; a missing
`Dockerfile` fails the build immediately
(reproduced 2026-08-12: `ERROR: failed to build: ... open Dockerfile: no
such file or directory`, before any push or `gcloud` call — this is a purely
local, no-side-effect failure). This is the exact failure hit by skipping
Step A.

**`DRY_RUN=true` does NOT catch a missing `Dockerfile`** — every
`docker build`/`docker push` call in this script is wrapped in the script's
own dry-run `run()` helper, so under `DRY_RUN=true` the command is only
echoed, never executed, regardless of whether the file exists (verified
2026-08-12: a `DRY_RUN=true` run against a tree with no `Dockerfile` printed
the would-be `docker build` line and ran through to completion of the
script's own internal Steps 1-4, only failing at the very end on an
unrelated `gcloud run services describe` lookup — because no real deploy
had actually happened). Use a real (non-`DRY_RUN`) run to
confirm the `Dockerfile` is actually present before deploying — the build
step alone is safe to test this way since it fails locally, before any
push/`gcloud` mutation, if the file is missing.

Operations performed (default = Neon pooled/direct connection):
- Docker image build + push to Artifact Registry (service + migrate images)
- Migration Job: `prisma migrate deploy` via Neon `DIRECT_URL` (unpooled) —
  see `docs/knowledge/prisma-direct-vs-pooled-connection.md` for why
  migrations must not run through the pooled endpoint
- Run seed
- Cloud Run Service deploy:
  - `--set-secrets`: DATABASE_URL / AUTH_SECRET / GCS_BUCKET / REDIS_URL
  - `--set-env-vars`: AUTH_TRUST_HOST=true / NODE_ENV=production
  - `--max-instances=10` — this instance cap and the `lib/prisma.ts`
    PrismaPg pool cap (`max: 2`) were previously sized against the
    db-f1-micro Cloud SQL tier's `max_connections=25` ceiling. That specific
    arithmetic constraint is retired along with Cloud SQL: Neon's pooled
    endpoint (PgBouncer) is designed for exactly this many-short-lived-
    connections-over-few-backend-connections fan-out, and the connection
    ceiling is now a property of the Neon plan/compute size instead of a
    fixed Cloud SQL tier. `--max-instances=10` itself is left unchanged
    here (no evidence-based replacement number to put in its place) — if it
    needs to be raised, check the Neon project's own connection limits
    first, not this script's Cloud-SQL-era comment.
  - Output Service URL (`gcloud run services describe --format='value(status.url)'`)

The Accelerate wiring (Step 0 secret registration + `PRISMA_DATABASE_URL`
guard + `--set-secrets` entry) is commented out in `gcp-deploy.sh`, not
deleted. To revive it: uncomment those three blocks, complete the Accelerate
revival procedure in `docs/knowledge/manual-ops.md §1`, and set
`PRISMA_DATABASE_URL` in `.env.production.local` — no other code changes
needed (`lib/prisma.ts` already branches on that variable).

### On Redeploy (no infrastructure changes)

```bash
bash scripts/gcp-deploy.sh  # Run Step 3 only
```

gcp-setup.sh is idempotent so re-running is safe,
but if there are no infrastructure changes, gcp-deploy.sh alone is sufficient.

### On Teardown

```bash
bash scripts/gcp-teardown.sh  # 2-step confirmation safety guard
```

Teardown: delete Upstash Redis (API) + delete GCP project (soft-delete). Does
not touch the Neon project (Neon lifecycle is managed separately, outside
these scripts). Delete the Prisma Console/Accelerate project manually if the
revival procedure in `docs/knowledge/manual-ops.md §1` was ever used.

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
