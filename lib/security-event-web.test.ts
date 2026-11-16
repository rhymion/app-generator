/**
 * Security events outside the REST surface (#1307): a refused web sign-in, a
 * permission denial raised for a Server Action (through the permission checks or
 * thrown by hand), and the onRequestError fallback for one left uncaught. Each
 * line must carry only the fixed vocabulary, never the email that was tried or
 * the entity that was named.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ default: { permission: { findMany } } }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u-me' } })) }));

import { logSignInRejected, logSecurityEventForError } from './security-event';
import { assertPermission, requireEntityPermission, requireRecordPermission } from './authz';
import { ApiError, handleApiError } from './api-auth';
import { AppError } from './_errors';
import { logRequestError } from './request-error';

const events = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((c) => c[0] === '[security-event]').map((c) => JSON.parse(String(c[1])));

afterEach(() => {
  vi.restoreAllMocks();
  findMany.mockReset();
});

describe('logSignInRejected', () => {
  it.each(['INVALID_CREDENTIALS', 'INVALID_MFA_CODE'] as const)('writes one auth.rejected line for %s', (code) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSignInRejected(code);
    const lines = events(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: 'auth.rejected', status: 401, code });
    expect(Object.keys(lines[0]).sort()).toEqual(['at', 'code', 'event', 'status']);
  });
});

describe('auth.ts sign-in rejections', () => {
  // authorize() runs inside NextAuth and cannot be called on its own, so pin the
  // call sites: removing one of them makes this test fail.
  const source = readFileSync(join(__dirname, '..', 'auth.ts'), 'utf8');

  it('logs missing credentials, a locked account, a wrong password and a wrong second-factor code', () => {
    expect(source.match(/logSignInRejected\("INVALID_CREDENTIALS"\)/g)).toHaveLength(3);
    expect(source.match(/logSignInRejected\("INVALID_MFA_CODE"\)/g)).toHaveLength(1);
  });

  it('never passes the submitted email to the security-event log', () => {
    const call = /logSignInRejected\([^)]*\)/g;
    for (const m of source.match(call) ?? []) expect(m).not.toMatch(/email|credentials\./);
  });
});

describe('permission denial raised for a Server Action', () => {
  it('writes one authz.denied line without the entity, operation or user', async () => {
    findMany.mockResolvedValue([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(requireEntityPermission('secret_entity', 'delete')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const lines = events(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: 'authz.denied', status: 403, code: 'PERMISSION_DENIED' });
    expect(Object.keys(lines[0]).sort()).toEqual(['at', 'code', 'event', 'status']);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret_entity|delete|u-me/);
  });

  it('covers the record-scoped check as well', async () => {
    findMany.mockResolvedValue([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(requireRecordPermission('order', 'update', { creator_id: 'u-other' })).rejects.toBeDefined();
    expect(events(warn)).toHaveLength(1);
  });

  it('is written once when a REST route hands the same error to handleApiError', async () => {
    findMany.mockResolvedValue([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = await requireEntityPermission('order', 'read').catch((e) => e);
    handleApiError(err);
    expect(events(warn)).toHaveLength(1);
  });
});

describe('denial thrown by hand inside a Server Action', () => {
  const FIXED_KEYS = ['at', 'code', 'event', 'status'];

  it('writes one authz.denied line when the action catch passes it on', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = new AppError('PERMISSION_DENIED', 'Access denied: secret_entity.delete');
    logSecurityEventForError(err);
    const lines = events(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: 'authz.denied', status: 403, code: 'PERMISSION_DENIED' });
    expect(Object.keys(lines[0]).sort()).toEqual(FIXED_KEYS);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret_entity|delete/);
  });

  it('is written once however many places see the same error', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new AppError('PERMISSION_DENIED', 'edit_forbidden:approval_locked');
    logSecurityEventForError(err);
    logSecurityEventForError(err);
    handleApiError(err);
    logRequestError(err, { path: '/x', method: 'POST' }, { routeType: 'action' });
    expect(events(warn)).toHaveLength(1);
  });

  it('is not written again for a denial a permission check already logged', async () => {
    findMany.mockResolvedValue([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = await requireEntityPermission('order', 'delete').catch((e) => e);
    logSecurityEventForError(err);
    expect(events(warn)).toHaveLength(1);
  });

  it('logs a denial that left the action uncaught through onRequestError', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    logRequestError(new AppError('PERMISSION_DENIED', 'Access denied: order.read'), { path: '/order', method: 'POST' }, { routeType: 'action' });
    const lines = events(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: 'authz.denied', status: 403 });
  });

  it('maps the same errors handleApiError maps: ApiError 403 / 429, an expired session', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSecurityEventForError(new ApiError(403, 'Current password is incorrect'));
    logSecurityEventForError(new ApiError(429, 'slow down', 30));
    logSecurityEventForError(new AppError('RATE_LIMITED', 'bucket api:write'));
    logSecurityEventForError(new AppError('SESSION_EXPIRED', 'User not authenticated'));
    expect(events(warn).map((l) => [l.event, l.status])).toEqual([
      ['authz.denied', 403],
      ['rate_limit.hit', 429],
      ['rate_limit.hit', 429],
      ['auth.rejected', 401],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/password|api:write/);
  });

  it('writes nothing for an error that is not a security event', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    logSecurityEventForError(new AppError('NOT_FOUND', 'Not found'));
    logSecurityEventForError(new AppError('VALIDATION', 'name', 'name', 'missing'));
    logSecurityEventForError(new ApiError(400, 'bad'));
    logSecurityEventForError(new Error('boom'));
    logSecurityEventForError('not an error');
    logRequestError(new Error('boom'), { path: '/x', method: 'GET' }, {});
    expect(events(warn)).toHaveLength(0);
  });
});

describe('assertPermission', () => {
  it('logs its denial once and still throws a plain Error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const flags = { create: false, read: false, update: false, delete: false, import: false };
    const err = await assertPermission(flags, 'import', 'secret_entity').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AppError);
    expect(err.message).toBe('Access denied: secret_entity.import');
    logRequestError(err, { path: '/x', method: 'GET' }, {});
    const lines = events(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: 'authz.denied', status: 403, code: 'PERMISSION_DENIED' });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret_entity/);
  });

  it('writes nothing when the operation is allowed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await assertPermission({ create: false, read: true, update: false, delete: false, import: false }, 'read', 'order');
    expect(events(warn)).toHaveLength(0);
  });
});
