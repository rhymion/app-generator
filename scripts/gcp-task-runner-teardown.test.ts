import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Exercises scripts/gcp-task-runner-teardown.sh against a fake `gcloud` placed
// first on PATH. Nothing here contacts GCP or needs credentials. The scripts
// are copied into a temp project root so no real .env.production.local is read.

const SCRIPTS = ['gcp-task-runner-config.sh', 'gcp-task-runner-teardown.sh', 'gcp-task-runner.sh'];
const PAST = '2020-01-01T00:00:00Z';
const FUTURE = '2099-03-04T05:06:07Z';

let root: string;

// The fake gcloud appends its argv to calls.log and answers by subcommand.
// FAKE_MISSING is a regex: a matching argv line fails with a NOT_FOUND error.
// FAKE_FAIL is a regex: a matching argv line fails with a permission error.
function installFakeGcloud() {
  const bin = path.join(root, 'bin');
  const script = `#!/usr/bin/env bash
line="$*"
printf '%s\\n' "$line" >> "${root}/calls.log"
if [[ -n "\${FAKE_FAIL:-}" && "$line" =~ $FAKE_FAIL ]]; then echo "ERROR: PERMISSION_DENIED" >&2; exit 1; fi
if [[ -n "\${FAKE_MISSING:-}" && "$line" =~ $FAKE_MISSING ]]; then echo "ERROR: NOT_FOUND: resource not found" >&2; exit 1; fi
case "$line" in
  "storage buckets describe"*) printf '%s' "\${FAKE_BUCKET_JSON:-{\\"name\\":\\"b\\"\\}}" ;;
  "storage objects list"*) printf '%s' "\${FAKE_OBJECTS_JSON:-[]}" ;;
  "artifacts docker images list"*) printf '%s' "\${FAKE_IMAGES:-}" ;;
esac
exit 0
`;
  mkdirSync(bin, { recursive: true });
  rmSync(path.join(root, 'calls.log'), { force: true });
  writeFileSync(path.join(bin, 'gcloud'), script);
  chmodSync(path.join(bin, 'gcloud'), 0o755);
  return bin;
}

function run(env: Record<string, string> = {}, stdin = '') {
  const bin = installFakeGcloud();
  const result = spawnSync('bash', [path.join(root, 'scripts', 'gcp-task-runner-teardown.sh')], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: root,
      TASK_RUNNER_ENV_FILE: path.join(root, 'task-runner.env'),
      ...env,
    },
    input: stdin,
    encoding: 'utf8',
  });
  const calls = existsSync(path.join(root, 'calls.log'))
    ? readFileSync(path.join(root, 'calls.log'), 'utf8').split('\n').filter(Boolean)
    : [];
  return { ...result, calls };
}

