// Fixture-only stand-in for @/lib/prisma (payment-gate check): the real
// generated Prisma client (isolated output, see scripts/
// check_payment_gate_fixture.sh) behind the same default export, so
// lib/payment/*.ts type-check against the actual `payable`, `paid_widget`
// and `paid_gadget` models. Mirrors tests/fixtures/mention_gate/shims/prisma.ts.
import { PrismaClient } from '../prisma/.generated-client/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: 'postgresql://fixture:fixture@localhost:5432/fixture' });
const prisma = new PrismaClient({ adapter });
export default prisma;
