/**
 * A function exported from a `'use server'` module is a Server Action: a signed-in
 * user can invoke it from the browser with arguments of their choosing. A helper
 * that takes a caller-supplied user id (`getModelPermissions(model, userId)`,
 * `getUserRoleIds(userId)`, ...) therefore discloses another user's permission
 * structure when it is a Server Action. These helpers are called with the actor
 * that an API key or mobile token authenticated, so they must stay plain
 * server-side modules.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const DIRECTIVE = /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*['"]use server['"]/;
const USER_ID_PARAM = /export\s+(?:async\s+)?(?:function\s+\w+|const\s+\w+\s*=\s*(?:cache\()?(?:async\s*)?)\s*\(([^)]*)\)/g;

function listSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listSources(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('lib/authz.ts is not a Server Action module', () => {
  it('has no use-server directive', () => {
    const source = readFileSync(join(ROOT, 'lib/authz.ts'), 'utf8');
    expect(DIRECTIVE.test(source)).toBe(false);
  });

  it('no use-server module under lib/ or app/ exports a function that takes a user id', () => {
    const offenders: string[] = [];
    for (const dir of ['lib', 'app']) {
      for (const file of listSources(join(ROOT, dir))) {
        const source = readFileSync(file, 'utf8');
        if (!DIRECTIVE.test(source)) continue;
        for (const match of source.matchAll(USER_ID_PARAM)) {
          if (/\b(userId|user_id|actorId)\b/.test(match[1])) offenders.push(`${file.slice(ROOT.length + 1)}: ${match[0].slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
