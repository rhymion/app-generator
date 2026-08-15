import { PrismaClient, type Prisma } from '@/app/generated/prisma/client'
import { withAccelerate } from '@prisma/extension-accelerate';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaNeon } from '@prisma/adapter-neon';
import { pinSslModeVerifyFull } from './db-url';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Production logs only warnings/errors. Per-query logging in prod was a hot
// per-request stderr write (one log line per Prisma call); see #5 in
// performance-plan-session.md.
const prismaLogLevels: ('query' | 'info' | 'warn' | 'error')[] =
  process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query'];

// Slow-query observability (Phase 3 #11a from performance-plan-session.md):
// emit a `query` event per call so we can filter to the long ones and surface
// them. Disabled in production by default to avoid noise; flip
// PRISMA_SLOW_QUERY_LOG=true to opt in. Override the threshold (ms) with
// PRISMA_SLOW_QUERY_THRESHOLD_MS. When enabled, `query` is routed to the
// event listener instead of stdout — the stdout query log is replaced by the
// >threshold WARN line.
const slowQueryLogEnabled =
  process.env.PRISMA_SLOW_QUERY_LOG === 'true' ||
  (process.env.NODE_ENV !== 'production' && process.env.PRISMA_SLOW_QUERY_LOG !== 'false');
const slowQueryThresholdMs = Number(process.env.PRISMA_SLOW_QUERY_THRESHOLD_MS ?? 50);

function attachSlowQueryListener(client: PrismaClient<'query'>): void {
  if (!Number.isFinite(slowQueryThresholdMs)) return;
  client.$on('query', (e: Prisma.QueryEvent) => {
    if (e.duration >= slowQueryThresholdMs) {
      // Single-line WARN so log aggregators can grep on `prisma slow-query`.
      console.warn(
        `[prisma slow-query ${e.duration}ms] ${e.query} -- params=${e.params}`,
      );
    }
  });
}

