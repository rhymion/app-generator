import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { ApiError, handleApiError, requireMobileAuth } from '@/lib/api-auth';
import { verifyMfaCode } from '@/lib/mfa/verify';
import { getRateLimiter } from '@/lib/rate-limit';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_MS,
  generateRefreshTokenPlaintext,
  hashRefreshToken,
  signMobileAccessToken,
} from '@/lib/mobile-auth';

/**
 * POST /api/mobile/auth/token — password-grant mobile login (cmd_354/357).
 * DELETE /api/mobile/auth/token — mobile logout.
 *
 * This is the mobile-only replacement for the PoC's manually-pasted API
 * key (cmd_349). `lib/api-auth.ts`'s `authenticateApiKey()` / X-API-Key
 * support is untouched and keeps serving service-to-service access.
 */

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(request: NextRequest) {
  return handlePost(request);
}

async function handlePost(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email : undefined;
    const password = typeof body?.password === 'string' ? body.password : undefined;
    const mfaCode = typeof body?.mfa_code === 'string' ? body.mfa_code.trim() : '';
    const deviceName = typeof body?.device_name === 'string' ? body.device_name : null;

    if (!email || !password) {
      throw new ApiError(401, 'Invalid credentials');
    }

    // Brute-force guard (354a section_10.ii / DP-5): keyed on IP+email so a
    // single attacker spraying many accounts from one IP, and a single
    // account being probed from many IPs, are both capped. Checked before
    // any DB read.
    const decision = await getRateLimiter().check(
      'mobile:auth:token',
      `${clientIp(request)}:${email.toLowerCase()}`,
    );
    if (!decision.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfter: decision.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } },
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    // SSO-only users (password === null) and unknown emails must be
    // indistinguishable from the caller's point of view — same as the
    // NextAuth credentials guard in auth.ts.
    if (!user || !user.password) {
      throw new ApiError(401, 'Invalid credentials');
    }

    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) {
      throw new ApiError(401, 'Invalid credentials');
    }

    const mfaUser = user as unknown as { mfa_enabled?: boolean };
    if (mfaUser.mfa_enabled) {
      if (mfaCode.length === 0) {
        return NextResponse.json({ error: 'MFA_REQUIRED' }, { status: 403 });
      }
      const mfaOk = await verifyMfaCode(user.id, mfaCode);
      if (!mfaOk) {
        throw new ApiError(401, 'Invalid credentials');
      }
    }

    // GDPR-anonymized accounts must not be able to authenticate (354a
    // section_2 step 6 / section_10.iv).
    if (user.anonymized_at) {
      throw new ApiError(401, 'Invalid credentials');
    }

    const refreshTokenPlaintext = generateRefreshTokenPlaintext();
    const session = await prisma.mobile_session.create({
      data: {
        user_id: user.id,
        refresh_token_hash: hashRefreshToken(refreshTokenPlaintext),
        device_name: deviceName,
        expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    // Response payload deliberately carries only the token pair — no
    // email/name/role (354a section_10.iv / cmd_321-324 precedent).
    const accessToken = await signMobileAccessToken(user.id, session.id);

    return NextResponse.json(
      {
        access_token: accessToken,
        refresh_token: refreshTokenPlaintext,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  return handleDelete(request);
}

async function handleDelete(request: NextRequest): Promise<NextResponse> {
  try {
    const { sessionId } = await requireMobileAuth(request);
    await prisma.mobile_session.update({
      where: { id: sessionId },
      data: { revoked_at: new Date() },
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
