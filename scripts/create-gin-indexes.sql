-- AUTO-GENERATED - DO NOT EDIT
-- Apply with: psql "$DATABASE_URL" -f scripts/create-gin-indexes.sql
-- Idempotent: safe to re-run.
--
-- GIN + gin_trgm_ops indexes backing similarity() (and ILIKE '%...%') lookups
-- in lib/search/helpers.ts. Kept out of prisma/schema.prisma: Prisma 7's
-- `ops: raw("gin_trgm_ops")` syntax works, but `prisma migrate dev` enters an
-- infinite drop/recreate drift loop on it (Prisma issue #16275, unresolved).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_role_name_gin_trgm"
  ON "role" USING GIN ("name" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_role_description_gin_trgm"
  ON "role" USING GIN ("description" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_organization_name_gin_trgm"
  ON "organization" USING GIN ("name" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_organization_description_gin_trgm"
  ON "organization" USING GIN ("description" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_dashboard_name_gin_trgm"
  ON "dashboard" USING GIN ("name" gin_trgm_ops);
