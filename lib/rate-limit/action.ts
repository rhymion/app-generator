import { AppError } from '@/lib/_errors';
import { getRateLimiter } from '@/lib/rate-limit';

/**
 * Per-user rate limit for generated Server Actions.
 *
 * A Server Action that changes data spends the same `api:write` bucket, keyed
 * by the same user id, as the equivalent REST operation (`POST`/`PUT`/`DELETE`
 * under `app/api`). A user therefore has one write budget whichever surface
 * they use, and calling the action in a loop cannot bypass the REST ceiling.
 *
 * Throws `AppError('RATE_LIMITED')`. The generated actions turn it into an
 * `ActionFailure`; the REST error mapper turns it into HTTP 429.
 */
export async function enforceActionRateLimit(
  userId: string,
  bucket: 'api:read' | 'api:write' = 'api:write',
): Promise<void> {
  const decision = await getRateLimiter().check(bucket, userId);
  if (!decision.allowed) {
    throw new AppError('RATE_LIMITED', `Rate limit reached for bucket ${bucket}; retry in ${decision.retryAfterSeconds}s`);
  }
}
