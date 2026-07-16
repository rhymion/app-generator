import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, handleApiError } from '@/lib/api-auth';
import { ApiError } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { getUserRoleIds } from '@/lib/authz';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { userId } = await authenticateApiKey(request);

    const req = await prisma.approval_request.findUnique({
      where: { id },
      select: {
        status: true,
        approval_flow: { select: { requestor_role_id: true } },
        approvable: { select: { creator_id: true } },
      },
    });
    if (!req) throw new ApiError(404, 'Approval request not found');
    if (req.status === 3) throw new ApiError(400, 'Terminal rejected requests cannot be re-submitted');
    if (req.status !== 2) throw new ApiError(400, 'Only rejected requests can be re-submitted');

    // Authorize: entity creator or user in requestor_role
    const entityCreatorId = req.approvable?.creator_id;
    const requestorRoleId = req.approval_flow?.requestor_role_id;
    let authorized = entityCreatorId === userId;
    if (!authorized && requestorRoleId) {
      const roleIds = await getUserRoleIds(userId);
      authorized = roleIds.includes(requestorRoleId);
    }
    if (!authorized) throw new ApiError(403, 'Access denied: not authorized to re-submit this request');

    const body = await request.json().catch(() => ({}));
    const message: string | undefined = body?.message || undefined;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.approval_request.update({ where: { id }, data: { status: 0 } });
      await tx.approval_history.create({
        data: { approval_request_id: id, pre_status: 2, post_status: 0, message: message ?? null, creator_id: userId },
      });
      return result;
    });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
