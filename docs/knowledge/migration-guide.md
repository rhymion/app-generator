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

## During PoC phase (when migrations/ does not exist)

gcp-setup.sh attempts `prisma migrate deploy`, but falls back to
`prisma db push --accept-data-loss` when migrations/ is empty (PoC only).
Always create a baseline migration before going live in production.

## Notes

- The generator does not emit prisma/migrations/ (SoT is json_schema.yaml + prisma/schema.prisma only)
- `prisma migrate dev` must be run manually for every schema change
- `prisma db push --accept-data-loss` is allowed only in PoC (risk of data loss in production)
