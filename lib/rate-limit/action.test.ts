import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/_errors';

const check = vi.fn();
vi.mock('@/lib/rate-limit', () => ({ getRateLimiter: () => ({ check }) }));

import { enforceActionRateLimit } from './action';

describe('enforceActionRateLimit', () => {
  afterEach(() => check.mockReset());

  it('spends the api:write bucket keyed by the user id by default', async () => {
    check.mockResolvedValue({ allowed: true, remaining: 5, retryAfterSeconds: 0, resetAt: 0 });
    await expect(enforceActionRateLimit('user-1')).resolves.toBeUndefined();
    expect(check).toHaveBeenCalledWith('api:write', 'user-1');
  });

  it('throws RATE_LIMITED once the bucket is spent', async () => {
    check.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 12, resetAt: 0 });
    const err = await enforceActionRateLimit('user-1').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('RATE_LIMITED');
  });

  it('can spend the read bucket', async () => {
    check.mockResolvedValue({ allowed: true, remaining: 5, retryAfterSeconds: 0, resetAt: 0 });
    await enforceActionRateLimit('user-1', 'api:read');
    expect(check).toHaveBeenCalledWith('api:read', 'user-1');
  });
});
