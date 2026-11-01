// Issue #1303 (ASVS V15.3.5): the ESLint configuration must keep the strict-equality rule. These
// tests lint small snippets with the repository's own configuration, so removing or weakening
// `eqeqeq` fails them.
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

async function messagesFor(code: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(code, { filePath: 'lib/__eslint_probe__.ts' });
  return result.messages.filter((m) => m.ruleId === 'eqeqeq').map((m) => m.message);
}

describe('eslint.config.mjs strict equality', () => {
  it('rejects loose equality and inequality', async () => {
    expect(await messagesFor('export const a = (x: unknown, y: unknown) => x == y;')).toHaveLength(1);
    expect(await messagesFor('export const b = (x: unknown, y: unknown) => x != y;')).toHaveLength(1);
    expect(await messagesFor("export const c = (x: unknown) => x == 'a';")).toHaveLength(1);
  });

  it('allows strict comparison and the x == null idiom for null or undefined', async () => {
    expect(await messagesFor('export const a = (x: unknown, y: unknown) => x === y;')).toEqual([]);
    expect(await messagesFor('export const b = (x: unknown) => x == null;')).toEqual([]);
    expect(await messagesFor('export const c = (x: unknown) => x != null;')).toEqual([]);
  });
});
