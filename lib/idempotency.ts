/**
 * Idempotency-key support for single-record API create endpoints
 * (ai-agent-integration-design.md "Idempotency keys and rate limiting —
 * resolved design").
 *
 * A row lives in the SAME database transaction as the record it guards --
 * unlike a Redis-backed cache, Postgres can commit or roll back both
 * together, so a crash between the two writes can never leave them out of
 * sync (the structural reason `idempotency_key` is a Prisma table, not a
 * distributed cache -- see the design doc for the full argument). Both
 * functions below therefore take the *caller's own* `tx` handle -- they
 * must be called from inside `add{{Entity}}`'s existing transaction
 * (service.ts.jinja2), never in a separate one.
 *
 * Retention (one day) is enforced logically at lookup time, not by a
 * scheduled deletion job -- the design ruling deliberately does not add a
 * new scheduling mechanism for a housekeeping delete. A row past its
 * retention window is treated as absent by {@link checkIdempotencyKey},
 * and {@link recordIdempotencyKey}'s upsert then overwrites it in place.
 */
import crypto from 'crypto';
import type { Prisma } from '@/app/generated/prisma/client';
import { AppError } from '@/lib/_errors';

const RETENTION_MS = 24 * 60 * 60 * 1000; // one day (design ruling)

/** Stable SHA-256 hex digest of a request body, used to detect an
 * Idempotency-Key reused for a materially different request. */
export function hashIdempotencyBody(body: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

type IdempotencyScope = {
  key: string;
  actorId: string;
  targetEntity: string;
};

/**
 * Looks up a prior result for `key`, scoped to this caller + entity.
 *
 * Returns the cached response body when the request body hash matches
 * (the caller should replay it, running none of the entity's own create
 * side effects again). Throws `AppError('CONFLICT', ...)` when the key was
 * reused for a genuinely different request body -- never silently replays
 * a stale result for a different body. Returns `null` when no live
 * (non-expired) row exists, meaning the caller should proceed with a
 * fresh create.
 */
export async function checkIdempotencyKey(
  tx: Prisma.TransactionClient,
  scope: IdempotencyScope & { bodyHash: string },
): Promise<unknown | null> {
  const existing = await tx.idempotency_key.findUnique({
    where: {
      idempotency_key_actor_target: {
        key: scope.key,
        actor_user_id: scope.actorId,
        target_entity: scope.targetEntity,
      },
    },
  });
  if (!existing || existing.created_at.getTime() < Date.now() - RETENTION_MS) {
    return null;
  }
  if (existing.request_hash !== scope.bodyHash) {
    throw new AppError('CONFLICT', 'Idempotency-Key was already used with a different request body');
  }
  return existing.response_body;
}

/** Records a successful create's result under `key`, in the same
 * transaction that produced it. Overwrites a same-tuple row from a prior,
 * now-expired key (the retention window's only cleanup path -- see the
 * module doc). `response_status` is always 201: this table is scoped to
 * single-record create endpoints only, and a create that reaches this
 * call has already succeeded -- there is no other status a cached create
 * result could carry. */
export async function recordIdempotencyKey(
  tx: Prisma.TransactionClient,
  scope: IdempotencyScope & { bodyHash: string; body: unknown },
): Promise<void> {
  await tx.idempotency_key.upsert({
    where: {
      idempotency_key_actor_target: {
        key: scope.key,
        actor_user_id: scope.actorId,
        target_entity: scope.targetEntity,
      },
    },
    create: {
      key: scope.key,
      actor_user_id: scope.actorId,
      target_entity: scope.targetEntity,
      request_hash: scope.bodyHash,
      response_status: 201,
      response_body: scope.body as Prisma.InputJsonValue,
    },
    update: {
      request_hash: scope.bodyHash,
      response_status: 201,
      response_body: scope.body as Prisma.InputJsonValue,
      created_at: new Date(),
    },
  });
}
