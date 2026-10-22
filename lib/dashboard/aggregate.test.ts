import { describe, it, expect, beforeEach, vi } from 'vitest';

const m = vi.hoisted(() => ({
  ticketGroupBy: vi.fn(),
  ticketFindMany: vi.fn(),
  userFindMany: vi.fn(),
  getModelPermissions: vi.fn(),
  getAssociatedOrganizations: vi.fn(),
  trySelfOnlyAdminBypass: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    ticket: { groupBy: m.ticketGroupBy, findMany: m.ticketFindMany },
    user: { findMany: m.userFindMany },
  },
}));
vi.mock('@/lib/authz', () => ({
  getSessionUserIdOrThrow: async () => 'session-user',
  getModelPermissions: m.getModelPermissions,
}));
vi.mock('@/lib/api-auth', () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock('@/lib/organization/getters_associated', () => ({
  getAssociatedOrganizations: m.getAssociatedOrganizations,
}));
vi.mock('@/lib/self_only', () => ({ trySelfOnlyAdminBypass: m.trySelfOnlyAdminBypass }));
vi.mock('./catalog', () => {
  const fields = [
    { name: 'assignee_id', label: 'Assignee', kind: 'fk', fk_target: 'user', fk_label_field: 'name' },
    { name: 'status', label: 'Status', kind: 'enum', enum_values: ['open', 'closed'] },
    { name: 'opened_at', label: 'Opened at', kind: 'datetime', datetime_format: 'date-time' },
  ];
  const entity = { name: 'ticket', label: 'Ticket', groupable_fields: fields };
  return {
    DASHBOARDABLE_ENTITIES: [entity],
    findDashboardEntity: (n: string) => (n === 'ticket' ? entity : undefined),
    findDashboardField: (n: string, f: string) => (n === 'ticket' ? fields.find((x) => x.name === f) : undefined),
  };
});
vi.mock('./access-scope', () => {
  const none = {
    should_filter_by_org: false, org_relationship_optional: false, has_assignee_id: false,
    is_self_only: false, self_only_admin_bypass: false, filter_values: {},
  };
  return {
    DASHBOARD_ACCESS_SCOPES: {
      ticket: { ...none, should_filter_by_org: true, has_assignee_id: true },
      selfonly_ticket: { ...none, is_self_only: true },
      user: { ...none, should_filter_by_org: true },
    },
  };
});

import { aggregateForWidget } from './aggregate';
import { aggregateForWidgetCore } from './aggregate-core';

const flags = (read: boolean) => ({ create: false, read, update: false, delete: false, import: false });
function perms(opts: { general?: boolean; creator?: boolean; assignee?: boolean }) {
  const general = flags(!!opts.general);
  return {
    permissions: {
      ...general,
      read: !!(opts.general || opts.creator || opts.assignee),
      general,
      creator: opts.creator ? flags(true) : null,
      assignee: opts.assignee ? flags(true) : null,
    },
    userId: 'u',
  };
}

// The same behavior must hold on both entry points: the Server Action (session user) and the REST
// route's core call (API-key user).
const entryPoints = [
  {
    name: 'Server Action',
    actor: 'session-user',
    // The action reports a refused read as a typed problem (not a thrown error); unwrap it so the shared
    // cases below read the same on both entry points.
    call: async (...args: Parameters<typeof aggregateForWidget>) => {
      const result = await aggregateForWidget(...args);
      if (!result.ok) throw new Error(`${result.problem.code}:${result.problem.params.entity}`);
      return result.output;
    },
    denied: /noPermission:ticket/,
  },
  {
    name: 'REST core',
    actor: 'api-user',
    denied: /Access denied: ticket\.read/,
    call: (...args: Parameters<typeof aggregateForWidget>) => aggregateForWidgetCore('api-user', ...args),
  },
];

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.getModelPermissions.mockResolvedValue(perms({ general: true }));
  m.getAssociatedOrganizations.mockResolvedValue([{ id: 'org-a' }]);
  m.trySelfOnlyAdminBypass.mockResolvedValue(false);
  m.ticketGroupBy.mockResolvedValue([]);
  m.ticketFindMany.mockResolvedValue([]);
  m.userFindMany.mockResolvedValue([]);
});

