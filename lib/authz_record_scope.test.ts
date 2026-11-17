/**
 * Record-scoped and entity-only permission checks (#1121).
 *
 * The record-scoped functions are the only path that resolves Creator/Assignee
 * grants; the entity-only functions answer for the entity as a whole and never do.
 */
import { describe, it, expect, vi } from 'vitest';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  default: { permission: { findMany } },
}));
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u-me' } })),
}));

import {
  canAccessEntity,
  canAccessRecord,
  requireEntityPermission,
  requireRecordPermission,
  resolveEntityPermissions,
  resolveRecordPermissions,
  type RichPermissions,
} from './authz';

const NONE = { create: false, read: false, update: false, delete: false, import: false };
const ALL = { create: true, read: true, update: true, delete: true, import: true };

// No general grant; Creator may read/update; Assignee may only read.
const creatorAssigneeOnly: RichPermissions = {
  create: false, read: true, update: true, delete: false, import: false,
  general: { ...NONE },
  creator: { ...NONE, read: true, update: true },
  assignee: { ...NONE, read: true },
};

describe('resolveRecordPermissions', () => {
  it('grants the Creator flags only on a record the user created', async () => {
    const own = await resolveRecordPermissions(creatorAssigneeOnly, { creator_id: 'u-me' }, 'u-me');
    expect(own.update).toBe(true);
    const other = await resolveRecordPermissions(creatorAssigneeOnly, { creator_id: 'u-other' }, 'u-me');
    expect(other.read).toBe(false);
    expect(other.update).toBe(false);
  });

  it('grants the Assignee flags only on a record the user is assigned to', async () => {
    const assigned = await resolveRecordPermissions(creatorAssigneeOnly, { assignee_id: 'u-me' }, 'u-me');
    expect(assigned.read).toBe(true);
    expect(assigned.update).toBe(false);
  });

  it('never grants create from a Creator/Assignee role', async () => {
    const own = await resolveRecordPermissions(
      { ...creatorAssigneeOnly, creator: { ...ALL } },
      { creator_id: 'u-me' },
      'u-me',
    );
    expect(own.create).toBe(false);
  });
});

describe('resolveEntityPermissions', () => {
  it('answers with the broad union and does not look at any record', async () => {
    const resolved = await resolveEntityPermissions(creatorAssigneeOnly);
    expect(resolved.read).toBe(true);
    expect(resolved.update).toBe(true);
    expect(resolved.delete).toBe(false);
  });
});

describe('record-scoped vs entity-only wrappers', () => {
  const creatorRows = [
    { name: 'ticket', create: false, read: true, update: true, delete: false, import: false, role: { name: 'Creator' } },
  ];

  it('canAccessEntity is true for a Creator-only user, canAccessRecord only for their own record', async () => {
    findMany.mockResolvedValue(creatorRows);
    expect(await canAccessEntity('ticket', 'update', 'u-me')).toBe(true);
    expect(await canAccessRecord('ticket', 'update', { creator_id: 'u-me' }, 'u-me')).toBe(true);
    expect(await canAccessRecord('ticket', 'update', { creator_id: 'u-other' }, 'u-me')).toBe(false);
  });

  it('requireRecordPermission denies a record the Creator grant does not cover', async () => {
    findMany.mockResolvedValue(creatorRows);
    await expect(requireEntityPermission('ticket', 'update', 'u-me')).resolves.toBeDefined();
    await expect(requireRecordPermission('ticket', 'update', { creator_id: 'u-me' }, 'u-me')).resolves.toBeDefined();
    await expect(requireRecordPermission('ticket', 'update', { creator_id: 'u-other' }, 'u-me'))
      .rejects.toThrow('Access denied: ticket.update');
  });
});
