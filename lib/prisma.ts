import { PrismaClient, type Prisma } from '@/app/generated/prisma/client'
import { withAccelerate } from '@prisma/extension-accelerate';

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

// Use Accelerate URL if available, otherwise fall back to direct connection
const createPrismaClient = async () => {
  if (process.env.PRISMA_DATABASE_URL) {
    const accelerateUrl = process.env.PRISMA_DATABASE_URL;
    // Fail fast if PRISMA_DATABASE_URL is a placeholder (e.g. created by runbook §1-3
    // without replacing <YOUR_ACCELERATE_API_KEY>). A placeholder passes the truthy
    // check above but causes P1001 + driverAdapterError on the first query.
    if (!accelerateUrl.startsWith('prisma://') && !accelerateUrl.startsWith('prisma+postgres://')) {
      throw new Error(
        `[prisma] PRISMA_DATABASE_URL must start with prisma:// or prisma+postgres://. ` +
        `Got: "${accelerateUrl.slice(0, 30)}..." — see gcp-cloud-run-runbook.md §1-3.5.`
      );
    }
    console.log('Using Accelerate URL for Prisma Client');
    // log option is absent from all official Prisma 7 + Accelerate examples.
    // Accelerate monitoring belongs in the Prisma dashboard, not local events.
    const client = new PrismaClient({
      accelerateUrl,
    }).$extends(withAccelerate()) as unknown as PrismaClient;
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
        connectionString = u.toString();
      }
    } catch { /* malformed URL — fall through with original values */ }

    // Dynamic import to avoid bundling @prisma/adapter-pg in production
    const { PrismaPg } = await import('@prisma/adapter-pg');
    const adapter = new PrismaPg({ connectionString }, schemaName ? { schema: schemaName } : undefined);
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

const prisma = globalForPrisma.prisma || await createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
