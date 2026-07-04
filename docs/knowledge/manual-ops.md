# GCP Cloud Run Manual Operations

## Operations That Cannot Be Automated

### 1. Obtain Prisma Accelerate URL (after gcp-setup.sh Step 2 of `docs/gcp-automation-design.md` completes, suspended now)

> **Prerequisite**: Run gcp-setup.sh first and note the `DATABASE_URL_PUBLIC` displayed at the end.
> Use this URL as the connection string for Cloud SQL.

1. Go to https://console.prisma.io
2. Create a project (or select existing one)
3. Enable Accelerate → enter the `DATABASE_URL_PUBLIC` output by gcp-setup.sh as the connection string
4. Obtain the issued `prisma+postgres://...` URL
5. Set it as `PRISMA_DATABASE_URL` in `.env.production.local`
   ```bash
   # .env.production.local
   PRISMA_DATABASE_URL=prisma+postgres://accelerate.prisma-data.net/?api_key=...
   ```
6. After completing the above, run `bash scripts/gcp-deploy.sh`
   (gcp-deploy.sh fails fast and redirects to this procedure if PRISMA_DATABASE_URL is empty)

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
Alternative: use the `--no-invoker-iam-check` flag (see runbook §1-6)

### 5. Confirm GCP Project Number (PROJECT_NUMBER)

```bash
gcloud projects describe $PROJECT_ID --format='value(projectNumber)'
```
