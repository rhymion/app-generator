import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  checkPassword,
  contextWords,
  passwordBreachError,
  passwordPolicyError,
} from './password-policy';

const NO_ENV = {};

describe('passwordPolicyError', () => {
  it('rejects a password shorter than the minimum and non-strings', () => {
    expect(passwordPolicyError('b'.repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(/at least 8 characters/);
    expect(passwordPolicyError('')).not.toBeNull();
    expect(passwordPolicyError(undefined)).not.toBeNull();
    expect(passwordPolicyError(12345678)).not.toBeNull();
  });

  it('accepts a password of the minimum length, with no composition rule', () => {
    expect(passwordPolicyError('kq7vmz2x', {}, NO_ENV)).toBeNull();
    expect(passwordPolicyError('correct horse battery', {}, NO_ENV)).toBeNull();
  });

  it('counts characters, not UTF-16 code units', () => {
    expect(passwordPolicyError('😀'.repeat(MIN_PASSWORD_LENGTH), {}, NO_ENV)).toBeNull();
    expect(passwordPolicyError('😀'.repeat(MIN_PASSWORD_LENGTH - 1), {}, NO_ENV)).not.toBeNull();
  });

  // bcrypt reads 72 bytes: a longer password would be cut silently (Issue #1280, ASVS V6.2.9).
  it('accepts up to 72 bytes and refuses more', () => {
    expect(MAX_PASSWORD_BYTES).toBe(72);
    expect(passwordPolicyError('x7'.repeat(36), {}, NO_ENV)).toBeNull();
    expect(passwordPolicyError('x7'.repeat(36) + 'y', {}, NO_ENV)).toMatch(/at most 72 bytes/);
    // 24 three-byte characters are 72 bytes; 25 are 75.
    expect(passwordPolicyError('パ'.repeat(24), {}, NO_ENV)).toBeNull();
    expect(passwordPolicyError('パ'.repeat(25), {}, NO_ENV)).toMatch(/at most 72 bytes/);
  });

  it('refuses a common password whatever its case (ASVS V6.2.4)', () => {
    for (const p of ['password123', 'PassWord1', '12345678', 'qwertyuiop', 'iloveyou', 'P@ssw0rd']) {
      expect(passwordPolicyError(p, {}, NO_ENV)).toMatch(/too common/);
    }
  });

  it("refuses an entry of the operator's denylist file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pw-denylist-'));
    const file = path.join(dir, 'list.txt');
    writeFileSync(file, '# company words\nAcmeRocks2026\n\n');
    expect(passwordPolicyError('acmerocks2026', {}, { PASSWORD_DENYLIST_FILE: file })).toMatch(/too common/);
    expect(passwordPolicyError('acmerocks2027', {}, { PASSWORD_DENYLIST_FILE: file })).toBeNull();
  });

  it('fails loudly when the configured denylist file cannot be read', () => {
    expect(() => passwordPolicyError('kq7vmz2x', {}, { PASSWORD_DENYLIST_FILE: '/nonexistent/list.txt' })).toThrow();
  });

  it("refuses a password that contains the user's name, address or the app name (ASVS V6.2.11)", () => {
    const ctx = { email: 'taro.yamada@contoso.co.jp', name: 'Taro Yamada' };
    expect(passwordPolicyError('yamada-is-cool', ctx, NO_ENV)).toMatch(/must not contain/);
    expect(passwordPolicyError('my contoso pw', ctx, NO_ENV)).toMatch(/must not contain/);
    expect(passwordPolicyError('TARO.YAMADA!!', ctx, NO_ENV)).toMatch(/must not contain/);
    expect(passwordPolicyError('kq7vmz2x-wonder', ctx, NO_ENV)).toBeNull();
    expect(passwordPolicyError('acme-secret-9', {}, { PASSWORD_CONTEXT_WORDS: 'Acme, widgets' })).toMatch(/must not contain/);
  });

  it('ignores short fragments and webmail domains as context words', () => {
    const words = contextWords({ email: 'al@gmail.com', name: 'Al Bo' }, NO_ENV);
    expect(words).not.toContain('al');
    expect(words).not.toContain('gmail');
  });
});

describe('passwordBreachError', () => {
  // SHA-1("kq7vmz2x-wonder") is computed by the function; the fake answers with its suffix.
  async function suffixOf(password: string) {
    const { createHash } = await import('node:crypto');
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    return { prefix: sha1.slice(0, 5), suffix: sha1.slice(5) };
  }

  it('does nothing unless PASSWORD_BREACH_CHECK=hibp', async () => {
    const fetchImpl = vi.fn();
    expect(await passwordBreachError('kq7vmz2x', {}, fetchImpl as never)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends only the 5-character prefix and refuses a listed password', async () => {
    const { prefix, suffix } = await suffixOf('kq7vmz2x-wonder');
    const fetchImpl = vi.fn(async () => new Response(`0000000000000000000000000000000000A:0\r\n${suffix}:42\r\n`));
    const err = await passwordBreachError('kq7vmz2x-wonder', { PASSWORD_BREACH_CHECK: 'hibp' }, fetchImpl as never);
    expect(err).toMatch(/known data breach/);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${prefix}`);
    expect(url).not.toContain(suffix);
    expect((init.headers as Record<string, string>)['Add-Padding']).toBe('true');
  });

  it('accepts a password that is absent or only in the padding (count 0)', async () => {
    const { suffix } = await suffixOf('kq7vmz2x-wonder');
    const fetchImpl = vi.fn(async () => new Response(`${suffix}:0\nABCDEF:3\n`));
    expect(await passwordBreachError('kq7vmz2x-wonder', { PASSWORD_BREACH_CHECK: 'hibp' }, fetchImpl as never)).toBeNull();
  });

  it('skips the check when the service fails (fail open)', async () => {
    const down = vi.fn(async () => { throw new TypeError('fetch failed'); });
    expect(await passwordBreachError('kq7vmz2x', { PASSWORD_BREACH_CHECK: 'hibp' }, down as never)).toBeNull();
    const error = vi.fn(async () => new Response('', { status: 503 }));
    expect(await passwordBreachError('kq7vmz2x', { PASSWORD_BREACH_CHECK: 'hibp' }, error as never)).toBeNull();
  });

  it('uses PASSWORD_BREACH_CHECK_URL for a mirror', async () => {
    const fetchImpl = vi.fn(async (_url: string) => new Response(''));
    await passwordBreachError('kq7vmz2x', { PASSWORD_BREACH_CHECK: 'hibp', PASSWORD_BREACH_CHECK_URL: 'https://mirror.internal/range/' }, fetchImpl as never);
    expect(fetchImpl.mock.calls[0][0]).toMatch(/^https:\/\/mirror\.internal\/range\/[0-9A-F]{5}$/);
  });
});

describe('checkPassword', () => {
  it('runs the local rules first, without a breach check', async () => {
    expect(await checkPassword('short', {}, { PASSWORD_BREACH_CHECK: 'hibp' })).toMatch(/at least 8/);
    expect(await checkPassword('kq7vmz2x', {}, NO_ENV)).toBeNull();
  });
});
