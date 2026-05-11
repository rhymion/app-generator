import { PrismaClient } from '@/app/generated/prisma/client'
import { withAccelerate } from '@prisma/extension-accelerate';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Production logs only warnings/errors. Per-query logging in prod was a hot
// per-request stderr write (one log line per Prisma call); see #5 in
// performance-plan-session.md.
const prismaLogLevels: ('query' | 'info' | 'warn' | 'error')[] =
  process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query'];

// Use Accelerate URL if available, otherwise fall back to direct connection
const createPrismaClient = async () => {
  if (process.env.PRISMA_DATABASE_URL) {
    console.log('Using Accelerate URL for Prisma Client');
    const accelerateUrl = process.env.PRISMA_DATABASE_URL
    const client = new PrismaClient({
      accelerateUrl,
      log: prismaLogLevels,
    }).$extends(withAccelerate());
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
    const client = new PrismaClient({ adapter, log: prismaLogLevels })
    return client;
  }
};

const prisma = globalForPrisma.prisma || await createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
