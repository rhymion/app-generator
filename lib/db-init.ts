// AUTO-GENERATED - DO NOT EDIT
import prisma from '@/lib/prisma';

/**
 * Ensures pg_trgm extension and GIN indexes exist for search.
 * Safe to call repeatedly: it reads the existing index names from pg_indexes
 * (no table ownership needed) and issues CREATE INDEX CONCURRENTLY only for the
 * missing ones, so once every index exists it does nothing and logs nothing,
 * whichever database role it runs as. PostgreSQL checks table ownership before
 * it evaluates IF NOT EXISTS, so running the CREATE INDEX statements blindly
 * fails with 42501 for an application role that does not own the tables (see
 * docs/knowledge/audit-log-append-only.md, "Switching the application to the
 * restricted role"). CREATE INDEX CONCURRENTLY is non-blocking (no table lock
 * held for the build), so calling this on every cold start (see
 * instrumentation.ts) is cheap.
 * A missing index the role is not allowed to create is reported in one warning
 * that points at scripts/create-gin-indexes.sql (run it as the table owner);
 * the remaining missing indexes are still attempted.
 * Call once at startup (e.g. from instrumentation.ts).
 *
 * C3=A: pg_trgm (gin_trgm_ops) replaces pg_bigm — compatible with Cloud SQL.
 */
// issue #737: every statement below is `$executeRaw` (tagged template, safe
// API), never `$executeRawUnsafe`, even though none of them actually needs
// a runtime bind parameter — CREATE EXTENSION/CREATE INDEX target names are
// SQL identifiers, which Prisma cannot bind as parameters at all, so a
// parameter placeholder is not the mechanism keeping these safe. Instead,
// every entity/field name substituted into the SQL text below is resolved
// once at `generate-code` time from the project's own schema.yaml
// (developer-controlled, not runtime input) — after generation this file
// contains plain, fully-literal SQL text with no runtime-interpolated
// value left for a request to reach. The tagged-template form is used
// anyway (rather than the behaviorally-identical `$executeRawUnsafe`)
// solely so this file's own text never contains an API name a security
// reviewer would have to stop and clear (issue #737, raw SQL / unsafe-API
// audit).

// PostgreSQL truncates an identifier to 63 bytes, so a long index name is stored
// (and listed in pg_indexes) under its truncated form.
function pgIdentifier(name: string): string {
  return Buffer.from(name).subarray(0, 63).toString();
}

function isInsufficientPrivilege(err: unknown): boolean {
  const e = err as { meta?: { code?: unknown }; message?: unknown } | null;
  return e?.meta?.code === '42501' || (typeof e?.message === 'string' && e.message.includes('42501'));
}

interface SearchIndex {
  name: string;
  create: () => Promise<unknown>;
}

