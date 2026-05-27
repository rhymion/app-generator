import { describe, it, expect } from 'vitest';
import { runCmd } from './helpers';

describe('cleanup', () => {
  it('cleanup:all exits with code 0', () => {
    const r = runCmd('npm run cleanup:all', { timeout: 120_000 });
    expect(r.code).toBe(0);
  });
  it('no legacy demo:* scripts remain in package.json', () => {
    const r = runCmd('grep -c "demo:" package.json 2>/dev/null || echo 0');
    expect(parseInt(r.stdout.trim())).toBe(0);
  });
});
