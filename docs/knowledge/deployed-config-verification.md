# Verifying a deployed app's security configuration

Two read-only scripts check, after each deployment, that the platform is configured the way the deploy scripts
intend (Issue #1244). They complement the setup scripts, which configure a deployment but never look at it again.

```bash
./scripts/gcp-verify.sh      # GCP: attachment (and audit-log) bucket, Secret Manager
./scripts/vercel-verify.sh   # Vercel: environment variables per target, from the linked project directory
```

Each prints one `PASS <setting>` / `FAIL <setting>: <reason>` line per check (`INFO` for a check that does not
apply), then a summary; the exit status is 1 when any check failed and 2 on a setup error (CLI missing, project not
set). The output names settings, never values, so it can be pasted into an Issue.

## What is checked

| Script | Check | How (read-only) |
|--------|-------|-----------------|
| `gcp-verify.sh` | Attachment bucket (`GCS_BUCKET`, default `<PROJECT_ID>-app-uploads`) enforces Public Access Prevention | `gcloud storage buckets describe` |
| | It uses uniform bucket-level access | `gcloud storage buckets describe` |
| | Its IAM policy has no `allUsers` / `allAuthenticatedUsers` binding | `gcloud storage buckets get-iam-policy` |
| | The same three for the audit-log bucket, when `AUDIT_LOG_GCS_BUCKET` is set | as above |
| | Secrets the service needs exist: `app-database-url`, `app-direct-database-url`, `app-auth-secret`, `app-nextauth-secret`, `app-gcs-bucket-name` (`app-cron-secret`, `app-redis-url` reported when present) | `gcloud secrets list` (names only) |
| `vercel-verify.sh` | Production has `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `CRON_SECRET`, `REDIS_URL` | `vercel env ls` |
| | When Preview has any variable, it has its own `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `CRON_SECRET` | `vercel env ls` |
| | No secret (`DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `CRON_SECRET`, `REDIS_URL`, `BLOB_READ_WRITE_TOKEN`, `GOOGLE_CLIENT_SECRET`) is one entry shared by Production and Preview | `vercel env ls` |

"Production and Preview do not share secrets" is checked **by name**: a secret's value cannot be compared without
reading it, which these scripts never do. `scripts/vercel-env.sh` gives each target its own entry (Preview from
`NAME_STAGING`, never a copy of the Production value), so an entry that applies to both targets is the detectable form
of sharing. Two entries that happen to hold the same value are not detected; `vercel-env.sh` refuses to create them.

Not checked, and left to the platform or a manual look: Vercel Blob store access (the store's private/public setting
is not exposed by `vercel env ls`), request smuggling and other edge behaviour (V4.2.1), Cloud Run settings.

## Guarantees

- **Read-only**: only `describe`, `get-iam-policy`, `list` and `env ls` are called; no create, update, delete,
  IAM change, `secrets versions access` or `vercel env pull`. `scripts/deploy-verify.test.ts` runs both scripts
  against stub CLIs and fails if any other command is issued.
- **No secret values**: settings are read from the environment or `.env.production.local` without sourcing it, and
  only non-secret names (project id, bucket names) are taken from it. The test puts secret values in that file and
  fails if one reaches the output.
- **No credentials on the command line**: the scripts use the existing `gcloud auth login` / `vercel login`.

The shared output helper is `scripts/deploy-verify-common.sh`. The checks are exercised against stub CLIs only; the
`vercel env ls` table layout they parse (name, value, environments, created) should be confirmed once against a real
project after a CLI upgrade.
