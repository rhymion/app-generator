# GCP Environment Automation Script Design

**cmd_264 / 2026-07-02**
**Target**: `~/work/sandbox/app-generator-2` (branch: doreen/cloud)
**Status**: Pending approval

---

## 0. Objective (North Star)

Automate GCP (x-cloud) environment setup and teardown for generated apps using reproducible scripts,
eliminating manual dependencies to establish sustainable operation.

- Environment differences are absorbed by `.env.production.local` (per-project)
- PoC's `db push` is switched to `prisma migrate deploy` in production
- Automate Upstash / Prisma via API/CLI to the extent possible

---

## 1. ① Script Placement Strategy

### Option A: Template emitted by generator to all apps

```
code_generator/templates/scripts/gcp-setup.sh.jinja2
code_generator/templates/scripts/gcp-teardown.sh.jinja2
```

| Aspect | Evaluation |
|------|------|
| All projects auto-updated | ✓ |
| Generator is SoT | ✓ |
| Template changes propagate to all projects | Risk (re-generate required even for GCP config changes unrelated to entities) |
| Handling secrets / per-project values | Complex (expand PROJECT_ID etc. in jinja2? or placeholder?) |
| Multi-cloud coexistence (x-cloud) | Conditional branching becomes complex |

### Option B: Static script within app (SoT = each app) **[Recommended]**

```
scripts/gcp-setup.sh        # Environment setup (equivalent to §1-1 to §1-7)
scripts/gcp-teardown.sh     # Environment teardown (equivalent to Phase 3)
scripts/gcp-env.sh          # Variable definitions (source to use)
.env.production.local.example  # Secrets template
```

| Aspect | Evaluation |
|------|------|
| Simple, each app can be individually adjusted | ✓ |
| Clear SoT (within app repository) | ✓ |
| No generator update required | ✓ |
| Individual copy required per project | Downside (initial setup only) |
| Simple secrets handling | ✓ (sourced from `.env.production.local`) |

**Rationale**: GCP provisioning is unrelated to entity schema. Outside generator's responsibility.  
Per-project adjustments (INSTANCE_NAME, REGION, etc.) are needed; benefit from templating is small.  
→ **Approval required: DP-1**

---

## 2. ② Production DB Connection

### Current State

```typescript
// lib/prisma.ts
if (process.env.PRISMA_DATABASE_URL) {
  // Accelerate path: new PrismaClient({ accelerateUrl }).$extends(withAccelerate())
} else {
  // Direct socket path / dev
  const client = new PrismaClient({ adapter, log: prismaLogLevels })
}
```

### Option A: Accelerate (PRISMA_DATABASE_URL) **[Recommended]**

```bash
# Deploy command (Accelerate path)
gcloud run deploy $SERVICE_NAME \
  --set-secrets="PRISMA_DATABASE_URL=app-prisma-database-url:latest" \
  # --add-cloudsql-instances not required
```

| Aspect | Evaluation |
|------|------|
| No code changes required (already implemented) | ✓ (lib/prisma.ts branch already in place) |
| Cloud SQL VPC not required | ✓ (Accelerate acts as proxy) |
| Serverless / scale-to-zero compatible | ✓ |
| Connection pool | Managed by Accelerate |
| Cost | Accelerate Free Plan → $0 (PoC OK) |
| Prisma Console manual setup | Downside (cannot automate via CLI — see ④) |

### Option B: Direct socket (--add-cloudsql-instances)

```bash
# Deploy command (direct socket path)
gcloud run deploy $SERVICE_NAME \
  --add-cloudsql-instances="${PROJECT_ID}:${REGION}:${INSTANCE_NAME}" \
  --set-secrets="DATABASE_URL=app-database-url:latest" \
  # PRISMA_DATABASE_URL not required
```

| Aspect | Evaluation |
|------|------|
| Verified working in production PoC | ✓ |
| Prisma Console not required | ✓ |
| Reverts on Cloud Run redeploy | ⚠️ (see runbook §1-6 note) |
| `prisma.$extends(withAccelerate())` does not function | ⚠️ (lib/prisma.ts branch includes non-Accelerate path) |

**Recommendation**: Default to Option A (Accelerate), but prepare scripts for both paths.  
→ Split into `scripts/gcp-setup-accelerate.sh` / `scripts/gcp-setup-socket.sh`  
→ **Approval required: DP-2**

