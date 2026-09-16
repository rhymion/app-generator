# GCP Cloud Run Migration Guide

## Overview
- The generator does not emit prisma/migrations/
- Production requires `prisma migrate deploy` → the migrations/ folder must exist
- Ruling DP-3=A: manual baseline on first run + track migrations/ in VCS

## Initial baseline migration procedure (PoC → production)

Step 1: Run in the local environment
```bash
cd <app-generator root dir>
# Baseline for existing DB
npx prisma migrate dev --name baseline
# → generates prisma/migrations/YYYYMMDDHHMMSS_baseline/migration.sql
```

Step 2: Track the migration file in VCS (of wrapper repository) 
```bash
cd <wrapper repository root dir>
cp prisma/migrations ../proj/prisma/
git add prj/prisma/migrations/
git commit -m "chore: add baseline migration"
```

Step 3: Subsequent schema changes
- Modify json_schema.yaml → generate-code → prisma/schema.prisma is updated
- Create a new migration with `npx prisma migrate dev --name <description>`
- Commit prisma/migrations/ to VCS

## Applying to production DB (migrate Job inside gcp-setup.sh / gcp-deploy.sh)

```bash
# Command executed internally by the migrate Job
cd <app-generator root dir>
npx prisma migrate deploy
# → applies pending migrations in prisma/migrations/ in order
```

## Update: migration logic moved from gcp-setup.sh to gcp-deploy.sh, no db-push fallback

`gcp-setup.sh` no longer contains any migration logic at all — it is now pure
one-time infra provisioning (APIs, Artifact Registry, Cloud SQL, service account,
Upstash, Secret Manager, GCS bucket). The `prisma migrate deploy` step lives
entirely in `scripts/gcp-deploy.sh` (Steps 2-3: a dedicated `app-migrate` Job runs
`prisma migrate deploy` against Cloud SQL, on every deploy, before the new
revision rolls out). There is no `db push --accept-data-loss` fallback left
anywhere in the deploy scripts — `gcp-deploy.sh`'s own comments describe the
migrate-deploy path as forward-only and explicitly contrast it with `db push
--accept-data-loss` ("NEVER drops data, unlike db push"), not as a fallback pair.

## Notes

- The generator does not emit prisma/migrations/ (SoT is json_schema.yaml + prisma/schema.prisma only)
- `prisma migrate dev` must be run manually for every schema change
- `prisma migrate deploy` (run by `scripts/gcp-deploy.sh`'s migrate Job) is the only
  production path; a plain `prisma db push --accept-data-loss` is not part of the
  GCP deploy flow at all — it remains available as a raw Prisma CLI command
  (`npm run db:push`) for local/PoC use, but nothing in `scripts/gcp-*.sh` invokes it
