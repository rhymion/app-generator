// Test fixture: ensure the bootstrap "default" tenant exists.
//
// Phase 1.2 introduces a NOT NULL `tenant_id` on `user` with a column
// default of 'default'. Every test that creates users (the generated
// seedTestDatabase, ad-hoc fixtures in helpers) therefore depends on
// the tenant row with id 'default' existing first. resetTestDatabase
// wipes the tenants table along with everything else, so this helper
// runs after the reset to put the row back.
//
// The generated cypress/support/db-helpers.ts file is auto-generated
// (do not edit) — wiring this helper here keeps Phase 1 working until
// ticket 3.5 updates the test_db_helpers template to seed the tenant
// directly.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/app/generated/prisma/client';

const connectionString = `${process.env.DATABASE_URL}`;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

export const DEFAULT_TENANT_ID = 'default';

export async function ensureDefaultTenant(): Promise<void> {
  await prisma.tenant.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      id: DEFAULT_TENANT_ID,
      slug: 'default',
      name: 'Default Tenant',
      status: 'active',
    },
  });
}
