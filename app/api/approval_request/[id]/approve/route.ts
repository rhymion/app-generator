import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, handleApiError } from '@/lib/api-auth';
import { ApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { getUserRoleIds } from '@/lib/authz';
import { assertApprovalOrder } from '@/lib/approval_request/order-check';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);

    const req = await prisma.approval_request.findUnique({
      where: { id },
      select: { approval_flow: { select: { approver_role_id: true } } },
    });
    if (!req?.approval_flow) throw new ApiError(404, 'Approval request not found');

    const roleIds = await getUserRoleIds(userId);
    if (!roleIds.includes(req.approval_flow.approver_role_id)) {
      throw new ApiError(403, 'Access denied: not a member of the approver role');
    }

    await assertApprovalOrder(id);

    const body = await request.json().catch(() => ({}));
    const message: string | undefined = body?.message || undefined;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.approval_request.update({ where: { id }, data: { status: 1 } });
      await tx.approval_history.create({
        data: { approval_request_id: id, pre_status: 0, post_status: 1, message: message ?? null, creator_id: userId },
      });
      return result;
    });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
