import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PROJ_ROOT, runCmd } from './helpers';

// `npm run cleanup:all` prunes every generated file the current schema does not
// account for (--prune-orphans). Run against the working tree itself it deletes
// the generated code (lib/*/service.ts, ...) the developer is running, so it runs
// on a disposable copy of the tree instead and the working tree is only read.
const SKIPPED_DIRS = new Set(['node_modules', '.next', '.git']);

function countFiles(dir: string): number {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    n += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1;
  }
  return n;
}

describe('cleanup', () => {
  const scratchRoot = fs.realpathSync(os.tmpdir());
  const copyRoot = fs.mkdtempSync(path.join(scratchRoot, 'flows-cleanup-'));

  afterAll(() => {
    // Only ever removes the directory created above, and only if it still
    // resolves to somewhere inside the system temp directory.
    const resolved = fs.realpathSync(copyRoot);
    if (resolved.startsWith(scratchRoot + path.sep) && path.basename(resolved).startsWith('flows-cleanup-')) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  });

  it('cleanup:all exits with code 0 and leaves the working tree untouched', () => {
    const filesBefore = countFiles(PROJ_ROOT);
    fs.cpSync(PROJ_ROOT, copyRoot, {
      recursive: true,
      filter: (src) => !SKIPPED_DIRS.has(path.basename(src)),
    });

    const r = runCmd('npm run cleanup:all', { timeout: 120_000, cwd: copyRoot });
    expect(r.code).toBe(0);

    expect(countFiles(PROJ_ROOT)).toBe(filesBefore);
  });
  it('no legacy demo:* scripts remain in package.json', () => {
    const r = runCmd('grep -c "demo:" package.json 2>/dev/null || echo 0');
    expect(parseInt(r.stdout.trim())).toBe(0);
  });
});
