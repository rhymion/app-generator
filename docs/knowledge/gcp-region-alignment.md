# Cloud Run Region ↔ Database Region Alignment

## Why this matters

`scripts/gcp-env.sh` sets `REGION` (Cloud Run service region, Artifact
Registry location) independently of wherever the database `DATABASE_URL`/
`DIRECT_URL` actually points at. If the two are in different geographic
regions, every query pays a cross-region network round trip — the same
mechanism `docs/knowledge/vercel-region-alignment.md` documents for the
Vercel deploy path, just on the GCP side.

This project's GCP deploy already runs against Neon (see the header comment
in `scripts/gcp-deploy.sh` — the retired direct Cloud SQL socket path no
longer applies), so the region that matters to align against is **the
Neon project's region**, not a GCP-side database resource.

## What to check before deploying

1. `REGION` in `.env.production.local` (read by `scripts/gcp-env.sh`,
   defaults to `asia-northeast1` if unset) — this is where the Cloud Run
   service and its Artifact Registry repository are created.
2. `code_generator/json_schema.yaml`'s `x-cloud.region` — feeds the same
   value into `generate.py`'s GCP artifact generation (see
   `docs/knowledge/gcp-automation-design.md` Step A). Keep this in sync with
   (1); nothing currently cross-checks the two against each other.
3. The Neon project's region (visible in the Neon console, or in the host
   segment of `DATABASE_URL`, e.g. `...-ap-northeast-1.aws.neon.tech`).

**(1) and (2) should match (3).** No automated check enforces this today —
this is a manual pre-deploy check, unlike the Vercel path, where
`code_generator/generate.py`'s `_VERCEL_JSON_DEFAULTS` self-heals a missing
`vercel.json` `regions` key. Extending that kind of self-heal/verification
to the GCP path is a natural follow-up, not yet implemented.

## What this does not cover

`UPSTASH_PRIMARY_REGION` (Redis) is a separate setting with its own default
(`ap-northeast-1`) in `scripts/gcp-env.sh` — align it the same way against
wherever the Upstash instance actually lives, independently of the
Cloud Run/Neon pair above.
