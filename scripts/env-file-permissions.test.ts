import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// .env.production.local holds deploy secrets. Every script that reads it must
// leave it readable by the owner only. Each script is sourced from a temp
// project root; it may fail afterwards for lack of real credentials, which is
// irrelevant here — the mode is set before anything else runs.

const SCRIPTS = ['gcp-env.sh', 'vercel-env.sh', 'gcp-task-runner-config.sh', 'vercel-setup.sh'];

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'env-perms-'));
  mkdirSync(path.join(root, 'scripts'));
  for (const f of readdirSync(__dirname).filter((n) => n.endsWith('.sh'))) {
    copyFileSync(path.join(__dirname, f), path.join(root, 'scripts', f));
  }
  writeFileSync(path.join(root, '.env.production.local'), 'EXAMPLE=1\n');
  chmodSync(path.join(root, '.env.production.local'), 0o644);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('.env.production.local permissions', () => {
  it.each(SCRIPTS)('%s leaves the env file at mode 0600', (script) => {
    spawnSync(
      'bash',
      ['-c', `SCRIPT_DIR="$PWD/scripts" PROJECT_ROOT="$PWD"; set -euo pipefail; source "scripts/${script}"`],
      { cwd: root, env: { PATH: process.env.PATH, HOME: root } as unknown as NodeJS.ProcessEnv, input: '', encoding: 'utf8', timeout: 20_000 },
    );

    expect(statSync(path.join(root, '.env.production.local')).mode & 0o777).toBe(0o600);
  });
});
