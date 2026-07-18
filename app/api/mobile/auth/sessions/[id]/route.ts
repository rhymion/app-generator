import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ApiError, handleApiError, requireMobileAuth } from '@/lib/api-auth';

type Params = { params: Promise<{ id: string }> };

/**
 * DELETE /api/mobile/auth/sessions/:id — revoke one device session, own or
 * others' (GAP-2 device-level revocation).
 *
 * Ownership is enforced in the query itself (`user_id: userId`), not by
 * trusting the path param alone — a caller can only ever match/revoke rows
 * that belong to them (cmd_321/324 precedent: authz on every mutating
 * path).
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  return handleDelete(request, { params });
}

async function handleDelete(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const { userId } = await requireMobileAuth(request);
    const { id } = await params;

    const result = await prisma.mobile_session.updateMany({
      where: { id, user_id: userId },
      data: { revoked_at: new Date() },
    });
    if (result.count === 0) {
      throw new ApiError(404, 'Session not found');
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