---

## 3. ③ Migration Baseline Strategy

### Problem

- Generator does not emit `prisma/migrations/` (equivalent to `db push` only)
- `prisma migrate deploy` is recommended for production
- `db push --accept-data-loss` is PoC-only (risk of data loss)

### Option A: Manual baseline + VCS tracking **[Recommended]**

```bash
# Run once manually only (outside scripts — run by operator)
npx prisma migrate dev --name baseline
git add prisma/migrations/
git commit -m "chore: add prisma baseline migration"
```

Subsequent generator changes: run `prisma migrate dev --name <change-name>` manually or via script

| Aspect | Evaluation |
|------|------|
| Prisma recommended pattern | ✓ |
| Production safe | ✓ (`migrate deploy` protects data) |
| Generator does not touch it | ✓ (migrations/ is VCS-tracked, not a generator target) |
| Initial manual step | One-time only |

### Option B: Generate baseline migration as static SQL in scripts/

```
scripts/migrations/0000_baseline.sql
```

- Requires a mechanism for generator to output SQL from schema → additional implementation cost
- Complex consistency management with Prisma migrate

### Option C: Continue `prisma db push --accept-data-loss` (PoC only)

- Existing PoC deploy scripts use this
- Not recommended for production (risk of data loss)
- Acceptable at PoC stage

**Recommendation**: Continue Option C (`db push`) for PoC → migrate to Option A at production go-live  
→ **Approval required: DP-3 (add to dashboard 🚨 Pending Approval)**

---

## 4. ④ Upstash / Prisma Platform API Automation Feasibility (Research Results)

### 4-1. Upstash Management API

**Research method**: WebFetch → `https://upstash.com/docs/devops/developer-api` + llms.txt

**Conclusion**: **Automation possible ✓**

| Item | Details |
|------|------|
| API available | ✓ Provided as Upstash Developer API |
| Authentication | Token-based (issue API key via Console) |
| Create Redis DB | `POST /v2/redis/database` (global) |
| Delete Redis DB | `DELETE /v2/redis/database/{id}` |
| List Redis DB | `GET /v2/redis/database` |
| Other | Password reset, plan change, backup management |

**Script plan** (implement after DP-4 approval):

```bash
# Environment variables
UPSTASH_EMAIL="your@email.com"
UPSTASH_API_KEY="..."   # Issue in Console, add to .env.production.local

# Create Redis database
UPSTASH_RESPONSE=$(curl -s -X POST \
  -H "Authorization: Basic $(echo -n "${UPSTASH_EMAIL}:${UPSTASH_API_KEY}" | base64)" \
  -H "Content-Type: application/json" \
  -d '{"name":"app-rate-limit","region":"ap-northeast-1","tls":true}' \
  https://api.upstash.com/v2/redis/database/global)

REDIS_URL=$(echo "$UPSTASH_RESPONSE" | jq -r '.endpoint + ":6379"')
# → Register in Secret Manager → deploy --update-secrets=REDIS_URL=app-redis-url:latest
```

### 4-2. Prisma Platform CLI

**Research method**: WebFetch → `https://www.prisma.io/docs/platform/platform-cli/commands`

**Conclusion**: **Automation not possible ✗ (manual required)**

| Item | Details |
|------|------|
| CLI commands | `prisma platform status` only |
| Create Accelerate URL | Web UI only (Prisma Console) |
| Create project | Web UI only |
| API key management | Web UI only |

**Manual procedure (documented in runbook §1-3.5):**
1. Log in to `https://console.prisma.io`
2. Create project → Enable Accelerate
3. Obtain connection string (`prisma://...?api_key=...`)
4. Update via `gcloud secrets versions add app-prisma-database-url --data-file=-`

---

## 5. ⑤ Complete Environment Variable List

### 5-1. Secret Manager (sensitive information)

| Secret name | Corresponding env var | Value format | When to set |
|-----------|-------------|---------|--------------|
| `app-database-url` | `DATABASE_URL` | `postgresql://postgres:PASSWORD@localhost/DB_NAME?host=/cloudsql/CONN_NAME` | After §1-2 |
| `app-prisma-database-url` | `PRISMA_DATABASE_URL` | `prisma://accelerate.prisma-data.net/?api_key=...` | After §1-3.5 |
| `app-nextauth-url` | `NEXTAUTH_URL` | `https://SERVICE_URL` | Update after deploy |
| `app-nextauth-secret` | `AUTH_SECRET` | Random 32+ characters | §1-3 |
| `app-gcs-bucket-name` | `GCS_BUCKET` | `${PROJECT_ID}-app-uploads` | §1-3 |
| `app-redis-url` | `REDIS_URL` | `rediss://:PASSWORD@HOST:PORT` | §1-3.7 (production) |