const CONFIRM = 'yes\nproj-1\n';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'gcp-teardown-'));
  mkdirSync(path.join(root, 'scripts'));
  for (const f of SCRIPTS) copyFileSync(path.resolve(__dirname, f), path.join(root, 'scripts', f));
  writeFileSync(path.join(root, 'task-runner.env'), 'DATABASE_URL=postgres://u:SECRETVALUE@h/db\nAPI_TOKEN=tok_SECRETVALUE\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('gcp-task-runner-teardown.sh', () => {
  it('DRY_RUN calls no tool, lists every named resource and prints no secret value', () => {
    const r = run({ DRY_RUN: 'true', PROJECT_ID: 'proj-1' });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([]);
    expect(r.stdout).toContain('gcloud scheduler jobs delete task-runner-nightly');
    expect(r.stdout).toContain('gcloud run jobs delete task-runner ');
    expect(r.stdout).toContain('gcloud secrets delete task-runner-database-url');
    expect(r.stdout).toContain('gcloud secrets delete task-runner-api-token');
    expect(r.stdout).toContain('task-runner-invoker-sa@proj-1.iam.gserviceaccount.com');
    expect(r.stdout).not.toContain('SECRETVALUE');
    expect(r.stdout).toContain('not touched');
  });

  it('deletes in order: scheduler, job, bucket binding, secrets, invoker SA, runtime SA, images', () => {
    const r = run(
      {
        PROJECT_ID: 'proj-1',
        TASK_RUNNER_BUCKET_ROLES: 'archive-b=roles/storage.objectUser',
        FAKE_IMAGES: 'sha256:aaa\nsha256:bbb\n',
      },
      CONFIRM,
    );
    expect(r.status).toBe(0);
    const del = r.calls.filter((c) => /delete|remove-iam/.test(c));
    expect(del.map((c) => c.split(' --')[0])).toEqual([
      'scheduler jobs delete task-runner-nightly',
      'run jobs delete task-runner',
      'storage buckets remove-iam-policy-binding gs://archive-b',
      'secrets delete task-runner-database-url',
      'secrets delete task-runner-api-token',
      'iam service-accounts delete task-runner-invoker-sa@proj-1.iam.gserviceaccount.com',
      'iam service-accounts delete task-runner-sa@proj-1.iam.gserviceaccount.com',
      'artifacts docker images delete asia-northeast1-docker.pkg.dev/proj-1/app-generator/app-task-runner@sha256:aaa',
      'artifacts docker images delete asia-northeast1-docker.pkg.dev/proj-1/app-generator/app-task-runner@sha256:bbb',
    ]);
    expect(r.calls.every((c) => c.includes('--project=proj-1') || c.includes('--location') || c.includes('--region'))).toBe(true);
  });

  it('never deletes the project, the repository or touches a bucket without the opt-in', () => {
    const r = run({ PROJECT_ID: 'proj-1', AUDIT_LOG_GCS_BUCKET: 'audit-b', FAKE_IMAGES: 'sha256:aaa\n' }, CONFIRM);
    expect(r.status).toBe(0);
    expect(r.calls.some((c) => /^projects /.test(c))).toBe(false);
    expect(r.calls.some((c) => /repositories delete/.test(c))).toBe(false);
    expect(r.calls.some((c) => /^storage /.test(c))).toBe(false);
    expect(r.calls.some((c) => c.includes('audit-b'))).toBe(false);
  });

  it('SKIPs every resource that is already gone and still succeeds', () => {
    const r = run({ PROJECT_ID: 'proj-1', FAKE_MISSING: '.' }, CONFIRM);
    expect(r.status).toBe(0);
    expect(r.stdout.match(/\[SKIP\]/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it('fails when a delete fails for a reason other than a missing resource', () => {
    const r = run({ PROJECT_ID: 'proj-1', FAKE_FAIL: '^secrets delete' }, CONFIRM);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('PERMISSION_DENIED');
  });

  it('requires PROJECT_ID and does not fall back to the ambient project', () => {
    const r = run({}, CONFIRM);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('PROJECT_ID is required');
    expect(r.calls).toEqual([]);
  });

  it('deletes nothing when the confirmation is declined or the project ID does not match', () => {
    const declined = run({ PROJECT_ID: 'proj-1' }, 'no\n');
    expect(declined.status).toBe(0);
    expect(declined.calls).toEqual([]);
    const mismatch = run({ PROJECT_ID: 'proj-1' }, 'yes\nother\n');
    expect(mismatch.status).toBe(1);
    expect(mismatch.calls).toEqual([]);
  });

  it('keeps the newest N images with DELETE_IMAGES=keep:N and none with DELETE_IMAGES=none', () => {
    const keep = run({ PROJECT_ID: 'proj-1', DELETE_IMAGES: 'keep:2', FAKE_IMAGES: 'sha256:n1\nsha256:n2\nsha256:o3\nsha256:o4\n' }, CONFIRM);
    expect(keep.status).toBe(0);
    const deleted = keep.calls.filter((c) => c.startsWith('artifacts docker images delete'));
    expect(deleted).toHaveLength(2);
    expect(deleted[0]).toContain('@sha256:o3');
    expect(deleted[1]).toContain('@sha256:o4');
    expect(keep.stdout).toContain('[KEEP]');
  });

  it('does not list or delete images with DELETE_IMAGES=none and rejects a bad value', () => {
    const none = run({ PROJECT_ID: 'proj-1', DELETE_IMAGES: 'none' }, CONFIRM);
    expect(none.status).toBe(0);
    expect(none.calls.some((c) => c.startsWith('artifacts'))).toBe(false);
    const bad = run({ PROJECT_ID: 'proj-1', DELETE_IMAGES: 'keep:0' }, CONFIRM);
    expect(bad.status).toBe(1);
    expect(bad.calls).toEqual([]);
  });

  describe('audit-log bucket opt-in', () => {
    const optIn = { PROJECT_ID: 'proj-1', DELETE_AUDIT_LOG_BUCKET: 'true', AUDIT_LOG_GCS_BUCKET: 'audit-b' };

    it('needs the bucket name', () => {
      const r = run({ PROJECT_ID: 'proj-1', DELETE_AUDIT_LOG_BUCKET: 'true' }, CONFIRM);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('AUDIT_LOG_GCS_BUCKET');
      expect(r.calls).toEqual([]);
    });

    it('deletes the bucket last, after a third confirmation naming the bucket', () => {
      const r = run(optIn, `${CONFIRM}audit-b\n`);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('tamper-evidence');
      const last = r.calls[r.calls.length - 1];
      expect(last).toMatch(/^storage rm --recursive --all-versions gs:\/\/audit-b/);
    });

    it('does not delete the bucket when its name is not re-entered', () => {
      const r = run(optIn, `${CONFIRM}wrong\n`);
      expect(r.status).toBe(1);
      expect(r.calls.some((c) => /delete|rm /.test(c))).toBe(false);
    });

    it('stops before deleting anything when an object is under Object Retention, naming the expiry', () => {
      const r = run(
        { ...optIn, FAKE_OBJECTS_JSON: JSON.stringify([{ name: 'a', retention_expiration_time: FUTURE }]) },
        `${CONFIRM}audit-b\n`,
      );
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('BLOCKED');
      expect(r.stderr).toContain('2099-03-04');
      expect(r.stderr).toContain('Nothing was deleted');
      expect(r.calls.some((c) => /delete|remove-iam|rm /.test(c))).toBe(false);
    });

    it('stops on a locked bucket retention period that has not elapsed since object creation', () => {
      const r = run(
        {
          ...optIn,
          FAKE_BUCKET_JSON: JSON.stringify({ retentionPolicy: { retentionPeriod: '315360000', isLocked: true } }),
          FAKE_OBJECTS_JSON: JSON.stringify([{ name: 'a', timeCreated: new Date().toISOString() }]),
        },
        `${CONFIRM}audit-b\n`,
      );
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('locked retention policy');
      expect(r.calls.some((c) => /delete|rm /.test(c))).toBe(false);
    });

    it('also reads snake_case keys and proceeds once every retention has expired', () => {
      const r = run(
        {
          ...optIn,
          FAKE_BUCKET_JSON: JSON.stringify({ retention_policy: { retention_period: '86400', is_locked: false } }),
          FAKE_OBJECTS_JSON: JSON.stringify([{ name: 'a', creation_time: PAST, retention_expiration_time: PAST }]),
        },
        `${CONFIRM}audit-b\n`,
      );
      expect(r.status).toBe(0);
      expect(r.calls.some((c) => c.startsWith('storage rm'))).toBe(true);
    });

    it('fails closed when the bucket cannot be read', () => {
      const r = run({ ...optIn, FAKE_FAIL: '^storage buckets describe' }, `${CONFIRM}audit-b\n`);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('BLOCKED');
      expect(r.calls.some((c) => /delete|rm /.test(c))).toBe(false);
    });

    it('DRY_RUN only announces the retention check and the removal', () => {
      const r = run({ ...optIn, DRY_RUN: 'true' });
      expect(r.status).toBe(0);
      expect(r.calls).toEqual([]);
      expect(r.stdout).toContain('would check Object Retention');
      expect(r.stdout).toContain('gcloud storage rm --recursive --all-versions gs://audit-b');
    });
  });

  it('derives the same names as gcp-task-runner.sh from the same configuration', () => {
    const cfg = {
      PROJECT_ID: 'proj-1',
      DRY_RUN: 'true',
      TASK_RUNNER_JOB_NAME: 'tr-job',
      TASK_RUNNER_SCHEDULER_JOB_NAME: 'tr-sched',
      TASK_RUNNER_SA_NAME: 'tr-sa',
      TASK_RUNNER_INVOKER_SA_NAME: 'tr-inv',
      SERVICE_NAME: 'shop',
      REPO_NAME: 'repo-x',
      REGION: 'us-central1',
    };
    const teardown = run(cfg);
    const create = spawnSync('bash', [path.join(root, 'scripts', 'gcp-task-runner.sh')], {
      env: { PATH: process.env.PATH ?? '', HOME: root, TASK_RUNNER_ENV_FILE: path.join(root, 'task-runner.env'), SKIP_BUILD: 'true', TASK_RUNNER_IMAGE: 'img:1', ...cfg },
      encoding: 'utf8',
    });
    expect(create.status).toBe(0);
    for (const name of [
      'tr-job',
      'tr-sched',
      'tr-sa@proj-1.iam.gserviceaccount.com',
      'tr-inv@proj-1.iam.gserviceaccount.com',
      'task-runner-database-url',
      'task-runner-api-token',
    ]) {
      expect(create.stdout).toContain(name);
      expect(teardown.stdout).toContain(name);
    }
    expect(teardown.stdout).toContain('us-central1-docker.pkg.dev/proj-1/repo-x/shop-task-runner');
  });
});
