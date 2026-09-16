// Hand-written, generator-independent admin-credential resolution for
// scripts/seed-baseline.ts. Split out so it can be unit-tested without a
// running database or a generated Prisma client (see
// docs/knowledge/seed-baseline-credential-hardening.md).
import * as crypto from 'node:crypto';

export const DEFAULT_ADMIN_EMAIL = 'admin@example.com';
export const DEFAULT_ADMIN_PASSWORD = 'password123';
// Fixed test/dev api_key. Not referenced by value anywhere else in the repo
// (cypress/support/test-credentials.ts's TEST_API_KEY is a separate,
// unrelated constant) — kept stable only so repeated local `db:seed-baseline`
// runs are easy to eyeball in psql/studio, not because any spec asserts it.
export const DEFAULT_ADMIN_API_KEY =
  'mk_78d1e51a47f40912f5a1787367e3f7f6ed17c314590eac84edc5b3f785a527b1';

export interface AdminCredentials {
  email: string;
  password: string;
  apiKey: string;
}

/**
 * Gate for whether seed-baseline must source admin credentials from env
 * instead of falling back to the fixed test/dev defaults.
 *
 * NODE_ENV is the axis (not a separate opt-in flag) because every
 * production-equivalent entry point already sets it without this change:
 * `vercel-build` runs under Vercel's build environment, which sets
 * NODE_ENV=production for every build (preview and production alike);
 * `build:full` and gcp-seed.sh's app-migrate Cloud Run Job (image env from
 * gcp-deploy.sh) both set NODE_ENV=production explicitly. Every test/dev
 * entry point (`test:e2e:*`, `dev:full`, plain `next dev`) either sets
 * NODE_ENV=test explicitly or leaves Next.js's development default. Reusing
 * the variable those paths already set means no caller needs a new flag —
 * the branch is correct by construction, and a caller cannot "forget" to
 * opt in to the hardened path.
 */
export function requiresExplicitCredentials(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'production';
}

/**
 * Resolves the admin email/password/api_key seed-baseline will upsert.
 *
 * - NODE_ENV=production: SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are
 *   mandatory (fail-fast if either is missing/empty — never silently fall
 *   back to the known defaults) and api_key is always freshly random.
 * - Anything else (test, development, undefined): unchanged defaults, so
 *   the many cypress specs and vitest fixtures pinned to
 *   admin@example.com/password123 keep working.
 */
export function resolveAdminCredentials(env: NodeJS.ProcessEnv): AdminCredentials {
  if (!requiresExplicitCredentials(env.NODE_ENV)) {
    return {
      email: DEFAULT_ADMIN_EMAIL,
      password: DEFAULT_ADMIN_PASSWORD,
      apiKey: DEFAULT_ADMIN_API_KEY,
    };
  }

  const email = env.SEED_ADMIN_EMAIL;
  const password = env.SEED_ADMIN_PASSWORD;
  const missing: string[] = [];
  if (!email) missing.push('SEED_ADMIN_EMAIL');
  if (!password) missing.push('SEED_ADMIN_PASSWORD');
  if (missing.length > 0) {
    throw new Error(
      `db:seed-baseline refuses to run with NODE_ENV=production without ${missing.join(' and ')} set. ` +
        'Seeding the known default credentials (admin@example.com/password123) into a production ' +
        'database is not allowed. Set the missing variable(s) before provisioning — see ' +
        'docs/knowledge/seed-baseline-credential-hardening.md.'
    );
  }

  return { email: email as string, password: password as string, apiKey: generateApiKey() };
}

export function generateApiKey(): string {
  return `mk_${crypto.randomBytes(32).toString('hex')}`;
}