### 5-2. --set-env-vars (non-sensitive)

| Env var | Value | Notes |
|---------|-----|------|
| `NODE_ENV` | `production` | Required |
| `AUTH_TRUST_HOST` | `true` | Required for non-Vercel |
| `PRISMA_SLOW_QUERY_LOG` | `true` | Optional, for debugging |
| `PRISMA_SLOW_QUERY_THRESHOLD_MS` | `100` | Optional |

### 5-3. Script-internal Variables (GCP settings)

```bash
# scripts/gcp-env.sh (source to use)
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
REGION=asia-northeast1
SERVICE_NAME=app
INSTANCE_NAME=app-pg16
DB_NAME=appdb
DB_PASSWORD=""                    # Must be set manually
SA_NAME=app-cloud-run-sa
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
REPO_NAME=app-generator
GCS_BUCKET="${PROJECT_ID}-app-uploads"
CLOUD_SQL_CONNECTION_NAME="${PROJECT_ID}:${REGION}:${INSTANCE_NAME}"
IMAGE="asia-northeast1-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/app:latest"
```

### 5-4. .env.production.local.example Template

```bash
# .env.production.local.example
# Copy this file to .env.production.local and fill in the values.
# .env.production.local is in .gitignore (contains secrets)

# ── GCP Project ──
PROJECT_ID=your-project-id
REGION=asia-northeast1
SERVICE_NAME=app
INSTANCE_NAME=app-pg16

# ── Cloud SQL ──
DB_PASSWORD=your-db-password        # Value set when creating Cloud SQL instance

# ── Prisma Accelerate ── (when Option A is selected)
# Obtain from Prisma Console (console.prisma.io)
PRISMA_ACCELERATE_API_KEY=your-accelerate-api-key

# ── Upstash Redis ── (production / when DP-4 is adopted)
UPSTASH_EMAIL=your@email.com
UPSTASH_API_KEY=your-upstash-api-key

# ── NextAuth ──
AUTH_SECRET=your-random-secret-min-32-chars
```

---

## 6. Operation Sequence

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

### Step 3: [Manual] Obtain Accelerate URL from Prisma Console

> **This step cannot be automated (Prisma Platform API does not support URL issuance)**
> See `docs/manual-ops.md §1`

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

## 7. DP-1 to DP-4 Approval Points

| DP | Subject | Options | Recommended | Impact |
|----|------|--------|--------|------|
| **DP-1** | Script placement strategy | A: generator template / **B: static script** | B | Overall implementation approach |
| **DP-2** | Production DB connection | **A: Accelerate** / B: direct socket / C: both | A (both also acceptable) | Deploy script design |
| **DP-3** | Migration baseline | A: manual+VCS tracking / B: static SQL / **C: db push (PoC) → migrate to A** | C→A | 🚨 Production not recommended |
| **DP-4** | Upstash API automation | **A: adopt (API confirmed)** / B: continue manually | A | Whether to script §1-3.7 |

---

## 8. Deliverables (Implementation Phase after Approval)

| File path | Contents | DP dependency |
|------------|------|--------|
| `scripts/gcp-env.sh` | GCP variable definitions (for sourcing) | DP-1=B |
| `scripts/gcp-setup.sh` | Environment setup (automate §1-1 to §1-7) | DP-1=B, DP-2 |
| `scripts/gcp-teardown.sh` | Environment teardown (automate Phase 3) | DP-1=B |
| `scripts/gcp-deploy.sh` | Redeploy (image build + deploy) | DP-1=B, DP-2 |
| `.env.production.local.example` | Secrets template | DP-1=B |
| `docs/migration-guide.md` | Migration baseline procedure | DP-3 |
| (Upstash API section in gcp-setup.sh) | Auto-create Redis DB | DP-4=A |

---

*Designer: gunshi / 2026-07-02*
*Research: Upstash Developer API (confirmed ✓) / Prisma Platform CLI (platform status only — manual required)*
