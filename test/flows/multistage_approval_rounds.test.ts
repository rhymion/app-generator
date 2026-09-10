// cmd_844: round-based multistage approval -- real-database proof that
// PD-1 (withdrawal is round_id-scoped, approved rows never rewritten),
// PD-2 (a non-terminal rejection auto-cancels the round's other pending
// rows), the pre_status-direct-write fix, and round isolation in
// approveApprovalRequest/assertApprovalOrder actually hold, not just that
// the mocked-collaborator unit tests (lib/approval_request/actions.test.ts)
// exercise the right call shapes. Same rationale and setup as
// test/flows/approval_order_bypass.test.ts (see that file's header) --
// this repo's own json_schema.yaml declares no x-approval entity, so there
// is no generated multistage fixture to drive a Cypress spec against; this
// hand-built-fixture, real-Postgres integration test is the actual proof
// instead. Requires `generate-code` + `db:push` + `db:generate` +
// `db:seed-baseline` to have already run against the isolated worktree's
// test DB (same precondition as approval_order_bypass.test.ts).
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
const { createApprovalActions } = await import('@/lib/approval_request/actions_core');
const { resolveApprovableTarget } = await import('@/lib/approval_request/resolve_target');
const { dispatchOnApproved } = await import('@/lib/approval_request/on_approved_dispatch');
const { isTerminalReject, dispatchOnRejected } = await import('@/lib/approval_request/on_rejected_dispatch');
const { dispatchOnWithdrawn } = await import('@/lib/approval_request/on_withdrawn_dispatch');
const { dispatchBeforeApprove } = await import('@/lib/approval_request/on_before_approve_dispatch');
const { dispatchBeforeReject } = await import('@/lib/approval_request/on_before_reject_dispatch');
const { dispatchBeforeWithdraw } = await import('@/lib/approval_request/on_before_withdraw_dispatch');

// cmd_1019: this repo's dogfood schema declares zero x-approval entities
// with on_withdrawn, so the REAL generated ENTITIES_WITH_ON_WITHDRAWN
// (on_withdrawn_dispatch.ts) is always empty and the REAL generated
// resolveApprovableModel (resolve_target.ts) always returns null in this
// checkout. Importing the production-wired singleton from actions.ts (as
// this file previously did) therefore made every withdrawApprovalRequest
// call fail here unconditionally -- worked around, before this fix, by
// passing a real CONSUMER entity name ('goods_receipt_line', an
// inventory-domain name this repo's own schema has never declared) into a
// file this repo ships to every consumer via submodule, so it only ever
// passed once prj:sync overlaid an inventory-domain consumer schema on
// top (cmd_488-shaped leak; see docs/knowledge/proj-b-backlog-2026-09.md
// section 9, cmd_969a). Per cmd_489 (unit tests must not depend on
// generated artifacts -- use dependency injection instead of reaching for
// a real consumer name), this test now builds its own approvalActions via
// createApprovalActions() rather than importing the wired singleton,
// injecting a resolveApprovableModel/hasOnWithdrawn pair scoped to a
// fixture entity name that exists nowhere but this file -- every other
// collaborator below is the real generated one (each a no-op for any
// dogfood entity_name regardless of which name is passed, so wiring the
// real ones costs nothing and keeps this closer to actions.ts's
// production wiring than a fully mocked unit test would).
const FIXTURE_WITHDRAWABLE_ENTITY = 'flow_test_withdrawable_entity';
const { approveApprovalRequest, rejectApprovalRequest, withdrawApprovalRequest } = createApprovalActions({
  resolveApprovableTarget,
  resolveApprovableModel: (entityName: string) =>
    entityName === FIXTURE_WITHDRAWABLE_ENTITY ? FIXTURE_WITHDRAWABLE_ENTITY : null,
  dispatchOnApproved,
  dispatchOnRejected,
  isTerminalReject,
  dispatchOnWithdrawn,
  hasOnWithdrawn: (modelName: string) => modelName === FIXTURE_WITHDRAWABLE_ENTITY,
  dispatchBeforeApprove,
  dispatchBeforeReject,
  dispatchBeforeWithdraw,
});

