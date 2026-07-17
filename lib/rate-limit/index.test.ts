import { describe, it, expect, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('DEFAULT_BUCKETS', () => {
  it('locks the production mobile:auth:token threshold at 5/15min (cmd_354/357 DP-5)', async () => {
    delete process.env.RATE_LIMIT_AUTH_CREDENTIALS_LIMIT;
    delete process.env.RATE_LIMIT_MOBILE_AUTH_TOKEN_LIMIT;
    const { PRODUCTION_BUCKETS } = await import('./index');
    expect(PRODUCTION_BUCKETS['mobile:auth:token']).toEqual({ limit: 5, windowMs: 15 * 60_000 });
  });

  it('honors RATE_LIMIT_MOBILE_AUTH_TOKEN_LIMIT to widen the bucket without touching auth:signin:credentials', async () => {
    process.env.RATE_LIMIT_MOBILE_AUTH_TOKEN_LIMIT = '500';
    delete process.env.RATE_LIMIT_AUTH_CREDENTIALS_LIMIT;
    const { DEFAULT_BUCKETS, PRODUCTION_BUCKETS } = await import('./index');
    expect(DEFAULT_BUCKETS['mobile:auth:token']).toEqual({ limit: 500, windowMs: 15 * 60_000 });
    expect(DEFAULT_BUCKETS['auth:signin:credentials']).toEqual(
      PRODUCTION_BUCKETS['auth:signin:credentials'],
    );
  });

  it('ignores a non-positive or non-numeric override and falls back to the production default', async () => {
    process.env.RATE_LIMIT_MOBILE_AUTH_TOKEN_LIMIT = '0';
    const { DEFAULT_BUCKETS } = await import('./index');
    expect(DEFAULT_BUCKETS['mobile:auth:token']).toEqual({ limit: 5, windowMs: 15 * 60_000 });
  });

  it('both overrides can apply independently at the same time', async () => {
    process.env.RATE_LIMIT_AUTH_CREDENTIALS_LIMIT = '500';
    process.env.RATE_LIMIT_MOBILE_AUTH_TOKEN_LIMIT = '500';
    const { DEFAULT_BUCKETS } = await import('./index');
    expect(DEFAULT_BUCKETS['auth:signin:credentials'].limit).toBe(500);
    expect(DEFAULT_BUCKETS['mobile:auth:token'].limit).toBe(500);
  });
});
