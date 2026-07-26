import prisma from '@/lib/prisma';
import { ApiError } from '@/lib/api-auth';

/**
 * Assert that all preceding approval flows for the given approval_request
 * have been approved (status='Approved') on the same approvable.
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
    siblings.some((s) => s.approval_flow_id === fid && s.status === 'Approved'),
  );
  if (!allApproved) {
    throw new ApiError(400, 'Preceding approval requests must be approved first');
  }
}
