import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatLogLine, isRedactedKey, logger, redact, redactString } from './logger';

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
    expect(redact(BigInt(10))).toBe('10');
  });

  it('serialises dates, maps and sets', () => {
    expect(redact(new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05.000Z');
    expect(redact(new Map([['token', 'x'], ['k', 'v']]))).toEqual({ token: '[REDACTED]', k: 'v' });
    expect(redact(new Set(['a@b.com']))).toEqual(['[REDACTED:email]']);
  });

  it('keeps a hostile "__proto__" key as a plain data key', () => {
    const hostile = JSON.parse('{"__proto__": {"polluted": true}, "id": 1}');
    const out = redact(hostile) as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.keys(out)).toEqual(['__proto__', 'id']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('formatLogLine', () => {
  const NOW = new Date('2026-11-18T01:02:03.000Z');

  it('writes one JSON object with timestamp, level, severity, message and context', () => {
    const line = formatLogLine('warn', ['[tag] for a@b.com', { password: 'p', id: 1 }], NOW);
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
      timestamp: '2026-11-18T01:02:03.000Z',
      level: 'warn',
      severity: 'WARNING',
      message: '[tag] for [REDACTED:email]',
      context: { password: '[REDACTED]', id: 1 },
    });
  });

  it.each([
    ['debug', 'DEBUG'],
    ['info', 'INFO'],
    ['warn', 'WARNING'],
    ['error', 'ERROR'],
  ] as const)('maps %s to severity %s', (level, severity) => {
    expect(JSON.parse(formatLogLine(level, ['m'], NOW))).toMatchObject({ level, severity });
  });

  it('omits context without extra arguments and keeps several as an array', () => {
    expect(JSON.parse(formatLogLine('info', ['only'], NOW))).not.toHaveProperty('context');
    const rec = JSON.parse(formatLogLine('error', ['[x] failed', 'P2002', new Error('boom')], NOW));
    expect(rec.context[0]).toBe('P2002');
    expect(rec.context[1]).toMatchObject({ name: 'Error', message: 'boom' });
  });

  it('embeds a JSON-encoded argument as an object and redacts its keys', () => {
    const rec = JSON.parse(formatLogLine('warn', ['[security-event]', JSON.stringify({ event: 'authz.denied', token: 't' })], NOW));
    expect(rec.context).toEqual({ event: 'authz.denied', token: '[REDACTED]' });
  });

  it('keeps a string that only looks like JSON as a string', () => {
    expect(JSON.parse(formatLogLine('info', ['m', '{not json}'], NOW)).context).toBe('{not json}');
  });

  it('puts a non-string first argument into the context with an empty message', () => {
    expect(JSON.parse(formatLogLine('error', [{ code: 1 }], NOW))).toMatchObject({ message: '', context: { code: 1 } });
  });

  it('stays valid JSON for cycles, bigint and symbols', () => {
    const cyclic: Record<string, unknown> = { n: 1n, s: Symbol('x') };
    cyclic.self = cyclic;
    expect(JSON.parse(formatLogLine('info', ['m', cyclic], NOW)).context).toEqual({ n: '1', s: 'Symbol(x)', self: '[Circular]' });
  });
});

describe('logger (browser)', () => {
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
