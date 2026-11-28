import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Issue #1432: Step A of vercel-setup.sh must name the owner role when it asks
// neonctl for connection strings, or a branch that also has `app_runtime`
// fails with "Multiple roles found for the branch". vercel-setup.sh runs its
// steps at top level, so the helper is cut out of the file and run against a
// fake _neonctl. Nothing here contacts Neon.

const SCRIPT = readFileSync(path.resolve(__dirname, 'vercel-setup.sh'), 'utf8');

function extract(re: RegExp): string {
  const m = SCRIPT.match(re);
  if (!m) throw new Error(`not found in vercel-setup.sh: ${re}`);
  return m[0];
}

const HELPER = extract(/^_neon_owner_connection_string\(\) \{\n[\s\S]*?\n\}\n/m);
const DEFAULT_ROLE = extract(/^NEON_OWNER_ROLE=.*$/m);

// The fake answers like neonctl: it fails with the real error unless
// --role-name names one of $FAKE_ROLES, and prints a URL for that role.
const FAKE_NEONCTL = `
_neonctl() {
  echo "$*" >> "$ARGV_LOG"
  local role="" pooled=no prev=""
  for a in "$@"; do
    [[ "$prev" == --role-name ]] && role="$a"
    [[ "$a" == --pooled ]] && pooled=yes
    prev="$a"
  done
  if [[ -z "$role" ]]; then
    echo "ERROR: Multiple roles found for the branch, please provide one with the --role-name option: neondb_owner, app_runtime" >&2
    return 1
  fi
  if [[ " $FAKE_ROLES " != *" $role "* ]]; then
    echo "ERROR: role not found" >&2
    return 1
  fi
  local host=ep-x.neon.tech
  [[ "$pooled" == yes ]] && host=ep-x-pooler.neon.tech
  echo "postgresql://$role:pw@$host/neondb?sslmode=require&channel_binding=require"
}
`;

function run(snippet: string, env: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'neon-role-'));
  const argvLog = path.join(dir, 'argv.log');
  try {
    const r = spawnSync(
      'bash',
      ['-c', `set -euo pipefail\n${DEFAULT_ROLE}\nNEON_PROJECT_ID=proj-1\n${FAKE_NEONCTL}\n${HELPER}\n${snippet}`],
      {
        env: { ...process.env, ARGV_LOG: argvLog, FAKE_ROLES: 'neondb_owner app_runtime', ...env },
        encoding: 'utf8',
      },
    );
    return { ...r, argv: existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : '' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('vercel-setup.sh Step A owner role (Issue #1432)', () => {
  it('defaults NEON_OWNER_ROLE to neondb_owner and keeps an override', () => {
    expect(DEFAULT_ROLE).toBe('NEON_OWNER_ROLE="${NEON_OWNER_ROLE:-neondb_owner}"');
    const r = run('echo "$NEON_OWNER_ROLE"', { NEON_OWNER_ROLE: 'custom_owner' });
    expect(r.stdout.trim()).toBe('custom_owner');
  });

  it("returns the owner's pooled and unpooled URLs on a branch with two roles", () => {
    const r = run(
      'p=$(_neon_owner_connection_string production --pooled); d=$(_neon_owner_connection_string production); echo "$p"; echo "$d"',
    );
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([
      'postgresql://neondb_owner:pw@ep-x-pooler.neon.tech/neondb?sslmode=require&channel_binding=require',
      'postgresql://neondb_owner:pw@ep-x.neon.tech/neondb?sslmode=require&channel_binding=require',
    ]);
    expect(r.argv).toContain('connection-string production --project-id proj-1 --role-name neondb_owner --pooled');
    expect(r.argv).toContain('connection-string production --project-id proj-1 --role-name neondb_owner\n');
  });

  it('works unchanged on a branch with only the owner role', () => {
    const r = run('_neon_owner_connection_string staging', { FAKE_ROLES: 'neondb_owner' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(
      'postgresql://neondb_owner:pw@ep-x.neon.tech/neondb?sslmode=require&channel_binding=require',
    );
  });

  it('fails with a message naming NEON_OWNER_ROLE when the role does not exist', () => {
    const r = run('u=$(_neon_owner_connection_string production) || exit 7; echo "unreachable $u"', {
      NEON_OWNER_ROLE: 'missing_owner',
    });
    expect(r.status).toBe(7);
    expect(r.stdout).not.toContain('unreachable');
    expect(r.stderr).toContain("role 'missing_owner' on Neon branch 'production'");
    expect(r.stderr).toContain('NEON_OWNER_ROLE');
  });

  it('get_neon_connection_strings fetches both URLs through the owner-role helper', () => {
    const body = extract(/^get_neon_connection_strings\(\) \{\n[\s\S]*?\n\}\n/m);
    expect(body).toContain('pooled_url=$(_neon_owner_connection_string "$branch_name" --pooled) || exit 1');
    expect(body).toContain('direct_url=$(_neon_owner_connection_string "$branch_name") || exit 1');
    expect(body).not.toMatch(/_neonctl connection-string/);
  });
});
