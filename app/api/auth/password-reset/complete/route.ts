import { logger } from '@/lib/logger';
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { getRateLimiter } from "@/lib/rate-limit";
import { clientIp } from "@/lib/rate-limit/client-ip";
import { siteConfig } from "@/lib/site-config";
import { passwordPolicyError } from "@/lib/auth/password-policy";
import { consumePasswordResetToken, peekPasswordResetToken } from "@/lib/auth/password-reset-token";
import { clearFailedSignIns } from "@/lib/auth/account-lockout";
import { verifyMfaCode } from "@/lib/mfa/verify";
import { MfaRateLimitedError } from "@/lib/mfa/errors";
import { recordAuditEvent } from "@/lib/audit-log";

// Password reset, step 2 (Issue #1282): { token, password, mfaCode? }.
//
//   - The single-use link token from step 1 is the credential.
//   - MFA stays in force: a user with MFA enabled must also give a current TOTP code or an
//     unused recovery code (verifyMfaCode, rate limited per user). The code is checked before
//     the token is used up, so a mistyped code does not burn the link.
//   - On success the password is replaced, the user's mobile sessions are revoked, the sign-in
//     lockout counters for the address are cleared and `auth:passwordReset` is audited.
//     Web sessions are JWTs and cannot be revoked server-side (#1127); they end at their
//     configured lifetime.
//
// 404 while email verification is off. See docs/knowledge/authentication.md "Password reset".

const BCRYPT_COST = 10;

function invalidToken(): NextResponse {
  return NextResponse.json({ error: "This link cannot be used.", code: "INVALID_TOKEN" }, { status: 400 });
}

export async function POST(request: Request) {
  if (!siteConfig.auth.registration?.emailVerification) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const decision = await getRateLimiter().check("auth:password-reset:complete", clientIp(request.headers));
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: decision.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
      );
    }

    const body = ((await request.json().catch(() => null)) ?? {}) as { token?: unknown; password?: unknown; mfaCode?: unknown };
    const token = typeof body.token === "string" ? body.token : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!token || !password) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    const weak = passwordPolicyError(password);
    if (weak) {
      return NextResponse.json({ error: weak, code: "WEAK_PASSWORD" }, { status: 400 });
    }

    const email = await peekPasswordResetToken(prisma, token);
    if (!email) return invalidToken();
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, password: true, mfa_enabled: true, anonymized_at: true },
    });
    if (!user || !user.password || user.anonymized_at) return invalidToken();

    if (user.mfa_enabled) {
      const code = typeof body.mfaCode === "string" ? body.mfaCode.trim() : "";
      if (!code) return NextResponse.json({ error: "Authentication code required.", code: "MFA_REQUIRED" }, { status: 401 });
      let ok = false;
      try {
        ok = await verifyMfaCode(user.id, code);
      } catch (e) {
        if (e instanceof MfaRateLimitedError) {
          return NextResponse.json({ error: "rate_limited", code: "MFA_RATE_LIMITED" }, { status: 429 });
        }
        throw e;
      }
      if (!ok) return NextResponse.json({ error: "That code did not match.", code: "INVALID_MFA_CODE" }, { status: 401 });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const done = await prisma.$transaction(async (tx) => {
      // Consumed inside the transaction: of two concurrent requests only one resets.
      const consumed = await consumePasswordResetToken(tx, token);
      if (consumed !== email) return false;
      await tx.user.update({ where: { id: user.id }, data: { password: passwordHash, updater_id: user.id } });
      await tx.mobile_session.updateMany({
        where: { user_id: user.id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      await recordAuditEvent({
        action: "auth:passwordReset",
        actor_user_id: user.id,
        target_table: "user",
        target_id: user.id,
        metadata: { mfa: user.mfa_enabled },
        tx,
      });
      return true;
    });
    if (!done) return invalidToken();

    await clearFailedSignIns(email, request.headers);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    logger.error("[password-reset:complete] failed", {
      name: err instanceof Error ? err.name : typeof err,
      code: (err as { code?: unknown } | null)?.code,
    });
    return NextResponse.json({ error: "Password reset failed", code: "PASSWORD_RESET_FAILED" }, { status: 500 });
  }
}
