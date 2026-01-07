import { PrismaClient } from '@/app/generated/prisma/client'

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const prisma =
  globalForPrisma.prisma || new PrismaClient({ accelerateUrl: process.env.DATABASE_URL as string, log: ['query'] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
