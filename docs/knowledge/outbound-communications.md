# Outbound communications and egress restriction

This page lists every external service a generated application (and the scripts that deploy it) talks to, states
what the application never fetches, and says where an egress restriction can and cannot be set. It describes the
code in this repository; read the code paths named here before relying on a row.

## What the application never fetches

The application server issues no HTTP request whose target comes from a user or from stored data. Searching `lib/`,
`app/`, `proxy.ts` and the non-test generator templates finds no server-side `fetch(`, `axios`, `undici` or
`http(s).request` call; the only `fetch(` calls run in the browser or a test helper against the application's own
`/api/` routes. The destinations below are fixed by environment variables set by the operator or by an SDK's built-in
endpoint.

The one place a server fetches a URL on a user's behalf is the Next.js image optimizer, and `next.config.ts`
restricts it to a single host (`images.remotePatterns`: `books.google.com`). Raw `<img>` elements in the list and
upload components load their URLs in the browser and never reach the optimizer.

## Destinations of the running application

| Service | When it is used | Selected by | Endpoint |
|---------|-----------------|-------------|----------|
| PostgreSQL | always | `DATABASE_URL` | the host in the URL |
| Redis (rate limiting) | when `REDIS_URL` is set; otherwise an in-memory limiter is used | `REDIS_URL` | the host in the URL |
| Google Cloud Storage (attachments) | when `GCS_BUCKET_NAME` is set | `GCS_BUCKET_NAME` | the `@google-cloud/storage` SDK default (`storage.googleapis.com`) |
| Vercel Blob (attachments) | when `ATTACHMENT_BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID` or `BLOB_READ_WRITE_TOKEN` is set and `GCS_BUCKET_NAME` is not | those variables | the `@vercel/blob` SDK default |
| Local disk (attachments) | otherwise | `ATTACHMENT_LOCAL_DIR` | none (no network) |
| Google Cloud Storage (audit-log copies) | when `AUDIT_LOG_GCS_BUCKET` is set | `AUDIT_LOG_GCS_*` | SDK default, or `AUDIT_LOG_GCS_ENDPOINT` (a local emulator) |
| Google token exchange | with `AUDIT_LOG_GCS_AUTH=vercel-oidc` | `GCP_*` workload-identity variables | `sts.googleapis.com`, `iamcredentials.googleapis.com` |
| Amazon S3 (audit-log copies) | when `AUDIT_LOG_S3_BUCKET` is set | `AUDIT_LOG_S3_*` | the `@aws-sdk/client-s3` default for `AUDIT_LOG_S3_REGION` |
| Google sign-in | when `google` is listed in the site's auth providers and `GOOGLE_CLIENT_ID` is set | `siteConfig.auth.providers` | Google's OpenID Connect endpoints, through Auth.js |
| Stripe | only for a schema that declares `x-payment: true` | `STRIPE_SECRET_KEY` | the `stripe` SDK default (`api.stripe.com`); Stripe calls the webhook route inbound |

Audit-log copies are described in `audit-log-append-only.md`, attachment storage in `attachment-storage.md`, Stripe in
`stripe-payment-integration.md`. The default schema declares no `x-payment` entity and no audit-log bucket variable is set by default, so a default
application talks to the database, optionally Redis, one attachment backend, and Google when sign-in is configured.

## Destinations of the deploy scripts

These run on the operator's machine or in a CI job, not in the application:

| Script | Destination |
|--------|-------------|
| `scripts/vercel-setup.sh` | `api.vercel.com`, `api.upstash.com`, and whatever the Vercel CLI contacts |
| `scripts/gcp-setup.sh`, `scripts/gcp-teardown.sh` | `api.upstash.com`, Google Cloud APIs through `gcloud` |
| `scripts/gcp-task-runner-config.sh` | `run.googleapis.com` (Cloud Run Jobs) |

## Egress restriction

The application does not enforce an allow-list of destinations itself, and the deploy scripts set no egress
restriction: none of `scripts/` passes a VPC connector, VPC egress setting, firewall rule or proxy. Restricting egress
is a platform setting the operator applies to the destinations in the table above.

- The allow-list for an application is the subset of the first table that the chosen configuration uses. The database
  and Redis hosts are whatever the operator put in the two URLs.
- On Google Cloud, outbound traffic from Cloud Run is controlled through the service's VPC egress configuration and the
  VPC firewall or Cloud NAT behind it; this repository configures none of them.
- On Vercel, the project's outbound network settings are managed in the Vercel dashboard; this repository configures
  none of them.
- Whichever platform is used, include the token-exchange hosts when `AUDIT_LOG_GCS_AUTH=vercel-oidc` is on, and the
  Google sign-in hosts when Google sign-in is on.

The per-service credential and permission contract is tracked in #1241. The coverage table row for each ASVS
requirement is in `security-asvs-coverage.md` (V13.1.1, V13.2.4, V13.2.5).
