// AUTO-GENERATED - DO NOT EDIT
import prisma from '@/lib/prisma';

/**
 * Ensures pg_trgm extension and GIN indexes exist for ILIKE-accelerated search.
 * Safe to call repeatedly — uses CREATE ... IF NOT EXISTS.
 * Call once at startup (e.g. from instrumentation.ts).
 *
 * C3=A: pg_trgm (gin_trgm_ops) replaces pg_bigm — compatible with Cloud SQL.
 */
export async function ensureSearchIndexes(): Promise<void> {
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "idx_role_name_trgm" ON "role" USING GIN ("name" gin_trgm_ops)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "idx_role_description_trgm" ON "role" USING GIN ("description" gin_trgm_ops)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "idx_organization_name_trgm" ON "organization" USING GIN ("name" gin_trgm_ops)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "idx_organization_description_trgm" ON "organization" USING GIN ("description" gin_trgm_ops)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "idx_dashboard_name_trgm" ON "dashboard" USING GIN ("name" gin_trgm_ops)'
  );
}
