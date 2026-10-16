import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Exercises scripts/vercel-region.sh against a fake `curl` placed first on
// PATH. Nothing here contacts the Vercel API or needs a real token.

const HELPER = path.resolve(__dirname, 'vercel-region.sh');
const TOKEN = 'tok_SECRET_do_not_leak';

let dir: string;

// The fake curl logs its argv and the stdin config on each call, and answers
// GET with $FAKE_GET_BODY and PATCH with $FAKE_PATCH_BODY.
function installFakeCurl() {
  const bin = path.join(dir, 'bin');
  const script = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${dir}/argv.log"
cat >> "${dir}/stdin.log"
method=GET
for a in "$@"; do [[ "$a" == PATCH ]] && method=PATCH; done
echo "$method" >> "${dir}/methods.log"
if [[ $method == PATCH ]]; then printf '%s' "$FAKE_PATCH_BODY"; else printf '%s' "$FAKE_GET_BODY"; fi
`;
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'curl'), script);
  chmodSync(path.join(bin, 'curl'), 0o755);
  return bin;
}

function run(snippet: string, env: Record<string, string> = {}) {
  const bin = installFakeCurl();
  return spawnSync('bash', ['-c', `source "${HELPER}"; ${snippet}`], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env },
    encoding: 'utf8',
  });
}

const log = (name: string) =>
  existsSync(path.join(dir, name)) ? readFileSync(path.join(dir, name), 'utf8') : '';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'vercel-region-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('vercel_committed_region', () => {
  const read = (content: string | null) => {
    const f = path.join(dir, 'vercel.json');
    if (content !== null) writeFileSync(f, content);
    return run(`vercel_committed_region "${f}"`).stdout.trim();
  };

  it('returns the first regions entry', () => {
    expect(read('{"regions":["sin1","iad1"]}')).toBe('sin1');
  });
  it.each([
    ['no regions key', '{"framework":"nextjs"}'],
    ['empty regions', '{"regions":[]}'],
    ['invalid JSON', '{not json'],
  ])('returns nothing for %s', (_n, c) => {
    expect(read(c)).toBe('');
  });
  it('returns nothing when the file is missing', () => {
    expect(read(null)).toBe('');
  });
});

describe('vercel_reconcile_function_region', () => {
  const call = (env: Record<string, string>) =>
    run(`vercel_reconcile_function_region "${TOKEN}" "https://api.vercel.com/v9/projects/prj_1?teamId=team_1" sin1`, env);

  it('is a no-op when the region already matches', () => {
    const r = call({ FAKE_GET_BODY: '{"serverlessFunctionRegion":"sin1"}' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[SKIP]');
    expect(log('methods.log').trim().split('\n')).toEqual(['GET']);
  });

  it('PATCHes iad1 to the committed region', () => {
    const r = call({
      FAKE_GET_BODY: '{"serverlessFunctionRegion":"iad1"}',
      FAKE_PATCH_BODY: '{"serverlessFunctionRegion":"sin1"}',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("'iad1' -> 'sin1'");
    expect(log('methods.log').trim().split('\n')).toEqual(['GET', 'PATCH']);
    expect(log('argv.log')).toContain('{"serverlessFunctionRegion":"sin1"}');
  });

  it('PATCHes when the field is unset', () => {
    const r = call({ FAKE_GET_BODY: '{}', FAKE_PATCH_BODY: '{"serverlessFunctionRegion":"sin1"}' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('<unset>');
  });

  it('fails when the PATCH response does not echo the region', () => {
    const r = call({
      FAKE_GET_BODY: '{"serverlessFunctionRegion":"iad1"}',
      FAKE_PATCH_BODY: '{"error":{"code":"forbidden"}}',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('failed to set serverlessFunctionRegion');
  });

  it('keeps the token out of argv and output', () => {
    const r = call({
      FAKE_GET_BODY: '{"serverlessFunctionRegion":"iad1"}',
      FAKE_PATCH_BODY: '{"serverlessFunctionRegion":"sin1"}',
    });
    expect(log('argv.log')).not.toContain(TOKEN);
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
    expect(log('stdin.log')).toContain(`Bearer ${TOKEN}`);
  });
});

describe('vercel-setup.sh Step 1.5 wiring', () => {
  it('sources the helper and reconciles after rootDirectory', () => {
    const s = readFileSync(path.resolve(__dirname, 'vercel-setup.sh'), 'utf8');
    expect(s).toContain('source "${SCRIPT_DIR}/vercel-region.sh"');
    expect(s.indexOf('Set rootDirectory')).toBeLessThan(s.indexOf('vercel_reconcile_function_region "$VERCEL_TOKEN"'));
    expect(s).toContain('[DRY-RUN] Would PATCH serverlessFunctionRegion');
  });
});