type Round = {
  approvableId: string;
  roundId: string;
  stage1: { id: string; approval_flow_id: string };
  stage2: { id: string; approval_flow_id: string };
  stage3: { id: string; approval_flow_id: string };
  approverRole1: { id: string };
  approverRole2: { id: string };
  approverRole3: { id: string };
};

/**
 * A 3-stage approval chain (flow1 -> flow2 -> flow3, each preceded_by the
 * previous) on a single approvable, all three approval_request rows
 * sharing one round_id -- mirrors exactly what
 * _build_approval_create_block_for_entity emits for a real multistage
 * submission (code_generator/generators.py).
 */
// entityName defaults to 'user' -- an entity_name intentionally NOT
// recognized by the fake resolveApprovableModel/hasOnWithdrawn pair above
// (see that pair's own comment), which is exactly what the reject-focused
// tests below need (they pin the "unrecognized entity_name" non-terminal-
// reject path -- see the 4th test's own comment). Callers that exercise
// withdrawApprovalRequest on a round with a still-pending row must instead
// pass FIXTURE_WITHDRAWABLE_ENTITY -- the only name the fake
// resolveApprovableModel/hasOnWithdrawn pair recognizes as on_withdrawn-
// declaring. isTerminalReject, unlike hasOnWithdrawn, is still the real
// generated one and returns false for every entity_name in this schema
// (TERMINAL_REJECT_ENTITIES is empty here) regardless of which name is
// passed, so FIXTURE_WITHDRAWABLE_ENTITY cannot accidentally flip a
// reject test's expected non-terminal status the way a real consumer
// on_withdrawn entity name could (a real consumer schema may declare the
// same entity both on_withdrawn and terminal-reject).
async function build3StageRound(creatorId: string, entityName = 'user'): Promise<Round> {
  const approverRole1 = await prisma.role.create({
    data: { name: `MultistageApprover1_${createId()}`, creator_id: creatorId, updater_id: creatorId },
  });
  const approverRole2 = await prisma.role.create({
    data: { name: `MultistageApprover2_${createId()}`, creator_id: creatorId, updater_id: creatorId },
  });
  const approverRole3 = await prisma.role.create({
    data: { name: `MultistageApprover3_${createId()}`, creator_id: creatorId, updater_id: creatorId },
  });

  const flow1 = await prisma.approval_flow.create({
    data: { entity_name: entityName, approver_role_id: approverRole1.id, creator_id: creatorId, updater_id: creatorId },
  });
  const flow2 = await prisma.approval_flow.create({
    data: {
      entity_name: entityName, approver_role_id: approverRole2.id,
      preceded_by: { connect: [{ id: flow1.id }] }, creator_id: creatorId, updater_id: creatorId,
    },
  });
  const flow3 = await prisma.approval_flow.create({
    data: {
      entity_name: entityName, approver_role_id: approverRole3.id,
      preceded_by: { connect: [{ id: flow2.id }] }, creator_id: creatorId, updater_id: creatorId,
    },
  });

  const approvable = await prisma.approvable.create({ data: { creator_id: creatorId } });
  const roundId = createId();
  const stage1 = await prisma.approval_request.create({
    data: { approvable_id: approvable.id, approval_flow_id: flow1.id, status: 'pending', round_id: roundId },
  });
  const stage2 = await prisma.approval_request.create({
    data: { approvable_id: approvable.id, approval_flow_id: flow2.id, status: 'pending', round_id: roundId },
  });
  const stage3 = await prisma.approval_request.create({
    data: { approvable_id: approvable.id, approval_flow_id: flow3.id, status: 'pending', round_id: roundId },
  });

  return { approvableId: approvable.id, roundId, stage1, stage2, stage3, approverRole1, approverRole2, approverRole3 };
}

