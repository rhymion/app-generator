// AUTO-GENERATED - DO NOT EDIT
import prisma from '@/lib/prisma';

/**
 * Ensures pg_trgm extension and GIN indexes exist for search.
 * Safe to call repeatedly — uses CREATE INDEX CONCURRENTLY IF NOT EXISTS,
 * which is non-blocking (no table lock held for the build) and, once the
 * index already exists, a fast existence check rather than a rebuild — so
 * calling this on every cold start (see instrumentation.ts) is cheap after
 * the first successful run.
 * Call once at startup (e.g. from instrumentation.ts).
 *
 * C3=A: pg_trgm (gin_trgm_ops) replaces pg_bigm — compatible with Cloud SQL.
 */
export async function ensureSearchIndexes(): Promise<void> {
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await prisma.$executeRawUnsafe(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_role_name_trgm" ON "role" USING GIN ("name" gin_trgm_ops)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_role_description_trgm" ON "role" USING GIN ("description" gin_trgm_ops)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_organization_name_trgm" ON "organization" USING GIN ("name" gin_trgm_ops)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_organization_description_trgm" ON "organization" USING GIN ("description" gin_trgm_ops)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_dashboard_name_trgm" ON "dashboard" USING GIN ("name" gin_trgm_ops)'
  );
  // Issue #725 fix (c): a separate GIN index on the to_tsvector(...)
  // expression itself — the trigram indexes above only ever back the
  // similarity()/% and ILIKE halves of the search predicate, not the
  // to_tsvector(...) @@ plainto_tsquery(...) half. Expression must match
  // search_helpers.ts.jinja2's WHERE clause verbatim for the planner to
  // recognize it.
  await prisma.$executeRawUnsafe(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_role_tsv_gin" ON "role" USING GIN (to_tsvector('simple', COALESCE(COALESCE(name, '') || ' ' || COALESCE(description, ''), '')))`
  );
  // Issue #725 fix (c): a separate GIN index on the to_tsvector(...)
  // expression itself — the trigram indexes above only ever back the
  // similarity()/% and ILIKE halves of the search predicate, not the
  // to_tsvector(...) @@ plainto_tsquery(...) half. Expression must match
  // search_helpers.ts.jinja2's WHERE clause verbatim for the planner to
  // recognize it.
  await prisma.$executeRawUnsafe(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_organization_tsv_gin" ON "organization" USING GIN (to_tsvector('simple', COALESCE(COALESCE(name, '') || ' ' || COALESCE(description, ''), '')))`
  );
  // Issue #725 fix (c): a separate GIN index on the to_tsvector(...)
  // expression itself — the trigram indexes above only ever back the
  // similarity()/% and ILIKE halves of the search predicate, not the
  // to_tsvector(...) @@ plainto_tsquery(...) half. Expression must match
  // search_helpers.ts.jinja2's WHERE clause verbatim for the planner to
  // recognize it.
  await prisma.$executeRawUnsafe(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_dashboard_tsv_gin" ON "dashboard" USING GIN (to_tsvector('simple', COALESCE(COALESCE(name, ''), '')))`
  );
}
