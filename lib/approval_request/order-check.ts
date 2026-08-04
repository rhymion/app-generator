import prisma from '@/lib/prisma';
import { ApiError } from '@/lib/api-auth';
import type { PrismaClient } from '@/app/generated/prisma/client';

// Structural shape shared by both the top-level `prisma` client and an
// interactive `tx` client passed into `prisma.$transaction(async (tx) => ...)`
// — same pattern as lib/_notifyApprovalRequest.ts's `Tx` type. Lets
// findNewlyActionableFollowFlowIds() below be called from inside or outside
// a transaction without duplicating its signature.
type Db = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Assert that all preceding approval flows for the given approval_request
 * have been approved (status='approved') on the same approvable.
 * Throws ApiError(400) if the ordering constraint is not satisfied.
 */
export async function assertApprovalOrder(id: string): Promise<void> {
  const req = await prisma.approval_request.findUnique({
    where: { id },
    select: {
      approvable_id: true,
      approval_flow: { select: { preceded_by: { select: { id: true } } } },
    },
  });
  if (!req) throw new ApiError(404, 'Approval request not found');

  const precedingFlowIds = req.approval_flow?.preceded_by.map((f) => f.id) ?? [];
  if (precedingFlowIds.length === 0) return;

  const siblings = await prisma.approval_request.findMany({
    where: { approvable_id: req.approvable_id, approval_flow_id: { in: precedingFlowIds } },
    select: { approval_flow_id: true, status: true },
  });

  const allApproved = precedingFlowIds.every((fid) =>
    siblings.some((s) => s.approval_flow_id === fid && s.status === 'approved'),
  );
  if (!allApproved) {
    throw new ApiError(400, 'Preceding approval requests must be approved first');
  }
}

/**
 * cmd_541: given the flow that was just approved for `approvableId`, return
 * the ids of any follow-on flows (`followed_by`) whose ordering constraint
 * just became fully satisfied — every flow that lists `justApprovedFlowId`
 * among its `preceded_by`, for which *all* of its preceded_by flows now
 * have an approved approval_request on this approvable. Mirrors
 * assertApprovalOrder()'s all-preceding-approved check, run in the other
 * direction (forward from the flow that just completed, instead of
 * backward from the flow being acted on) to drive the "your turn has
 * arrived" re-notification — see lib/_notifyApprovalRequest.ts's
 * notifyApprovalOrderReached().
 */
export async function findNewlyActionableFollowFlowIds(
  db: Db,
  approvableId: string,
  justApprovedFlowId: string,
): Promise<string[]> {
  const flow = await db.approval_flow.findUnique({
    where: { id: justApprovedFlowId },
    select: { followed_by: { select: { id: true, preceded_by: { select: { id: true } } } } },
  });
  const candidates = flow?.followed_by ?? [];
  if (candidates.length === 0) return [];

  const precedingIds = [...new Set(candidates.flatMap((f) => f.preceded_by.map((p) => p.id)))];
  const siblings = await db.approval_request.findMany({
    where: { approvable_id: approvableId, approval_flow_id: { in: precedingIds } },
    select: { approval_flow_id: true, status: true },
  });

  return candidates
    .filter((f) =>
      f.preceded_by.every((p) => siblings.some((s) => s.approval_flow_id === p.id && s.status === 'approved')),
    )
    .map((f) => f.id);
}
