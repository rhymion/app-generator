// cmd_540: REST routes (app/api/approval_request/[id]/{approve,reject}/route.ts)
// enforce multi-stage approval ordering via assertApprovalOrder() (see
// lib/approval_request/order-check.ts). The server actions in
// lib/approval_request/actions_core.ts (approveApprovalRequest/
// rejectApprovalRequest) are reachable directly from any authenticated
// client (Next.js Server Action RPC) — ApprovalSection.tsx merely hides the
// button client-side via a `precedingApproved` check, which is not an
// authorization boundary. Before cmd_540, calling the action directly (as
// this test does) let an approver approve/reject a later-stage
// approval_request while an earlier-stage one was still pending, bypassing
// the ordering constraint entirely.
//
// This is a full-stack integration test, not a mocked unit test: it runs
// against a real Postgres test database (same one npm run test:e2e:build
// sets up) via the actual generator-emitted collaborators
// (resolve_target.ts / on_approved_dispatch.ts / on_rejected_dispatch.ts),
// so it requires `generate-code` + `db:push` + `db:generate` +
// `db:seed-baseline` to have already run against the isolated worktree's test
// DB. Only the session/cookie identity boundary is mocked (@/lib/authz) —
// NextAuth's request-scoped cookie resolution has no meaning in a bare
// Node process and is not what this test is verifying. See
// docs/knowledge/troubleshooting.md §2.4 for why this lives under
// test/flows/ (excluded from the default `npm run test:vitest`, which must
// stay stack-independent) rather than lib/approval_request/actions.test.ts.
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(path.resolve(process.cwd()), process.env.NODE_ENV !== 'production');

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createId } from '@paralleldrive/cuid2';

const revalidatePathMock = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

const getSessionUserIdOrThrow = vi.fn();
const getUserRoleIds = vi.fn();
vi.mock('@/lib/authz', () => ({ getSessionUserIdOrThrow, getUserRoleIds }));

const { default: prisma } = await import('@/lib/prisma');
const { approveApprovalRequest, rejectApprovalRequest } = await import('@/lib/approval_request/actions');

type Fixture = {
  creatorUser: { id: string };
  approver: { id: string };
  approverRoleB: { id: string };
  approvable: { id: string };
  reqA: { id: string };
  reqB: { id: string };
};

/**
 * Builds a two-stage approval chain (flow A → flow B, B preceded_by A) with
 * both approval_requests pending, and a distinct approver (member of flow
 * B's approver role only — not flow A's) who is authorized to act on B but
 * not A. This mirrors the real-world shape: different roles approve
 * different stages of the same approvable.
 */
async function buildOutOfOrderChain(): Promise<Fixture> {
  const creatorUserId = createId();
  const creatorUser = await prisma.user.create({
    data: {
      id: creatorUserId,
      creator_id: creatorUserId,
      updater_id: creatorUserId,
      email: `order-chain-creator-${createId()}@example.com`,
      name: 'Order Chain Creator',
      password: 'not_needed',
    },
  });

  const approverRoleA = await prisma.role.create({
    data: { name: `OrderChainApproverA_${createId()}`, creator_id: creatorUser.id, updater_id: creatorUser.id },
  });
  const approverRoleB = await prisma.role.create({
    data: { name: `OrderChainApproverB_${createId()}`, creator_id: creatorUser.id, updater_id: creatorUser.id },
  });

  const approver = await prisma.user.create({
    data: {
      id: createId(),
      creator_id: creatorUser.id,
      updater_id: creatorUser.id,
      email: `order-chain-approver-${createId()}@example.com`,
      name: 'Order Chain Approver (stage B only)',
      password: 'not_needed',
      roles: { connect: [{ id: approverRoleB.id }] },
    },
  });

  const flowA = await prisma.approval_flow.create({
    data: {
      entity_name: 'user',
      approver_role_id: approverRoleA.id,
      creator_id: creatorUser.id,
      updater_id: creatorUser.id,
    },
  });
  const flowB = await prisma.approval_flow.create({
    data: {
      entity_name: 'user',
      approver_role_id: approverRoleB.id,
      preceded_by: { connect: [{ id: flowA.id }] },
      creator_id: creatorUser.id,
      updater_id: creatorUser.id,
    },
  });

  const approvable = await prisma.approvable.create({
    data: { creator_id: creatorUser.id },
  });

  const reqA = await prisma.approval_request.create({
    data: { approvable_id: approvable.id, approval_flow_id: flowA.id, status: 'pending' },
  });
  const reqB = await prisma.approval_request.create({
    data: { approvable_id: approvable.id, approval_flow_id: flowB.id, status: 'pending' },
  });

  return { creatorUser, approver, approverRoleB, approvable, reqA, reqB };
}

describe('approval_request server action order enforcement (cmd_540)', () => {
  beforeEach(() => {
    revalidatePathMock.mockReset();
    getSessionUserIdOrThrow.mockReset();
    getUserRoleIds.mockReset();
  });

  it('approveApprovalRequest rejects a later-stage approval while its preceding flow is still pending', async () => {
    const { approver, approverRoleB, reqA, reqB } = await buildOutOfOrderChain();
    getSessionUserIdOrThrow.mockResolvedValue(approver.id);
    getUserRoleIds.mockResolvedValue([approverRoleB.id]);

    await expect(approveApprovalRequest(reqB.id)).rejects.toThrow(
      /Preceding approval requests must be approved first/,
    );

    const after = await prisma.approval_request.findUnique({ where: { id: reqB.id } });
    expect(after?.status).toBe('pending');
    const untouched = await prisma.approval_request.findUnique({ where: { id: reqA.id } });
    expect(untouched?.status).toBe('pending');
  });

  it('rejectApprovalRequest rejects a later-stage rejection while its preceding flow is still pending', async () => {
    const { approver, approverRoleB, reqA, reqB } = await buildOutOfOrderChain();
    getSessionUserIdOrThrow.mockResolvedValue(approver.id);
    getUserRoleIds.mockResolvedValue([approverRoleB.id]);

    await expect(rejectApprovalRequest(reqB.id)).rejects.toThrow(
      /Preceding approval requests must be approved first/,
    );

    const after = await prisma.approval_request.findUnique({ where: { id: reqB.id } });
    expect(after?.status).toBe('pending');
    const untouched = await prisma.approval_request.findUnique({ where: { id: reqA.id } });
    expect(untouched?.status).toBe('pending');
  });

  it('approveApprovalRequest succeeds once the preceding flow is already approved (no false positive)', async () => {
    const { approver, approverRoleB, reqA, reqB } = await buildOutOfOrderChain();
    await prisma.approval_request.update({ where: { id: reqA.id }, data: { status: 'approved' } });
    getSessionUserIdOrThrow.mockResolvedValue(approver.id);
    getUserRoleIds.mockResolvedValue([approverRoleB.id]);

    await expect(approveApprovalRequest(reqB.id)).resolves.toBeUndefined();

    const after = await prisma.approval_request.findUnique({ where: { id: reqB.id } });
    expect(after?.status).toBe('approved');
  });
});
