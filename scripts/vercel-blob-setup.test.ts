import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Issue #1434: vercel-setup.sh Step C keeps one Blob store per target, takes the credential from
// .env.production.local only (never `vercel env pull`, which returns "[SENSITIVE]" for a Secret),
// and stops instead of sharing or adopting a store. Step C runs at top level in vercel-setup.sh, so
// the block is cut out of the file and run after sourcing vercel-env.sh in a temp project root,
// against a fake `vercel` on PATH that logs its argv. Nothing here contacts Vercel.

const SETUP = readFileSync(path.resolve(__dirname, 'vercel-setup.sh'), 'utf8');

function extract(re: RegExp): string {
  const m = SETUP.match(re);
  if (!m) throw new Error(`not found in vercel-setup.sh: ${re}`);
  return m[0];
}

const TRAILING_NEWLINE = extract(/^_ensure_trailing_newline\(\) \{\n[\s\S]*?\n\}\n/m);
const STEP_C = extract(/^# ── Step C: Vercel Blob[\s\S]*?echo " {2}OK: Production and Preview do not share a Blob store\."\n/m);
const STEP_2 = 'vercel_env_inject production\nvercel_env_inject preview\n';

// The fake answers the calls Step C and Step 2 make. `env pull` writes the placeholder Vercel
// really returns for a Secret, so a regression that reads it back would inject "[SENSITIVE]".
const FAKE_VERCEL = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$ARGV_LOG"
case "$1 $2" in
  "blob list-stores") printf '%s\\n' "\${FAKE_STORES_JSON:-[]}" ;;
  "env ls") printf '%s\\n' "\${FAKE_ENV_LS:-}" ;;
  "env pull") for a in "$@"; do f="$a"; done; echo 'BLOB_READ_WRITE_TOKEN="[SENSITIVE]"' > "$f" ;;
  "env add") printf '%s=%s\\n' "$3" "$(cat)" >> "$INJECT_LOG" ;;
  "blob create-store")
    if [[ -n "\${FAKE_CREATE_FAIL:-}" ]]; then echo "Error: $FAKE_CREATE_FAIL" >&2; exit 1; fi
    target=""; prev=""
    for a in "$@"; do [[ "$prev" == --environment ]] && target="$a"; prev="$a"; done
    if [[ -n "\${FAKE_CREATE_NO_ID:-}" ]]; then echo "Success! Created a store" >&2; exit 0; fi
    echo "Success! Blob store $3 created (store_Fake\${target}Id)" >&2 ;;