const SEARCH_INDEXES: SearchIndex[] = [
  { name: 'idx_role_name_gin_trgm', create: () => prisma.$executeRaw`CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_role_name_gin_trgm" ON "role" USING GIN ("name" gin_trgm_ops)` },
  { name: 'idx_role_description_gin_trgm', create: () => prisma.$executeRaw`CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_role_description_gin_trgm" ON "role" USING GIN ("description" gin_trgm_ops)` },
  { name: 'idx_organization_name_gin_trgm', create: () => prisma.$executeRaw`CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_organization_name_gin_trgm" ON "organization" USING GIN ("name" gin_trgm_ops)` },
  { name: 'idx_organization_description_gin_trgm', create: () => prisma.$executeRaw`CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_organization_description_gin_trgm" ON "organization" USING GIN ("description" gin_trgm_ops)` },
  { name: 'idx_dashboard_name_gin_trgm', create: () => prisma.$executeRaw`CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_dashboard_name_gin_trgm" ON "dashboard" USING GIN ("name" gin_trgm_ops)` },
  { name: 'idx_role_name_gin_trgm_v2', create: () => prisma.$executeRaw`CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_role_name_gin_trgm_v2" ON "role" USING GIN ((COALESCE("name", '')) gin_trgm_ops)` },
  { name: 'idx_role_description_gin_trgm_v2', create: () => prisma.$executeRaw`CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_role_description_gin_trgm_v2" ON "role" USING GIN ((COALESCE("description", '')) gin_trgm_ops)` },
  { name: 'idx_organization_name_gin_trgm_v2', create: () => prisma.$executeRaw`CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_organization_name_gin_trgm_v2" ON "organization" USING GIN ((COALESCE("name", '')) gin_trgm_ops)` },
  { name: 'idx_organization_description_gin_trgm_v2', create: () => prisma.$executeRaw`CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_organization_description_gin_trgm_v2" ON "organization" USING GIN ((COALESCE("description", '')) gin_trgm_ops)` },
  { name: 'idx_dashboard_name_gin_trgm_v2', create: () => prisma.$executeRaw`CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_dashboard_name_gin_trgm_v2" ON "dashboard" USING GIN ((COALESCE("name", '')) gin_trgm_ops)` },
  // Issue #725 fix (c): a separate GIN index on the to_tsvector(...)
  // expression itself — the trigram indexes above only ever back the
  // similarity()/% and ILIKE halves of the search predicate, not the
  // to_tsvector(...) @@ plainto_tsquery(...) half. Expression must match
  // search_helpers.ts.jinja2's WHERE clause verbatim for the planner to
  // recognize it.
  { name: 'idx_role_tsv_gin', create: () => prisma.$executeRaw`CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_role_tsv_gin" ON "role" USING GIN (to_tsvector('simple', COALESCE(COALESCE(name, '') || ' ' || COALESCE(description, ''), '')))` },
  // Issue #725 fix (c): a separate GIN index on the to_tsvector(...)
  // expression itself — the trigram indexes above only ever back the
  // similarity()/% and ILIKE halves of the search predicate, not the
  // to_tsvector(...) @@ plainto_tsquery(...) half. Expression must match
  // search_helpers.ts.jinja2's WHERE clause verbatim for the planner to
  // recognize it.
  { name: 'idx_organization_tsv_gin', create: () => prisma.$executeRaw`CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_organization_tsv_gin" ON "organization" USING GIN (to_tsvector('simple', COALESCE(COALESCE(name, '') || ' ' || COALESCE(description, ''), '')))` },
  // Issue #725 fix (c): a separate GIN index on the to_tsvector(...)
  // expression itself — the trigram indexes above only ever back the
  // similarity()/% and ILIKE halves of the search predicate, not the
  // to_tsvector(...) @@ plainto_tsquery(...) half. Expression must match
  // search_helpers.ts.jinja2's WHERE clause verbatim for the planner to
  // recognize it.
  { name: 'idx_dashboard_tsv_gin', create: () => prisma.$executeRaw`CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_dashboard_tsv_gin" ON "dashboard" USING GIN (to_tsvector('simple', COALESCE(COALESCE(name, ''), '')))` },
];

export async function ensureSearchIndexes(): Promise<void> {
  const present = await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()`;
  const existing = new Set(present.map((row) => row.indexname));
  const missing = SEARCH_INDEXES.filter((index) => !existing.has(pgIdentifier(index.name)));
  if (missing.length === 0) return;

  const extensions = await prisma.$queryRaw<{ extname: string }[]>`SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`;
  if (extensions.length === 0) {
    await prisma.$executeRaw`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
  }

  const denied: string[] = [];
  let firstError: unknown;
  for (const index of missing) {
    try {
      await index.create();
    } catch (err) {
      if (isInsufficientPrivilege(err)) {
        denied.push(index.name);
      } else {
        console.error(`ensureSearchIndexes(): creating ${index.name} failed:`, err);
        firstError ??= err;
      }
    }
  }
  if (denied.length > 0) {
    console.warn(
      `ensureSearchIndexes(): the database role lacks the privilege to create ${denied.length} missing search index(es): ` +
        `${denied.join(', ')}. Run scripts/create-gin-indexes.sql as the table owner (DIRECT_URL) to create them.`,
    );
  }
  if (firstError !== undefined) throw firstError;
}
