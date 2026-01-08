import { PrismaClient } from '@/app/generated/prisma/client'
import { withAccelerate } from '@prisma/extension-accelerate';
// import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

// const adapter = new PrismaBetterSqlite3({
//   url: process.env.DATABASE_URL
// });
const globalForPrisma = global as unknown as { prisma: PrismaClient };

const prisma =
  globalForPrisma.prisma || new PrismaClient({ accelerateUrl: process.env.PRISMA_DATABASE_URL as string, log: ['query'] })
  .$extends(withAccelerate());

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