esac
`;

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'vercel-blob-'));
  mkdirSync(path.join(root, 'scripts'));
  for (const f of readdirSync(__dirname).filter((n) => n.endsWith('.sh'))) {
    copyFileSync(path.join(__dirname, f), path.join(root, 'scripts', f));
  }
  mkdirSync(path.join(root, 'bin'));
  writeFileSync(path.join(root, 'bin', 'vercel'), FAKE_VERCEL);
  chmodSync(path.join(root, 'bin', 'vercel'), 0o755);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const BASE = [
  'VERCEL_PROJECT_NAME=demo',
  'REDIS_URL=redis://prod',
  'AUTH_SECRET=a',
  'CRON_SECRET=c',
  'AUTH_SECRET_STAGING=as',
  'CRON_SECRET_STAGING=cs',
  'DATABASE_URL_PROD=postgres://p',
  'DATABASE_URL_UNPOOLED_PROD=postgres://pd',
  'DATABASE_URL_STAGING=postgres://s',
  'DATABASE_URL_UNPOOLED_STAGING=postgres://sd',
  '',
].join('\n');

function run(envFile: string, opts: { env?: Record<string, string>; withInject?: boolean; writeEnv?: boolean } = {}) {
  const envPath = path.join(root, '.env.production.local');
  if (opts.writeEnv !== false) writeFileSync(envPath, envFile);
  const argvLog = path.join(root, 'argv.log');
  const injectLog = path.join(root, 'inject.log');
  rmSync(argvLog, { force: true });
  rmSync(injectLog, { force: true });
  const script = [
    'set -euo pipefail',
    `source "${path.join(root, 'scripts', 'vercel-env.sh')}"`,
    TRAILING_NEWLINE,
    '_VERCEL_REGION=hnd1',
    STEP_C,
    opts.withInject ? STEP_2 : '',
  ].join('\n');
  const r = spawnSync('bash', ['-c', script], {
    cwd: root,
    env: {
      PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
      HOME: root,
      DRY_RUN: 'false',
      ARGV_LOG: argvLog,
      INJECT_LOG: injectLog,
      ...opts.env,
    } as unknown as NodeJS.ProcessEnv,
    encoding: 'utf8',
    timeout: 20_000,
  });
  const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
  return { ...r, argv: read(argvLog), injected: read(injectLog), saved: read(envPath) };
}

const PROD_TOKEN = 'vercel_blob_rw_ProdStore1_secretPROD';
const STG_TOKEN = 'vercel_blob_rw_StgStore2_secretSTG';

describe('vercel-setup.sh Step C: Blob credentials per target (Issue #1434)', () => {
  it('creates nothing and reads nothing back when every target has a Blob variable', () => {
    const r = run(`${BASE}BLOB_READ_WRITE_TOKEN=${PROD_TOKEN}\nBLOB_STORE_ID_STAGING=store_OtherStore\n`, {
      withInject: true,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).not.toMatch(/^blob /m);
    expect(r.argv).not.toMatch(/^env pull/m);
    // Step 2 injects exactly the variables that are set, under their own names.
    const blob = r.injected.split('\n').filter((l) => /BLOB/.test(l));
    expect(blob).toEqual([`BLOB_READ_WRITE_TOKEN=${PROD_TOKEN}`, 'BLOB_STORE_ID=store_OtherStore']);
    expect(r.argv).toMatch(/^env add BLOB_STORE_ID --environment preview --force --yes$/m);
  });

  it('creates a private store per target in the committed region, connected to that target only', () => {
    const r = run(BASE, { withInject: true });
    expect(r.status, r.stderr).toBe(0);
    expect(r.argv).toContain(
      'blob create-store demo-uploads-production --access private --yes --environment production --region hnd1',
    );
    expect(r.argv).toContain(
      'blob create-store demo-uploads-preview --access private --yes --environment preview --region hnd1',
    );
    expect(r.saved).toMatch(/^BLOB_STORE_ID="store_FakeproductionId"$/m);
    expect(r.saved).toMatch(/^BLOB_STORE_ID_STAGING="store_FakepreviewId"$/m);
    expect(r.injected).toContain('BLOB_STORE_ID=store_FakeproductionId\n');
    expect(r.injected).toContain('BLOB_STORE_ID=store_FakepreviewId\n');

    // A second run, from the file the first one wrote, creates nothing.
    const again = run('', { writeEnv: false });
    expect(again.status, again.stderr).toBe(0);
    expect(again.argv).not.toMatch(/^blob /m);
  });

  it('never injects "[SENSITIVE]" and never runs vercel env pull', () => {
    for (const env of [BASE, `${BASE}BLOB_READ_WRITE_TOKEN=${PROD_TOKEN}\nBLOB_READ_WRITE_TOKEN_STAGING=${STG_TOKEN}\n`]) {
      const r = run(env, { withInject: true });
      expect(r.status, r.stderr).toBe(0);
      expect(r.injected).not.toContain('[SENSITIVE]');
      expect(r.argv).not.toMatch(/^env pull/m);
    }
    // No command (outside comments) in the Vercel scripts pulls values.
    for (const f of readdirSync(__dirname).filter((n) => /^vercel-.*\.sh$/.test(n))) {
      const code = readFileSync(path.join(__dirname, f), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*#/.test(l));
      expect(code.filter((l) => /vercel env pull/.test(l)), f).toEqual([]);
    }
  });

  it('stops instead of adopting an existing store of the same name', () => {
    const r = run(BASE, { env: { FAKE_STORES_JSON: '{"stores":[{"id":"store_X","name":"demo-uploads-production"}]}' } });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("store named 'demo-uploads-production' already exists");
    expect(r.stderr).toContain('ATTACHMENT_BLOB_READ_WRITE_TOKEN BLOB_STORE_ID BLOB_READ_WRITE_TOKEN');
    expect(r.argv).not.toMatch(/^blob create-store/m);
  });

  it('stops when the target already has a Blob variable the file does not record', () => {
    const r = run(`${BASE}BLOB_STORE_ID=store_Prod\n`, {
      env: { FAKE_ENV_LS: ' name                    value      environments   created\n BLOB_READ_WRITE_TOKEN   Encrypted  Preview        1d ago' },
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('preview already has BLOB_READ_WRITE_TOKEN on Vercel');
    expect(r.stderr).toContain('BLOB_STORE_ID_STAGING');
    expect(r.argv).toContain('env ls --environment preview');
    expect(r.argv).not.toMatch(/^blob create-store/m);
  });

  it('prints the CLI error and exits non-zero when create-store fails', () => {
    const r = run(BASE, { env: { FAKE_CREATE_FAIL: 'store quota exceeded' } });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('Error: store quota exceeded');
    expect(r.stderr).toContain('vercel blob create-store demo-uploads-production failed');
  });

  it('fails without persisting an empty id when the output has no store id', () => {
    const r = run(BASE, { env: { FAKE_CREATE_NO_ID: '1' } });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('found no store id');
    expect(r.saved).not.toMatch(/^BLOB_STORE_ID/m);
  });

  it('stops before Step 2 when Production and Preview resolve to the same store, naming the variables only', () => {
    // Different kinds of variable, one store: the token's id field and the store id match.
    const r = run(`${BASE}BLOB_READ_WRITE_TOKEN=${PROD_TOKEN}\nBLOB_STORE_ID_STAGING=store_prodstore1\n`, {
      withInject: true,
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('Production (BLOB_READ_WRITE_TOKEN) and Preview (BLOB_STORE_ID_STAGING) use the same Vercel Blob store');
    expect(r.stderr + r.stdout).not.toContain('secretPROD');
    expect(r.argv).not.toMatch(/^env add/m);
  });

  it('compares the effective store, in the order the application resolves it', () => {
    // Preview's attachment token wins over its BLOB_READ_WRITE_TOKEN, and points at Production's store.
    const same = run(
      `${BASE}BLOB_READ_WRITE_TOKEN=${PROD_TOKEN}\nATTACHMENT_BLOB_READ_WRITE_TOKEN_STAGING=vercel_blob_rw_ProdStore1_other\nBLOB_READ_WRITE_TOKEN_STAGING=${STG_TOKEN}\n`,
    );
    expect(same.status).not.toBe(0);
    expect(same.stderr).toContain('Preview (ATTACHMENT_BLOB_READ_WRITE_TOKEN_STAGING)');

    const distinct = run(`${BASE}BLOB_READ_WRITE_TOKEN=${PROD_TOKEN}\nBLOB_READ_WRITE_TOKEN_STAGING=${STG_TOKEN}\n`);
    expect(distinct.status, distinct.stderr).toBe(0);
  });

  it('prints a notice for the retired VERCEL_BLOB_STORE_ID and does not act on it', () => {
    const r = run(`${BASE}VERCEL_BLOB_STORE_ID=store_Old\nBLOB_READ_WRITE_TOKEN=${PROD_TOKEN}\nBLOB_READ_WRITE_TOKEN_STAGING=${STG_TOKEN}\n`);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('VERCEL_BLOB_STORE_ID is no longer used');
    expect(r.argv).toBe('');
  });
});

describe('Vercel scripts use the non-deprecated CLI forms (Issue #1434)', () => {
  const sources = readdirSync(__dirname)
    .filter((n) => /^vercel-.*\.sh$/.test(n))
    .map((n) => [n, readFileSync(path.join(__dirname, n), 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')]);

  it('has no `project add`, positional env target, or `env rm --yes`', () => {
    for (const [name, code] of sources) {
      expect(code, name).not.toMatch(/\bproject add\b/);
      expect(code, name).not.toMatch(/env rm [^\n]*--yes/);
      expect(code, name).not.toMatch(/env ls (production|preview)\b/);
      // The only positional `env add` is the documented Git-branch fallback in inject_var.
      const positional = code.match(/vercel env add "\$name" (production|preview|"\$\{?target)[^\n]*/g) ?? [];
      expect(positional, name).toEqual(name === 'vercel-env.sh' ? ['vercel env add "$name" preview "" --force'] : []);
    }
  });

  it('falls back to the positional Preview form only when the CLI asks for a Git branch', () => {
    writeFileSync(
      path.join(root, 'bin', 'vercel'),
      `#!/usr/bin/env bash\ncat >/dev/null\nprintf '%s\\n' "$*" >> "$ARGV_LOG"\n[[ "$*" == *--environment* ]] && { echo 'Error: reason=git_branch_required' >&2; exit 1; }\nexit 0\n`,
    );
    const r = run(`${BASE}BLOB_READ_WRITE_TOKEN=${PROD_TOKEN}\nBLOB_READ_WRITE_TOKEN_STAGING=${STG_TOKEN}\n`, {
      withInject: true,
    });
    // Production fails (no fallback there); the run stops at the first production variable.
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('could not inject DATABASE_URL into production');

    writeFileSync(
      path.join(root, 'bin', 'vercel'),
      `#!/usr/bin/env bash\ncat >/dev/null\nprintf '%s\\n' "$*" >> "$ARGV_LOG"\n[[ "$*" == *"--environment preview"* ]] && { echo 'Error: reason=git_branch_required' >&2; exit 1; }\nexit 0\n`,
    );
    const ok = run(`${BASE}BLOB_READ_WRITE_TOKEN=${PROD_TOKEN}\nBLOB_READ_WRITE_TOKEN_STAGING=${STG_TOKEN}\n`, {
      withInject: true,
    });
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.argv).toMatch(/^env add DATABASE_URL --environment production --force --yes$/m);
    expect(ok.argv).toMatch(/^env add DATABASE_URL preview {2}--force$/m);
    expect(ok.stderr).toContain('using the deprecated positional form');
  });
});
