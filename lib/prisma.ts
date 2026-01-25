import { PrismaClient } from '@/app/generated/prisma/client'
import { withAccelerate } from '@prisma/extension-accelerate';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Use Accelerate URL if available, otherwise fall back to direct connection
const createPrismaClient = async () => {
  if (process.env.PRISMA_DATABASE_URL) {
    console.log('Using Accelerate URL for Prisma Client');
    const accelerateUrl = process.env.PRISMA_DATABASE_URL
    const client = new PrismaClient({
      accelerateUrl,
      log: process.env.NODE_ENV === 'development' ? ['query'] : [],
    }).$extends(withAccelerate());
    return client;
  } else {
    console.log('Using direct database connection for Prisma Client');
    const connectionString = `${process.env.DATABASE_URL}`;
    
    // Dynamic import to avoid bundling @prisma/adapter-pg in production
    const { PrismaPg } = await import('@prisma/adapter-pg');
    const adapter = new PrismaPg({ connectionString });
    const client = new PrismaClient({ adapter })
    return client;
  }
};

const prisma = globalForPrisma.prisma || await createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
