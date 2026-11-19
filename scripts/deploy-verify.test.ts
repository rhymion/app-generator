import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The read-only post-deployment checks (Issue #1244): scripts/gcp-verify.sh and scripts/vercel-verify.sh run against
// stub `gcloud` / `vercel` CLIs on PATH. Each stub records its arguments and answers from canned output, so the
// tests assert both the verdicts and that only read commands were issued, and that no value reaches the output.

let root: string;
const SECRET_VALUES = ['postgres://owner:s3cr3t@db/prod', 'auth-secret-value', 'cron-secret-value'];

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'deploy-verify-'));
  mkdirSync(path.join(root, 'scripts'));
  mkdirSync(path.join(root, 'bin'));
  for (const f of readdirSync(__dirname).filter((n) => n.endsWith('.sh'))) {
    copyFileSync(path.join(__dirname, f), path.join(root, 'scripts', f));
  }
  writeFileSync(
    path.join(root, '.env.production.local'),
    [`PROJECT_ID="demo-proj"`, `DATABASE_URL_PROD="${SECRET_VALUES[0]}"`, `AUTH_SECRET=${SECRET_VALUES[1]}`, `CRON_SECRET='${SECRET_VALUES[2]}'`, ''].join('\n'),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// A stub CLI: appends its argv to calls.log, then prints the canned response of the first pattern contained in its
// arguments (patterns are listed in responses-<cli>/index, one per line, in order), or fails when none matches.
function stub(cli: string, responses: Record<string, string>) {
  const dir = path.join(root, `responses-${cli}`);
  mkdirSync(dir, { recursive: true });
  const patterns = Object.keys(responses);
  patterns.forEach((pattern, i) => writeFileSync(path.join(dir, String(i)), responses[pattern]));
  writeFileSync(path.join(dir, 'index'), patterns.join('\n') + '\n');
  writeFileSync(
    path.join(root, 'bin', cli),
    `#!/usr/bin/env bash
echo "${cli} $*" >> "${root}/calls.log"
args="$*"
i=0
while IFS= read -r pat; do
  if [[ "$args" == *"$pat"* ]]; then cat "${dir}/$i"; exit 0; fi
  i=$((i + 1))
done < "${dir}/index"
exit 1
`,
  );
  chmodSync(path.join(root, 'bin', cli), 0o755);
}

function run(script: string, env: Record<string, string> = {}) {
  const r = spawnSync('bash', [path.join(root, 'scripts', script)], {
    cwd: root,
    env: { PATH: `${path.join(root, 'bin')}:/usr/bin:/bin`, HOME: root, ...env } as unknown as NodeJS.ProcessEnv,
    encoding: 'utf8',
    timeout: 20_000,
  });
  let calls: string[] = [];
  try {
    calls = readFileSync(path.join(root, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    calls = [];
  }
  return { ...r, calls };
}

function expectNoValues(out: string) {
  for (const v of SECRET_VALUES) expect(out).not.toContain(v);
}

const SAFE_POLICY = JSON.stringify({ bindings: [{ role: 'roles/storage.objectAdmin', members: ['serviceAccount:app@demo.iam.gserviceaccount.com'] }] });
// A public bucket policy is the fixture gcp-verify.sh must reject; nothing is made public.
// nosemgrep: public-object-storage-access
const PUBLIC_POLICY = JSON.stringify({ bindings: [{ role: 'roles/storage.objectViewer', members: ['allUsers'] }] });
const ALL_SECRETS = ['app-database-url', 'app-direct-database-url', 'app-auth-secret', 'app-nextauth-secret', 'app-gcs-bucket-name', 'app-cron-secret']
  .map((n) => `projects/123/secrets/${n}`)
  .join('\n');

describe('gcp-verify.sh', () => {
  function gcloud(over: Record<string, string> = {}) {
    stub('gcloud', {
      'public_access_prevention': 'enforced\n',
      'uniform_bucket_level_access': 'True\n',
      'get-iam-policy': SAFE_POLICY,
      'secrets list': ALL_SECRETS,
      ...over,
    });
  }

  it('passes a private bucket with every required secret present', () => {
    gcloud();
    const r = run('gcp-verify.sh');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('PASS attachment_bucket.public_access_prevention');
    expect(r.stdout).toContain('PASS attachment_bucket.iam_policy');
    expect(r.stdout).toContain('PASS secret app-auth-secret present');
    expect(r.stdout).toContain('INFO secret app-redis-url not present (optional)');
    expect(r.stdout).not.toMatch(/^FAIL/m);
    expectNoValues(r.stdout + r.stderr);
  });

  it('fails a bucket with an allUsers binding, without public access prevention, and a missing secret', () => {
    gcloud({ 'public_access_prevention': 'inherited\n', 'get-iam-policy': PUBLIC_POLICY, 'secrets list': 'projects/123/secrets/app-database-url\n' });
    const r = run('gcp-verify.sh');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('FAIL attachment_bucket.public_access_prevention: not enforced');
    expect(r.stdout).toContain('FAIL attachment_bucket.iam_policy: has an allUsers or allAuthenticatedUsers binding');
    expect(r.stdout).toContain('FAIL secret app-auth-secret: missing');
    expectNoValues(r.stdout + r.stderr);
  });

  it('checks the default bucket name and the audit-log bucket when configured', () => {
    gcloud();
    const r = run('gcp-verify.sh', { AUDIT_LOG_GCS_BUCKET: 'demo-audit' });
    expect(r.calls.some((c) => c.includes('gs://demo-proj-app-uploads'))).toBe(true);
    expect(r.calls.some((c) => c.includes('gs://demo-audit'))).toBe(true);
    expect(r.stdout).toContain('PASS audit_log_bucket.iam_policy');
  });

  it('issues read commands only', () => {
    gcloud();
    const r = run('gcp-verify.sh', { AUDIT_LOG_GCS_BUCKET: 'demo-audit' });
    expect(r.calls.length).toBeGreaterThan(0);
    for (const call of r.calls) {
      expect(call).toMatch(/^gcloud (storage buckets (describe|get-iam-policy)|secrets list) /);
      expect(call).not.toMatch(/\b(create|update|delete|add-iam-policy-binding|remove-iam-policy-binding|set|versions access|access)\b/);
    }
  });

  it('stops with status 2 without a project id', () => {
    gcloud();
    writeFileSync(path.join(root, '.env.production.local'), 'GCS_BUCKET=x\n');
    expect(run('gcp-verify.sh').status).toBe(2);
  });
});

describe('vercel-verify.sh', () => {
  const header = ' name                    value        environments            created\n';
  const row = (name: string, envs: string) => ` ${name.padEnd(24)}Encrypted    ${envs.padEnd(24)}1d ago\n`;
  const PER_TARGET = ['DATABASE_URL', 'DIRECT_URL', 'AUTH_SECRET', 'CRON_SECRET'];

  it('passes separate Production and Preview entries', () => {
    stub('vercel', {
      'env ls': header + [...PER_TARGET, 'REDIS_URL'].map((n) => row(n, 'Production')).join('') + PER_TARGET.map((n) => row(n, 'Preview')).join('') + row('AUTH_TRUST_HOST', 'Production, Preview'),
    });
    const r = run('vercel-verify.sh');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('PASS production REDIS_URL present');
    expect(r.stdout).toContain('PASS preview AUTH_SECRET present');
    expect(r.stdout).toContain('PASS AUTH_SECRET not shared between Production and Preview');
    expect(r.stdout).not.toContain('AUTH_TRUST_HOST');
  });

  it('fails a secret shared by one entry, and a missing Production variable', () => {
    stub('vercel', {
      'env ls': header + row('DATABASE_URL', 'Production') + row('DIRECT_URL', 'Production') + row('AUTH_SECRET', 'Production, Preview') + row('CRON_SECRET', 'Production'),
    });
    const r = run('vercel-verify.sh');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('FAIL AUTH_SECRET shared: one entry applies to both Production and Preview');
    expect(r.stdout).toContain('FAIL production REDIS_URL: missing');
    expect(r.stdout).toContain('FAIL preview DATABASE_URL: missing (set DATABASE_URL_STAGING');
    expect(r.stdout).toContain('FAIL preview DIRECT_URL: missing (set DATABASE_URL_UNPOOLED_STAGING');
  });

  it('skips the Preview checks when Preview has no variables', () => {
    stub('vercel', { 'env ls': header + [...PER_TARGET, 'REDIS_URL'].map((n) => row(n, 'Production')).join('') });
    const r = run('vercel-verify.sh');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('INFO preview has no variables; Preview checks skipped');
  });

  it('issues read commands only and never pulls values', () => {
    stub('vercel', { 'env ls': header + row('DATABASE_URL', 'Production') });
    const r = run('vercel-verify.sh');
    expect(r.calls).toEqual(['vercel env ls']);
    expectNoValues(r.stdout + r.stderr);
  });
});
