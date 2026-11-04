/**
 * Security events outside the REST surface (#1307): a refused web sign-in and a
 * permission denial raised for a Server Action. Each line must carry only the
 * fixed vocabulary, never the email that was tried or the entity that was named.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ default: { permission: { findMany } } }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u-me' } })) }));

import { logSignInRejected } from './security-event';
import { requireEntityPermission, requireRecordPermission } from './authz';
import { handleApiError } from './api-auth';

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
