import { PrismaClient } from '../prisma/.generated-client/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: 'postgresql://fixture:fixture@localhost:5432/fixture' });
const prisma = new PrismaClient({ adapter });
export default prisma;
