// Fixture-only stand-in for @/lib/idempotency -- see shims/api-auth.ts in
// this same directory for why (the real file's Prisma.TransactionClient
// type comes from the app's full schema, which declares idempotency_key --
// this fixture's isolated client doesn't).
import type { Prisma } from '../prisma/.generated-client/client';

export function hashIdempotencyBody(_body: unknown): string {
  throw new Error('fixture stub');
}

export async function checkIdempotencyKey(
  _tx: Prisma.TransactionClient,
  _scope: { key: string; actorId: string; targetEntity: string; bodyHash: string },
): Promise<unknown | null> {
  throw new Error('fixture stub');
}

export async function recordIdempotencyKey(
  _tx: Prisma.TransactionClient,
  _scope: { key: string; actorId: string; targetEntity: string; bodyHash: string; body: unknown },
): Promise<void> {
  throw new Error('fixture stub');
}
