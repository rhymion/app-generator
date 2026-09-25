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
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_role_name_gin_trgm_v2"
  ON "role" USING GIN ((COALESCE("name", '')) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_role_description_gin_trgm_v2"
  ON "role" USING GIN ((COALESCE("description", '')) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_organization_name_gin_trgm"
  ON "organization" USING GIN ("name" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_organization_description_gin_trgm"
  ON "organization" USING GIN ("description" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_organization_name_gin_trgm_v2"
  ON "organization" USING GIN ((COALESCE("name", '')) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_organization_description_gin_trgm_v2"
  ON "organization" USING GIN ((COALESCE("description", '')) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_dashboard_name_gin_trgm"
  ON "dashboard" USING GIN ("name" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_dashboard_name_gin_trgm_v2"
  ON "dashboard" USING GIN ((COALESCE("name", '')) gin_trgm_ops);

-- Issue #725 fix (c): GIN index on the to_tsvector(...) expression itself —
-- the trigram indexes above only back the similarity()/% and ILIKE halves
-- of the search predicate, not the to_tsvector(...) @@ plainto_tsquery(...)
-- half. Expression must match search_helpers.ts.jinja2's WHERE clause
-- verbatim (same COALESCE/concat shape) for the planner to recognize it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_role_tsv_gin"
  ON "role" USING GIN (to_tsvector('simple', COALESCE(COALESCE(name, '') || ' ' || COALESCE(description, ''), '')));
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_organization_tsv_gin"
  ON "organization" USING GIN (to_tsvector('simple', COALESCE(COALESCE(name, '') || ' ' || COALESCE(description, ''), '')));
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_dashboard_tsv_gin"
  ON "dashboard" USING GIN (to_tsvector('simple', COALESCE(COALESCE(name, ''), '')));
