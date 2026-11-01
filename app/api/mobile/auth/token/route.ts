import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword } from '@/lib/auth/password-check';
import { clearFailedSignIns, getAccountLockState, recordFailedSignIn } from '@/lib/auth/account-lockout';
import prisma from '@/lib/prisma';
import { ApiError, handleApiError, requireMobileAuth } from '@/lib/api-auth';
import { verifyMfaCode } from '@/lib/mfa/verify';
import { MfaRateLimitedError } from '@/lib/mfa/errors';
import { getRateLimiter } from '@/lib/rate-limit';
import { clientIp } from '@/lib/rate-limit/client-ip';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_MS,
  generateRefreshTokenPlaintext,
  hashRefreshToken,
  signMobileAccessToken,
} from '@/lib/mobile-auth';

/**
 * POST /api/mobile/auth/token — password-grant mobile login.
 * DELETE /api/mobile/auth/token — mobile logout.
 *
 * Mobile clients sign in with email and password instead of a manually
 * pasted API key. `lib/api-auth.ts`'s `authenticateApiKey()` / X-API-Key
 * support is untouched and keeps serving service-to-service access.
 */

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

    // Brute-force guard: keyed on IP+email so a
    // single attacker spraying many accounts from one IP, and a single
    // account being probed from many IPs, are both capped. Checked before
    // any DB read.
    const decision = await getRateLimiter().check(
      'mobile:auth:token',
      `${clientIp(request.headers)}:${email.toLowerCase()}`,
    );
    if (!decision.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfter: decision.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } },
      );
    }

    // Account lockout (Issue #1125): two tiers, shared with the web sign-in.
    const lock = await getAccountLockState(email, request.headers);
    if (lock.locked) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfter: lock.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(lock.retryAfterSeconds) } },
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    // SSO-only users (password === null) and unknown emails must be
    // indistinguishable from the caller's point of view — same as the
    // NextAuth credentials guard in auth.ts.
    // verifyPassword() compares against a throwaway hash when there is none, so
    // the response time does not reveal which case applied.
    const passwordOk = await verifyPassword(password, user?.password);
    if (!user || !user.password || !passwordOk) {
      await recordFailedSignIn(email, request.headers);
      throw new ApiError(401, 'Invalid credentials');
    }
    await clearFailedSignIns(email, request.headers);

    const mfaUser = user as unknown as { mfa_enabled?: boolean };
    if (mfaUser.mfa_enabled) {
      if (mfaCode.length === 0) {
        return NextResponse.json({ error: 'MFA_REQUIRED' }, { status: 403 });
      }
      let mfaOk = false;
      try {
        mfaOk = await verifyMfaCode(user.id, mfaCode);
      } catch (e) {
        if (e instanceof MfaRateLimitedError) {
          return NextResponse.json(
            { error: 'rate_limited', retryAfter: e.retryAfterSeconds },
            { status: 429, headers: { 'Retry-After': String(e.retryAfterSeconds) } },
          );
        }
        throw e;
      }
      if (!mfaOk) {
        throw new ApiError(401, 'Invalid credentials');
      }
    }

    // GDPR-anonymized accounts must not be able to authenticate.
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
    // email/name/role.
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
