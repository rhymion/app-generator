import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRedactedKey, logger, redact, redactString } from './logger';

describe('isRedactedKey', () => {
  it.each([
    'password',
    'Password',
    'newPassword',
    'access_token',
    'refreshToken',
    'client-secret',
    'API_KEY',
    'x-api-key',
    'apiKey',
    'Authorization',
    'cookie',
    'Set-Cookie',
    'key',
    'privateKey',
    'sessionId',
  ])('redacts %s', (k) => expect(isRedactedKey(k)).toBe(true));

  it.each(['name', 'email', 'keyboard', 'monkey', 'shipping', 'author', 'id', 'status'])(
    'keeps %s',
    (k) => expect(isRedactedKey(k)).toBe(false),
  );
});

describe('redact', () => {
  it('redacts by key at any depth, in objects and arrays', () => {
    const out = redact({
      user: { id: 'u1', password: 'hunter2', profile: { API_KEY: 'k', nested: [{ Token: 't', ok: 1 }] } },
      list: [{ authorization: 'Bearer abc' }, 'plain'],
    });
    expect(out).toEqual({
      user: { id: 'u1', password: '[REDACTED]', profile: { API_KEY: '[REDACTED]', nested: [{ Token: '[REDACTED]', ok: 1 }] } },
      list: [{ authorization: '[REDACTED]' }, 'plain'],
    });
  });

  it('masks email-shaped values, whole or inside a longer string', () => {
    expect(redact({ note: 'jane.doe+x@example.co.uk' })).toEqual({ note: '[REDACTED:email]' });
    expect(redact('sent to a@b.com and C_d@e-f.org now')).toBe('sent to [REDACTED:email] and [REDACTED:email] now');
    expect(redact(['a@b.com'])).toEqual(['[REDACTED:email]']);
  });

  it('masks bearer tokens and JWTs inside strings', () => {
    expect(redactString('header Bearer abc.def-ghi== end')).toBe('header Bearer [REDACTED] end');
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_nature-1';
    expect(redactString(`t=${jwt}`)).toBe('t=[REDACTED:jwt]');
  });

  it('reduces an Error to name, message, stack and own fields, all redacted', () => {
    const err = Object.assign(new Error('failed for jane@example.com'), { code: 'P2002', token: 'abc', meta: { password: 'p' } });
    const out = redact(err) as Record<string, unknown>;
    expect(out.name).toBe('Error');
    expect(out.message).toBe('failed for [REDACTED:email]');
    expect(String(out.stack)).not.toContain('jane@example.com');
    expect(out.code).toBe('P2002');
    expect(out.token).toBe('[REDACTED]');
    expect(out.meta).toEqual({ password: '[REDACTED]' });
  });

  it('redacts an Error cause and an error nested in an object', () => {
    const inner = new Error('bad a@b.com');
    const outer = new Error('outer', { cause: inner });
    const out = redact({ err: outer }) as { err: { cause: { message: string } } };
    expect(out.err.cause.message).toBe('bad [REDACTED:email]');
  });

  it('survives cycles, shared references and very deep structures', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(redact(a)).toEqual({ name: 'a', self: '[Circular]' });

    const shared = { v: 1 };
    expect(redact({ x: shared, y: shared })).toEqual({ x: { v: 1 }, y: { v: 1 } });

    let deep: Record<string, unknown> = { leaf: 'end' };
    for (let i = 0; i < 50; i++) deep = { next: deep };
    expect(JSON.stringify(redact(deep))).toContain('[Truncated]');
  });

  it('passes primitives through and keeps the input untouched', () => {
    const input = { password: 'p', n: 1, b: true, nil: null, u: undefined };
    expect(redact(input)).toEqual({ password: '[REDACTED]', n: 1, b: true, nil: null, u: undefined });
    expect(input.password).toBe('p');
    expect(redact(7)).toBe(7);
    expect(redact(null)).toBeNull();
    expect(redact(10n)).toBe('10');
  });

  it('serialises dates, maps and sets', () => {
    expect(redact(new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05.000Z');
    expect(redact(new Map([['token', 'x'], ['k', 'v']]))).toEqual({ token: '[REDACTED]', k: 'v' });
    expect(redact(new Set(['a@b.com']))).toEqual(['[REDACTED:email]']);
  });
});

describe('logger', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['debug', 'debug'],
    ['info', 'info'],
    ['warn', 'warn'],
    ['error', 'error'],
  ] as const)('logger.%s writes the redacted arguments to console.%s', (level, method) => {
    const spy = vi.spyOn(console, method).mockImplementation(() => {});
    logger[level]('[tag] for a@b.com', { password: 'p', id: 1 }, new Error('boom'));
    expect(spy).toHaveBeenCalledTimes(1);
    const [msg, obj, err] = spy.mock.calls[0] as [string, unknown, { message: string }];
    expect(msg).toBe('[tag] for [REDACTED:email]');
    expect(obj).toEqual({ password: '[REDACTED]', id: 1 });
    expect(err.message).toBe('boom');
  });
});
