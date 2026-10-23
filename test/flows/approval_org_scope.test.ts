// Approve/reject require the approver role AND membership in the target
// record's organization. Real-database proof through both entry points that
// can act on an approval request: the REST routes
// (app/api/approval_request/[id]/{approve,reject}/route.ts) and the Server
// Action (lib/approval_request/actions.ts). Each case sends the request that
// used to succeed -- an approver-role user of organization A acting on a
// request whose record belongs to organization B -- and asserts it is refused
// and nothing changed, next to the legitimate request that must still work.
//
// This repo's own json_schema.yaml declares no x-approval entity, so the
// generated organization lookup (resolveApprovableOrganization) has no entry
// for a test entity; it is wrapped here for one test-owned entity name, and
// every other part of the path (routes, actions, org-check.ts, the real
// membership query) is the shipped code. Same precondition as
// approval_order_bypass.test.ts: generate-code + db:push + db:generate +
// db:seed-baseline already run against the worktree's test DB.
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(path.resolve(process.cwd()), process.env.NODE_ENV !== 'production');

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// The real authz/api-auth modules import next-auth, which cannot load under
// vitest; only the pieces the approval code uses are replaced. getUserRoleIds
// reads the real role membership from the database.
const getSessionUserIdOrThrow = vi.fn();
vi.mock('@/lib/authz', async () => {
  const { default: db } = await import('@/lib/prisma');
  return {
    getSessionUserIdOrThrow,
    getUserRoleIds: async (userId: string) =>
      (await db.role.findMany({ where: { users: { some: { id: userId } } }, select: { id: true } })).map((r) => r.id),
  };
});

const requireCaller = vi.fn();
vi.mock('@/lib/api-auth', async () => {
  const { NextResponse } = await import('next/server');
  class ApiError extends Error {
    constructor(public statusCode: number, message: string) {
      super(message);
    }
  }
  return {
    ApiError,
    requireCaller,
    handleApiError: (error: unknown) =>
      error instanceof ApiError
        ? NextResponse.json({ error: error.message }, { status: error.statusCode })
        : NextResponse.json({ error: String(error) }, { status: 500 }),
  };
});

const SCOPED_ENTITY = vi.hoisted(() => 'org_scope_test_entity');
const ORG_BY_APPROVABLE = vi.hoisted(() => new Map<string, string | null>());
vi.mock('@/lib/approval_request/resolve_target', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/approval_request/resolve_target')>();
  return {
    ...original,
    resolveApprovableOrganization: async (
      tx: Parameters<typeof original.resolveApprovableOrganization>[0],
      entityType: string,
      approvableId: string,
    ) =>
      entityType === SCOPED_ENTITY
        ? { scoped: true as const, organizationId: ORG_BY_APPROVABLE.get(approvableId) ?? null }
        : original.resolveApprovableOrganization(tx, entityType, approvableId),
  };
});

const { default: prisma } = await import('@/lib/prisma');
const { approveApprovalRequest, rejectApprovalRequest } = await import('@/lib/approval_request/actions');
const approveRoute = await import('@/app/api/approval_request/[id]/approve/route');
const rejectRoute = await import('@/app/api/approval_request/[id]/reject/route');