// Use Accelerate URL if available, otherwise fall back to direct connection.
// Accelerate is off by default (PRISMA_DATABASE_URL unset) because it has
// never reached this environment's Cloud SQL instance — GOOGLE_MANAGED_INTERNAL_CA
// TLS verification fails (rca_266a/267a). Doreen is following up with
// Prisma support after other urgent work; once resolved, set PRISMA_DATABASE_URL
// again to switch back to this branch without further code changes.
const createPrismaClient = () => {
  if (process.env.PRISMA_DATABASE_URL) {
    const accelerateUrl = process.env.PRISMA_DATABASE_URL;
    // Fail fast if PRISMA_DATABASE_URL is a placeholder (e.g. created by
    // docs/knowledge/manual-ops.md §1 without replacing <YOUR_ACCELERATE_API_KEY>).
    // A placeholder passes the truthy check above but causes P1001 +
    // driverAdapterError on the first query.
    if (!accelerateUrl.startsWith('prisma://') && !accelerateUrl.startsWith('prisma+postgres://')) {
      throw new Error(
        `[prisma] PRISMA_DATABASE_URL must start with prisma:// or prisma+postgres://. ` +
        `Got: "${accelerateUrl.slice(0, 30)}..." — see docs/knowledge/manual-ops.md §1.`
      );
    }
    console.log('Using Accelerate URL for Prisma Client');
    // log option is absent from all official Prisma 7 + Accelerate examples.
    // Accelerate monitoring belongs in the Prisma dashboard, not local events.
    const client = new PrismaClient({
      accelerateUrl,
    }).$extends(withAccelerate()) as unknown as PrismaClient;
    return client;
  } else if (process.env.USE_NEON_ADAPTER === 'true') {
    // Vercel+Neon only (cmd_692/cmd_654(は)). Deliberately NOT a NODE_ENV
    // branch — cmd_528 measured Turbopack baking process.env.NODE_ENV into
    // the build in all three access forms (dot/bracket/destructured), so a
    // NODE_ENV-gated branch can't be toggled at runtime. USE_NEON_ADAPTER is
    // a plain, non-NEXT_PUBLIC_ server env var, read only inside this
    // Node.js-only module — never bundled for the client, never baked in.
    // Unset (the default everywhere except Vercel Production/Preview once
    // Doreen sets it there): falls straight through to the existing PrismaPg
    // branch below with zero behavior change — GCP Cloud Run and local/CI
    // never set this var, so they always take that branch.
    console.log('Using Neon adapter for Prisma Client');
    const rawUrl = `${process.env.DATABASE_URL}`;

    // Same URL handling as the PrismaPg branch below (schema extraction +
    // statement_timeout) — Postgres connection-string semantics, not a
    // pg-vs-neon-driver concern. Duplicated rather than extracted into a
    // shared helper so the existing PrismaPg branch stays byte-for-byte
    // unmodified (task instruction: leave existing branches' internal logic
    // untouched).
    let connectionString = rawUrl;
    let schemaName: string | undefined;
    try {
      const u = new URL(rawUrl);
      const s = u.searchParams.get('schema');
      if (s) {
        schemaName = s;
        u.searchParams.delete('schema');
      }
      const rawTimeout = process.env.STATEMENT_TIMEOUT_MS;
      const parsedTimeout = (rawTimeout == null || rawTimeout === '') ? NaN : parseInt(rawTimeout, 10);
      const timeoutMs = Number.isNaN(parsedTimeout) ? 30000 : parsedTimeout;
      u.searchParams.set('statement_timeout', String(timeoutMs));
      connectionString = u.toString();
    } catch { /* malformed URL — fall through with original values */ }
    // @neondatabase/serverless (the driver behind PrismaNeon) bundles its own
    // copy of pg-connection-string (see node_modules/@neondatabase/serverless
    // package.json) with the same prefer/require/verify-ca sslmode handling
    // as node-postgres, so it carries the same future-deprecation exposure
    // the PrismaPg branch below guards against. Pin it here too; see
    // lib/db-url.ts. No-op when sslmode is absent from the URL.
    connectionString = pinSslModeVerifyFull(connectionString);

    // PrismaNeon's config is a `neon.PoolConfig` (re-exported `pg.PoolConfig`
    // shape — https://neon.com/docs/guides/prisma), so `connectionString`/
    // `max` line up with the PrismaPg branch's adapter config. No
    // `neonConfig.webSocketConstructor` override needed: this project's
    // supported Node versions (package.json engines: ^22.22.2 || ^24.15.0 ||
    // >=26.0.0) all ship a native global `WebSocket`, which
    // @neondatabase/serverless (a transitive dep pulled in by
    // @prisma/adapter-neon — not installed directly, per Neon's own
    // guidance) falls back to automatically when no constructor is set.
    const adapter = new PrismaNeon(
      { connectionString, max: 2 },
      schemaName ? { schema: schemaName } : undefined,
    );
    if (slowQueryLogEnabled) {
      const stdoutLevels = prismaLogLevels.filter((l) => l !== 'query');
      const client = new PrismaClient({
        adapter,
        log: [{ emit: 'event', level: 'query' }, ...stdoutLevels],
      });
      attachSlowQueryListener(client);
      return client as unknown as PrismaClient;
    }
    const client = new PrismaClient({ adapter, log: prismaLogLevels });
    return client;
  } else {
    console.log('Using direct database connection for Prisma Client');
    const rawUrl = `${process.env.DATABASE_URL}`;

    // PrismaPg passes the connection string to pg.Pool, which ignores Prisma's
    // ?schema= extension. Strip it from the URL and pass it via the adapter's
    // native schema option so PrismaPg sets the correct PostgreSQL search_path.
    let connectionString = rawUrl;
    let schemaName: string | undefined;
    try {
      const u = new URL(rawUrl);
      const s = u.searchParams.get('schema');
      if (s) {
        schemaName = s;
        u.searchParams.delete('schema');
      }
      // Bound how long a runaway query can hold a connection open. Set
      // STATEMENT_TIMEOUT_MS=0 to disable (e.g. for long-running batch jobs).
      // `|| 30000` previously treated 0 as falsy, silently coercing an
      // explicit disable request back to the default — distinguish "not set"
      // (NaN) from "explicitly 0" instead.
      const rawTimeout = process.env.STATEMENT_TIMEOUT_MS;
      const parsedTimeout = (rawTimeout == null || rawTimeout === '') ? NaN : parseInt(rawTimeout, 10);
      const timeoutMs = Number.isNaN(parsedTimeout) ? 30000 : parsedTimeout;
      u.searchParams.set('statement_timeout', String(timeoutMs));
      connectionString = u.toString();
    } catch { /* malformed URL — fall through with original values */ }
    // Pin the SSL verification mode Neon's DSN embeds (sslmode=require) so a
    // future pg-connection-string major version doesn't silently weaken it;
    // see lib/db-url.ts. No-op for local/CI URLs, which have no sslmode param.
    connectionString = pinSslModeVerifyFull(connectionString);

    // Statically imported (see top of file) rather than dynamically: a
    // dynamic import here made this function async, which forced a
    // top-level `await createPrismaClient()` below — and Cypress's Node
    // task runner transforms required modules to CJS via esbuild, which
    // rejects top-level await outright. cypress/support/db-helpers.ts
    // already imports PrismaPg statically with no bundling issues, so
    // this mirrors an established, safe pattern (cmd_538).
    // Pool cap for the socket path (rca_267a §6, Option A): Cloud Run
    // max-instances=10 × pool max=2 = 20 connections < Cloud SQL db-f1-micro
    // max_connections=25, leaving headroom for admin/migration connections.
    // `max` is a pg.PoolConfig field on the adapter's first constructor arg
    // (Prisma 7 PrismaPg API — https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/connection-pool).
    const adapter = new PrismaPg(
      { connectionString, max: 2 },
      schemaName ? { schema: schemaName } : undefined,
    );
    if (slowQueryLogEnabled) {
      // Replace the stdout `query` level with an event-shaped one so $on('query')
      // fires. Other levels (info/warn/error) keep going to stdout.
      const stdoutLevels = prismaLogLevels.filter((l) => l !== 'query');
      const client = new PrismaClient({
        adapter,
        log: [{ emit: 'event', level: 'query' }, ...stdoutLevels],
      });
      attachSlowQueryListener(client);
      return client as unknown as PrismaClient;
    }
    const client = new PrismaClient({ adapter, log: prismaLogLevels })
    return client;
  }
};

const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