describe.each(entryPoints)('dashboard aggregate via $name', ({ actor, call, denied }) => {
  it('refuses a role without read permission on the entity', async () => {
    m.getModelPermissions.mockResolvedValue(perms({}));
    await expect(call('ticket', 'status')).rejects.toThrow(denied);
    expect(m.getModelPermissions).toHaveBeenCalledWith('ticket', actor);
    expect(m.ticketGroupBy).not.toHaveBeenCalled();
  });

  it('limits a single group-by to the viewer organizations (cross-organization isolation)', async () => {
    await call('ticket', 'status');
    expect(m.getAssociatedOrganizations).toHaveBeenCalledWith(actor);
    expect(m.ticketGroupBy.mock.calls[0][0].where).toEqual({ organization_id: { in: ['org-a'] } });
  });

  it('combines the organization scope with widget conditions on a single group-by', async () => {
    await call('ticket', 'status', null, undefined, [{ field: 'status', operator: 'equals', values: [1] }]);
    expect(m.ticketGroupBy.mock.calls[0][0].where).toEqual({
      AND: [{ organization_id: { in: ['org-a'] } }, { status: { equals: 1 } }],
    });
  });

  it('limits a two-field group-by to the viewer organizations', async () => {
    await call('ticket', 'status', null, 'assignee_id');
    expect(m.ticketGroupBy.mock.calls[0][0].where).toEqual({ organization_id: { in: ['org-a'] } });
  });

  it('limits a bucketed single query to the viewer organizations', async () => {
    await call('ticket', 'opened_at', null, undefined, undefined, 'month');
    expect(m.ticketFindMany.mock.calls[0][0].where).toEqual({ organization_id: { in: ['org-a'] } });
  });

  it('limits a bucketed two-field query to the viewer organizations', async () => {
    await call('ticket', 'opened_at', null, 'status', undefined, 'month');
    expect(m.ticketFindMany.mock.calls[0][0].where).toEqual({ organization_id: { in: ['org-a'] } });
  });

  it('restricts a creator-only reader to their own rows', async () => {
    m.getModelPermissions.mockResolvedValue(perms({ creator: true }));
    await call('ticket', 'status');
    expect(m.ticketGroupBy.mock.calls[0][0].where).toEqual({
      AND: [{ organization_id: { in: ['org-a'] } }, { OR: [{ creator_id: actor }] }],
    });
  });

  it('looks up FK labels through the target entity organization scope', async () => {
    m.ticketGroupBy.mockResolvedValue([{ assignee_id: 'u1', _count: { id: 2 } }]);
    m.userFindMany.mockResolvedValue([{ id: 'u1', name: 'Alice' }]);
    const out = await call('ticket', 'assignee_id');
    expect(m.userFindMany.mock.calls[0][0].where).toEqual({
      AND: [{ organization_id: { in: ['org-a'] } }, { id: { in: ['u1'] } }],
    });
    expect(out).toEqual({ kind: 'single', data: [{ label: 'Alice', count: 2 }] });
  });

  it('shows no label for an FK target the viewer cannot read', async () => {
    m.getModelPermissions.mockImplementation(async (model: string) =>
      model === 'user' ? perms({}) : perms({ general: true }),
    );
    m.ticketGroupBy.mockResolvedValue([{ assignee_id: 'u1', _count: { id: 2 } }]);
    const out = await call('ticket', 'assignee_id');
    expect(m.userFindMany).not.toHaveBeenCalled();
    expect(out).toEqual({ kind: 'single', data: [{ label: '(unknown)', count: 2 }] });
  });

  it('applies the target scope to FK labels of a two-field group-by', async () => {
    m.ticketGroupBy.mockResolvedValue([{ status: 0, assignee_id: 'u1', _count: { id: 1 } }]);
    await call('ticket', 'status', null, 'assignee_id');
    expect(m.userFindMany.mock.calls[0][0].where).toEqual({
      AND: [{ organization_id: { in: ['org-a'] } }, { id: { in: ['u1'] } }],
    });
  });
});

describe('x-self-only and x-filter-values scope', () => {
  async function withScope(scope: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock('./access-scope', () => ({ DASHBOARD_ACCESS_SCOPES: { ticket: scope } }));
    return (await import('./aggregate-core')).aggregateForWidgetCore;
  }
  const base = {
    should_filter_by_org: false, org_relationship_optional: false, has_assignee_id: false,
    is_self_only: false, self_only_admin_bypass: false, filter_values: {},
  };

  it('x-self-only keeps rows to the viewer even with general read permission', async () => {
    const core = await withScope({ ...base, is_self_only: true });
    await core('api-user', 'ticket', 'status');
    expect(m.ticketGroupBy.mock.calls[0][0].where).toEqual({ creator_id: 'api-user' });
  });

  it('x-filter-values is ANDed with the widget conditions', async () => {
    const core = await withScope({ ...base, filter_values: { status: [0, 1] } });
    await core('api-user', 'ticket', 'status', null, undefined, [
      { field: 'status', operator: 'equals', values: [1] },
    ]);
    expect(m.ticketGroupBy.mock.calls[0][0].where).toEqual({
      AND: [{ status: { in: [0, 1] } }, { status: { equals: 1 } }],
    });
  });

  it('refuses an entity with no recorded scope facts', async () => {
    vi.resetModules();
    vi.doMock('./access-scope', () => ({ DASHBOARD_ACCESS_SCOPES: {} }));
    const { aggregateForWidgetCore: core } = await import('./aggregate-core');
    await core('api-user', 'ticket', 'status');
    expect(m.ticketGroupBy.mock.calls[0][0].where).toEqual({ id: '__no_access__' });
  });
});
