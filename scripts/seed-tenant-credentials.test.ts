import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_API_KEY,
  requiresExplicitCredentials,
  resolveAdminCredentials,
  generateApiKey,
} from './seed-tenant-credentials';

// cmd_504: pure, hand-written module — imports neither the generated Prisma
// client nor anything else code_generator/generate.py emits, so this test
// runs unchanged in a checkout that has never run `npm run generate-code`.
// See docs/knowledge/seed-tenant-credential-hardening.md.

describe('requiresExplicitCredentials', () => {
  it('is true only for NODE_ENV=production', () => {
    expect(requiresExplicitCredentials('production')).toBe(true);
  });

  it.each([undefined, 'test', 'development', 'staging'])(
    'is false for NODE_ENV=%s',
    (nodeEnv) => {
      expect(requiresExplicitCredentials(nodeEnv)).toBe(false);
    }
  );
});

describe('resolveAdminCredentials', () => {
  it('falls back to the fixed test/dev defaults when NODE_ENV is not production', () => {
    const result = resolveAdminCredentials({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    expect(result).toEqual({
      email: DEFAULT_ADMIN_EMAIL,
      password: DEFAULT_ADMIN_PASSWORD,
      apiKey: DEFAULT_ADMIN_API_KEY,
    });
  });

  it('falls back to defaults when NODE_ENV is undefined (plain `next dev`)', () => {
    const result = resolveAdminCredentials({} as NodeJS.ProcessEnv);
    expect(result.email).toBe(DEFAULT_ADMIN_EMAIL);
    expect(result.password).toBe(DEFAULT_ADMIN_PASSWORD);
  });

  it('ignores SEED_ADMIN_EMAIL/PASSWORD when NODE_ENV is not production', () => {
    const result = resolveAdminCredentials({
      NODE_ENV: 'test',
      SEED_ADMIN_EMAIL: 'someone@else.example',
      SEED_ADMIN_PASSWORD: 'hunter2',
    } as NodeJS.ProcessEnv);
    expect(result.email).toBe(DEFAULT_ADMIN_EMAIL);
    expect(result.password).toBe(DEFAULT_ADMIN_PASSWORD);
  });

  it('fail-fasts under NODE_ENV=production when both SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are unset', () => {
    expect(() => resolveAdminCredentials({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(
      /SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD/
    );
  });

  it('fail-fasts under NODE_ENV=production when only SEED_ADMIN_EMAIL is set', () => {
    expect(() =>
      resolveAdminCredentials({
        NODE_ENV: 'production',
        SEED_ADMIN_EMAIL: 'ops@example.com',
      } as NodeJS.ProcessEnv)
    ).toThrow(/SEED_ADMIN_PASSWORD/);
  });

  it('fail-fasts under NODE_ENV=production when only SEED_ADMIN_PASSWORD is set', () => {
    expect(() =>
      resolveAdminCredentials({
        NODE_ENV: 'production',
        SEED_ADMIN_PASSWORD: 'correct-horse-battery-staple',
      } as NodeJS.ProcessEnv)
    ).toThrow(/SEED_ADMIN_EMAIL/);
  });

  it('fail-fasts under NODE_ENV=production when SEED_ADMIN_EMAIL/PASSWORD are set but empty', () => {
    expect(() =>
      resolveAdminCredentials({
        NODE_ENV: 'production',
        SEED_ADMIN_EMAIL: '',
        SEED_ADMIN_PASSWORD: '',
      } as NodeJS.ProcessEnv)
    ).toThrow(/SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD/);
  });

  it('never returns credentials under NODE_ENV=production when envs are missing (throws instead of silently defaulting)', () => {
    // The whole point of this hardening: a missing env must throw — it must
    // never silently resolve to admin@example.com/password123 in production.
    expect(() => resolveAdminCredentials({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow();
  });

  it('uses env-provided email/password and a freshly generated api_key under NODE_ENV=production', () => {
    const result = resolveAdminCredentials({
      NODE_ENV: 'production',
      SEED_ADMIN_EMAIL: 'ops@example.com',
      SEED_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    } as NodeJS.ProcessEnv);
    expect(result.email).toBe('ops@example.com');
    expect(result.password).toBe('correct-horse-battery-staple');
    expect(result.apiKey).not.toBe(DEFAULT_ADMIN_API_KEY);
    expect(result.apiKey).toMatch(/^mk_[0-9a-f]{64}$/);
  });

  it('generates a different api_key on every production resolution', () => {
    const env = {
      NODE_ENV: 'production',
      SEED_ADMIN_EMAIL: 'ops@example.com',
      SEED_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    } as NodeJS.ProcessEnv;
    const first = resolveAdminCredentials(env);
    const second = resolveAdminCredentials(env);
    expect(first.apiKey).not.toBe(second.apiKey);
  });
});

describe('generateApiKey', () => {
  it('produces an mk_-prefixed 64-char hex string', () => {
    expect(generateApiKey()).toMatch(/^mk_[0-9a-f]{64}$/);
  });
});
