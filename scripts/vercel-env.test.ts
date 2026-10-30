import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Runs `vercel-env.sh inject <target>` with DRY_RUN=true against a temp project root, so
// no Vercel call is made. In DRY_RUN the script prints one `vercel env add` line per
// variable that would be injected (value redacted), and a WARNING line on stderr for each
// variable it refuses to share; the persisted .env file shows what was generated.

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'vercel-env-'));
  mkdirSync(path.join(root, 'scripts'));
  for (const f of readdirSync(__dirname).filter((n) => n.endsWith('.sh'))) {
    copyFileSync(path.join(__dirname, f), path.join(root, 'scripts', f));
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function inject(target: 'production' | 'preview', envFile: string, dryRun = true) {
  writeFileSync(path.join(root, '.env.production.local'), envFile);
  // A no-op `vercel` ahead of any real CLI: a non-DRY_RUN run must never reach Vercel.
  mkdirSync(path.join(root, 'bin'), { recursive: true });
  writeFileSync(path.join(root, 'bin', 'vercel'), '#!/usr/bin/env bash\ncat >/dev/null\n');
  chmodSync(path.join(root, 'bin', 'vercel'), 0o755);
  const r = spawnSync('bash', [path.join(root, 'scripts', 'vercel-env.sh'), 'inject', target], {
    cwd: root,
    env: { PATH: `${path.join(root, 'bin')}:${process.env.PATH}`, HOME: root, DRY_RUN: dryRun ? 'true' : 'false' } as unknown as NodeJS.ProcessEnv,
    encoding: 'utf8',
    timeout: 20_000,
  });
  const injected = [...r.stdout.matchAll(/vercel env add (\w+) /g)].map((m) => m[1]);
  return { ...r, injected };
}

const BASE = [
  'VERCEL_PROJECT_NAME=p',
  'REDIS_URL=redis://prod',
  'BLOB_READ_WRITE_TOKEN=blob-prod',
  'GOOGLE_CLIENT_ID=gid',
  'GOOGLE_CLIENT_SECRET=gsecret-prod',
  'AUTH_SECRET=auth-prod',
  'CRON_SECRET=cron-prod',
  '',
].join('\n');

describe('vercel-env.sh per-target secrets (Issue #1182)', () => {
  it('does not inject Production-only secrets into Preview when no _STAGING value exists', () => {
    const r = inject('preview', BASE);
    expect(r.status).toBe(0);
    expect(r.injected).not.toContain('REDIS_URL');
    expect(r.injected).not.toContain('BLOB_READ_WRITE_TOKEN');
    expect(r.injected).not.toContain('GOOGLE_CLIENT_SECRET');
    expect(r.stderr).toContain('REDIS_URL_STAGING is not set');
    expect(r.stderr).toContain('GOOGLE_CLIENT_SECRET_STAGING is not set');
  });

  it('injects the _STAGING value into Preview, and the plain value into Production', () => {
    const env = BASE + 'REDIS_URL_STAGING=redis://stg\nBLOB_READ_WRITE_TOKEN_STAGING=blob-stg\nGOOGLE_CLIENT_SECRET_STAGING=gsecret-stg\n';
    const preview = inject('preview', env);
    expect(preview.injected).toEqual(expect.arrayContaining(['REDIS_URL', 'BLOB_READ_WRITE_TOKEN', 'GOOGLE_CLIENT_SECRET']));
    const production = inject('production', env);
    expect(production.injected).toEqual(expect.arrayContaining(['REDIS_URL', 'BLOB_READ_WRITE_TOKEN', 'GOOGLE_CLIENT_SECRET']));
  });

  it('refuses a _STAGING value identical to the Production value', () => {
    const r = inject('preview', BASE + 'REDIS_URL_STAGING=redis://prod\n');
    expect(r.injected).not.toContain('REDIS_URL');
    expect(r.stderr).toContain('REDIS_URL_STAGING is identical to REDIS_URL');
  });

  it('generates and persists distinct AUTH_SECRET_STAGING and CRON_SECRET_STAGING', () => {
    const r = inject('preview', BASE, false);
    // Not DRY_RUN: the generated values are written back (the `vercel` call is a stub).
    expect(r.stdout).toContain('AUTH_SECRET_STAGING generated');
    expect(r.stdout).toContain('CRON_SECRET_STAGING generated');
    const saved = readFileSync(path.join(root, '.env.production.local'), 'utf8');
    const auth = saved.match(/^AUTH_SECRET_STAGING="(.+)"$/m)?.[1];
    expect(auth).toBeTruthy();
    expect(auth).not.toBe('auth-prod');
    expect(saved).toMatch(/^CRON_SECRET_STAGING=".+"$/m);
  });

  it('injects a per-environment RATE_LIMIT_KEY_PREFIX', () => {
    expect(inject('production', BASE).injected).toContain('RATE_LIMIT_KEY_PREFIX');
    expect(inject('preview', BASE).injected).toContain('RATE_LIMIT_KEY_PREFIX');
  });
});

describe('vercel-env.sh restricted database role (Issue #1174)', () => {
  const OWNER = 'DATABASE_URL_PROD=postgres://owner\nDATABASE_URL_UNPOOLED_PROD=postgres://owner-direct\n';

  it('warns on every run when no restricted-role URL is recorded', () => {
    const r = inject('production', BASE + OWNER);
    expect(r.stderr).toContain('DATABASE_URL_APP_PROD is not set');
    expect(r.stderr).toContain("OWNER's pooled URL");
  });

  it('uses the recorded restricted-role URL as DATABASE_URL and keeps DIRECT_URL on the owner', () => {
    const r = inject('production', BASE + OWNER + 'DATABASE_URL_APP_PROD=postgres://audit-restricted\n');
    expect(r.stderr).toContain('using the restricted-role URL from DATABASE_URL_APP_PROD');
    expect(r.stderr).not.toContain('is not set, so DATABASE_URL');
    expect(r.injected).toEqual(expect.arrayContaining(['DATABASE_URL', 'DIRECT_URL']));
  });
});