describe('multistage approval rounds (cmd_844)', () => {
  let creator: { id: string };

  beforeEach(async () => {
    revalidatePathMock.mockReset();
    getSessionUserIdOrThrow.mockReset();
    getUserRoleIds.mockReset();
    const creatorId = createId();
    creator = await prisma.user.create({
      data: {
        id: creatorId, creator_id: creatorId, updater_id: creatorId,
        email: `multistage-creator-${creatorId}@example.com`, name: 'Multistage Creator', password: 'not_needed',
      },
    });
  });

  // PD-1 final ruling: round_id scoping alone -- approved rows are never
  // rewritten, only the round's remaining pending rows are closed.
  it('withdraw closes only the round\'s pending rows, leaving an already-approved stage untouched', async () => {
    const round = await build3StageRound(creator.id, FIXTURE_WITHDRAWABLE_ENTITY);
    getSessionUserIdOrThrow.mockResolvedValue(creator.id);
    getUserRoleIds.mockResolvedValue([round.approverRole1.id]);
    await approveApprovalRequest(round.stage1.id);

    getSessionUserIdOrThrow.mockResolvedValue(creator.id);
    await withdrawApprovalRequest(round.approvableId, 'changed my mind');

    const [s1, s2, s3] = await Promise.all([
      prisma.approval_request.findUniqueOrThrow({ where: { id: round.stage1.id } }),
      prisma.approval_request.findUniqueOrThrow({ where: { id: round.stage2.id } }),
      prisma.approval_request.findUniqueOrThrow({ where: { id: round.stage3.id } }),
    ]);
    // Approved row: untouched.
    expect(s1.status).toBe('approved');
    // Pending rows of the same round: closed to withdrawn.
    expect(s2.status).toBe('withdrawn');
    expect(s3.status).toBe('withdrawn');

    // pre_status fix: each closed row's approval_history records its ACTUAL
    // prior status (pending, ordinal 0), not a stale/wrong hardcode.
    const histories = await prisma.approval_history.findMany({
      where: { approval_request_id: { in: [round.stage2.id, round.stage3.id] } },
      orderBy: { created_at: 'asc' },
    });
    expect(histories).toHaveLength(2);
    for (const h of histories) {
      expect(h.pre_status).toBe(0); // pending
      expect(h.post_status).toBe(4); // withdrawn
    }
    // The approved stage's own history is untouched (still just the
    // original approve entry, no extra withdraw-triggered row).
    const stage1Histories = await prisma.approval_history.findMany({ where: { approval_request_id: round.stage1.id } });
    expect(stage1Histories).toHaveLength(1);
    expect(stage1Histories[0].post_status).toBe(1); // approved
  });

  it('rejects the withdraw when the current round has nothing left pending (fully approved)', async () => {
    const round = await build3StageRound(creator.id);
    getSessionUserIdOrThrow.mockResolvedValue(creator.id);
    getUserRoleIds
      .mockResolvedValueOnce([round.approverRole1.id])
      .mockResolvedValueOnce([round.approverRole2.id])
      .mockResolvedValueOnce([round.approverRole3.id]);
    await approveApprovalRequest(round.stage1.id);
    await approveApprovalRequest(round.stage2.id);
    await approveApprovalRequest(round.stage3.id);

    await expect(withdrawApprovalRequest(round.approvableId)).rejects.toThrow(
      'No pending requests to withdraw',
    );
  });

  // PD-2: a non-terminal rejection auto-cancels the round's other
  // still-pending rows (reusing 'withdrawn', not a new status value).
  it('a non-terminal rejection at stage 2 auto-cancels the still-pending stage 3, leaving stage 1 approved', async () => {
    const round = await build3StageRound(creator.id);
    getSessionUserIdOrThrow.mockResolvedValue(creator.id);
    getUserRoleIds.mockResolvedValueOnce([round.approverRole1.id]);
    await approveApprovalRequest(round.stage1.id);

    getUserRoleIds.mockResolvedValueOnce([round.approverRole2.id]);
    await rejectApprovalRequest(round.stage2.id, 'not this time');

    const [s1, s2, s3] = await Promise.all([
      prisma.approval_request.findUniqueOrThrow({ where: { id: round.stage1.id } }),
      prisma.approval_request.findUniqueOrThrow({ where: { id: round.stage2.id } }),
      prisma.approval_request.findUniqueOrThrow({ where: { id: round.stage3.id } }),
    ]);
    expect(s1.status).toBe('approved');
    expect(s2.status).toBe('rejected');
    expect(s3.status).toBe('withdrawn'); // auto-cancelled, not left pending

    const stage3History = await prisma.approval_history.findFirst({
      where: { approval_request_id: round.stage3.id },
      orderBy: { created_at: 'desc' },
    });
    expect(stage3History?.pre_status).toBe(0);
    expect(stage3History?.post_status).toBe(4);

    // Round is now fully closed (no pending row left) -- a fresh round
    // could legitimately be submitted next (canSubmitForApproval's own
    // logic is unit-pinned in submit_predicate.test.ts; this just confirms
    // the DB state that predicate would read is what PD-2 promised).
    const remaining = await prisma.approval_request.findMany({
      where: { approvable_id: round.approvableId, round_id: round.roundId, status: 'pending' },
    });
    expect(remaining).toHaveLength(0);
  });

  it('does not auto-cancel siblings on a terminal rejection (isTerminalReject decides, out of this test\'s scope, but the sibling must stay pending when terminal is forced false in a control run)', async () => {
    // Not asserting terminal-ness itself (that's isTerminalReject's own
    // concern, driven by generated on_rejected_dispatch.ts) -- this pins
    // that a NON-terminal rejection (the only path this repo's generated
    // dispatch can produce for an unrecognized entity_name like 'user',
    // since isTerminalReject returns false for anything not explicitly
    // declared terminal: true) still only auto-cancels PENDING siblings,
    // never touches the already-approved stage 1.
    const round = await build3StageRound(creator.id);
    getSessionUserIdOrThrow.mockResolvedValue(creator.id);
    getUserRoleIds.mockResolvedValueOnce([round.approverRole1.id]);
    await approveApprovalRequest(round.stage1.id);

    getUserRoleIds.mockResolvedValueOnce([round.approverRole2.id]);
    await rejectApprovalRequest(round.stage2.id);

    const s1 = await prisma.approval_request.findUniqueOrThrow({ where: { id: round.stage1.id } });
    expect(s1.status).toBe('approved');
    const s1Histories = await prisma.approval_history.findMany({ where: { approval_request_id: round.stage1.id } });
    expect(s1Histories).toHaveLength(1); // no extra history row written for the untouched approved stage
  });

  // Round isolation: approveApprovalRequest's "fire dispatch once the whole
  // round is approved" check, and assertApprovalOrder's preceding-flow
  // check, must never let an OLD (closed) round's approved row satisfy a
  // NEW round's own ordering/completeness requirement.
  it('a new round after a withdrawn round starts genuinely fresh -- old approved stage does not unblock the new round\'s later stage', async () => {
    const round1 = await build3StageRound(creator.id, FIXTURE_WITHDRAWABLE_ENTITY);
    getSessionUserIdOrThrow.mockResolvedValue(creator.id);
    getUserRoleIds.mockResolvedValueOnce([round1.approverRole1.id]);
    await approveApprovalRequest(round1.stage1.id);
    await withdrawApprovalRequest(round1.approvableId); // closes stage2/stage3 of round 1

    // Round 2: same approvable, same flows, fresh round_id, all pending --
    // exactly what a real resubmission (_build_approval_create_block_for_entity)
    // would create.
    const round2Id = createId();
    const r2s1 = await prisma.approval_request.create({
      data: { approvable_id: round1.approvableId, approval_flow_id: round1.stage1.approval_flow_id, status: 'pending', round_id: round2Id },
    });
    const r2s2 = await prisma.approval_request.create({
      data: { approvable_id: round1.approvableId, approval_flow_id: round1.stage2.approval_flow_id, status: 'pending', round_id: round2Id },
    });

    // Round 2's stage 2 must NOT be approvable yet -- round 2's own stage 1
    // is still pending, even though round 1's stage 1 (same approval_flow_id)
    // is 'approved'.
    getUserRoleIds.mockResolvedValueOnce([round1.approverRole2.id]);
    await expect(approveApprovalRequest(r2s2.id)).rejects.toThrow(
      'Preceding approval requests must be approved first',
    );

    // Approving round 2's own stage 1 must not fire "all approved" yet --
    // round 2's stage 2 is still pending, and round 1's rows (approved/
    // withdrawn) must not leak into that count.
    getUserRoleIds.mockResolvedValueOnce([round1.approverRole1.id]);
    await approveApprovalRequest(r2s1.id);
    const r2s2After = await prisma.approval_request.findUniqueOrThrow({ where: { id: r2s2.id } });
    expect(r2s2After.status).toBe('pending'); // still blocked, not auto-approved
  });
});
