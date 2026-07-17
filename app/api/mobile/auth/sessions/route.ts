import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { handleApiError, requireMobileAuth } from '@/lib/api-auth';
import { withMobileCors, mobileCorsPreflight } from '@/lib/mobile-auth';

export async function OPTIONS() {
  return mobileCorsPreflight();
}

/** GET /api/mobile/auth/sessions — list the caller's active mobile devices (GAP-2). */
export async function GET(request: NextRequest) {
  return withMobileCors(await handleGet(request));
}

async function handleGet(request: NextRequest): Promise<NextResponse> {
  try {
    const { userId, sessionId: currentSessionId } = await requireMobileAuth(request);
    const sessions = await prisma.mobile_session.findMany({
      where: { user_id: userId, revoked_at: null },
      orderBy: { last_used_at: 'desc' },
      select: { id: true, device_name: true, last_used_at: true, created_at: true },
    });

    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        device_name: s.device_name,
        last_used_at: s.last_used_at,
        created_at: s.created_at,
        current: s.id === currentSessionId,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
