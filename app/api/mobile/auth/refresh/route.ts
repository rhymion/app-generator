import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ApiError, handleApiError } from '@/lib/api-auth';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  generateRefreshTokenPlaintext,
  hashRefreshToken,
  signMobileAccessToken,
  withMobileCors,
  mobileCorsPreflight,
} from '@/lib/mobile-auth';

export async function OPTIONS() {
  return mobileCorsPreflight();
}

/**
 * POST /api/mobile/auth/refresh — rotate a refresh token for a new
 * access/refresh pair (cmd_354/357, 354a section_2/3).
 *
 * Rotation is unconditional on every call: the old hash is replaced with a
 * new one inside a compare-and-swap `updateMany`. A reused (already
 * rotated-away) refresh token either finds no matching row (ordinary case)
 * or loses the CAS race against a concurrent legitimate rotation (DP-3) —
 * either way the whole session is revoked and the caller gets 401.
 */
export async function POST(request: NextRequest) {
  return withMobileCors(await handlePost(request));
}

async function handlePost(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => null);
    const refreshToken = typeof body?.refresh_token === 'string' ? body.refresh_token : undefined;
    if (!refreshToken) {
      throw new ApiError(401, 'Invalid refresh token');
    }

    const oldHash = hashRefreshToken(refreshToken);
    const session = await prisma.mobile_session.findUnique({ where: { refresh_token_hash: oldHash } });
    if (!session || session.revoked_at || session.expires_at.getTime() < Date.now()) {
      throw new ApiError(401, 'Invalid or expired refresh token');
    }

    const newRefreshTokenPlaintext = generateRefreshTokenPlaintext();
    const newHash = hashRefreshToken(newRefreshTokenPlaintext);

    // DP-3: compare-and-swap on (id, old hash). If a concurrent request
    // already rotated this session's hash, this update matches 0 rows —
    // treat that as a reuse/theft race and revoke the whole session rather
    // than silently letting the loser retry.
    const result = await prisma.mobile_session.updateMany({
      where: { id: session.id, refresh_token_hash: oldHash },
      data: { refresh_token_hash: newHash, last_used_at: new Date() },
    });

    if (result.count === 0) {
      await prisma.mobile_session.update({
        where: { id: session.id },
        data: { revoked_at: new Date() },
      });
      throw new ApiError(401, 'Refresh token reuse detected; session revoked');
    }

    const accessToken = await signMobileAccessToken(session.user_id, session.id);

    return NextResponse.json({
      access_token: accessToken,
      refresh_token: newRefreshTokenPlaintext,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