async function callRoute(
  route: typeof approveRoute,
  userId: string,
  requestId: string,
): Promise<number> {
  requireCaller.mockResolvedValue({ userId });
  const req = new NextRequest(`http://localhost/api/approval_request/${requestId}/x`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  const res = await route.POST(req, { params: Promise.resolve({ id: requestId }) });
  return res.status;
}

describe('approve/reject require membership in the target record organization', () => {
  let admin: { id: string };
  let orgA: { id: string };
  let orgB: { id: string };
  let approverRole: { id: string };
  let approverA: { id: string };
  let approverB: { id: string };

  async function makeUser(label: string, orgId: string, withRole: boolean) {
    const id = createId();
    const user = await prisma.user.create({
      data: {
        id, creator_id: admin.id, updater_id: admin.id,
        email: `org-scope-${label}-${id}@example.com`, name: label, password: 'not_needed',
        organizations: { connect: { id: orgId } },
        ...(withRole ? { roles: { connect: { id: approverRole.id } } } : {}),
      },
    });
    return user;
  }

  // A pending request whose record belongs to `orgId`.
  async function makePendingRequest(orgId: string | null) {
    const flow = await prisma.approval_flow.findFirstOrThrow({ where: { approver_role_id: approverRole.id } });
    const approvable = await prisma.approvable.create({ data: { creator_id: admin.id } });
    ORG_BY_APPROVABLE.set(approvable.id, orgId);
    return prisma.approval_request.create({
      data: { approvable_id: approvable.id, approval_flow_id: flow.id, status: 'pending', round_id: createId() },
    });
  }

  const statusOf = async (id: string) =>
    (await prisma.approval_request.findUniqueOrThrow({ where: { id } })).status;

  beforeEach(async () => {
    ORG_BY_APPROVABLE.clear();
    getSessionUserIdOrThrow.mockReset();
    requireCaller.mockReset();
    const adminId = createId();
    admin = await prisma.user.create({
      data: {
        id: adminId, creator_id: adminId, updater_id: adminId,
        email: `org-scope-admin-${adminId}@example.com`, name: 'Org Scope Admin', password: 'not_needed',
      },
    });
    orgA = await prisma.organization.create({ data: { name: `OrgScopeA_${createId()}`, creator_id: admin.id, updater_id: admin.id } });
    orgB = await prisma.organization.create({ data: { name: `OrgScopeB_${createId()}`, creator_id: admin.id, updater_id: admin.id } });
    approverRole = await prisma.role.create({ data: { name: `OrgScopeApprover_${createId()}`, creator_id: admin.id, updater_id: admin.id } });
    await prisma.approval_flow.create({
      data: { entity_name: SCOPED_ENTITY, approver_role_id: approverRole.id, creator_id: admin.id, updater_id: admin.id },
    });
    approverA = await makeUser('approverA', orgA.id, true);
    approverB = await makeUser('approverB', orgB.id, true);
  });

  describe('REST routes', () => {
    it('refuses approve by an approver of another organization, leaving the request pending', async () => {
      const request = await makePendingRequest(orgB.id);
      expect(await callRoute(approveRoute, approverA.id, request.id)).toBe(404);
      expect(await statusOf(request.id)).toBe('pending');
    });

    it('refuses reject by an approver of another organization, leaving the request pending', async () => {
      const request = await makePendingRequest(orgB.id);
      expect(await callRoute(rejectRoute, approverA.id, request.id)).toBe(404);
      expect(await statusOf(request.id)).toBe('pending');
    });

    it('still lets an approver of the record organization approve and reject', async () => {
      const toApprove = await makePendingRequest(orgB.id);
      const toReject = await makePendingRequest(orgB.id);
      expect(await callRoute(approveRoute, approverB.id, toApprove.id)).toBe(200);
      expect(await callRoute(rejectRoute, approverB.id, toReject.id)).toBe(200);
      expect(await statusOf(toApprove.id)).toBe('approved');
      expect(await statusOf(toReject.id)).toBe('rejected');
    });

    it('still refuses a member of the record organization who lacks the approver role', async () => {
      const request = await makePendingRequest(orgB.id);
      const plainB = await makeUser('plainB', orgB.id, false);
      expect(await callRoute(approveRoute, plainB.id, request.id)).toBe(403);
      expect(await statusOf(request.id)).toBe('pending');
    });

    it('lets an approver act on a record that has no organization', async () => {
      const request = await makePendingRequest(null);
      expect(await callRoute(approveRoute, approverA.id, request.id)).toBe(200);
    });
  });

  describe('Server Action', () => {
    it('refuses approve by an approver of another organization, leaving the request pending', async () => {
      const request = await makePendingRequest(orgB.id);
      getSessionUserIdOrThrow.mockResolvedValue(approverA.id);
      await expect(approveApprovalRequest(request.id)).rejects.toThrow('Approval request not found');
      expect(await statusOf(request.id)).toBe('pending');
    });

    it('refuses reject by an approver of another organization, leaving the request pending', async () => {
      const request = await makePendingRequest(orgB.id);
      getSessionUserIdOrThrow.mockResolvedValue(approverA.id);
      await expect(rejectApprovalRequest(request.id)).rejects.toThrow('Approval request not found');
      expect(await statusOf(request.id)).toBe('pending');
    });

    it('still lets an approver of the record organization approve and reject', async () => {
      const toApprove = await makePendingRequest(orgB.id);
      const toReject = await makePendingRequest(orgB.id);
      getSessionUserIdOrThrow.mockResolvedValue(approverB.id);
      await approveApprovalRequest(toApprove.id);
      await rejectApprovalRequest(toReject.id);
      expect(await statusOf(toApprove.id)).toBe('approved');
      expect(await statusOf(toReject.id)).toBe('rejected');
    });
  });
});
