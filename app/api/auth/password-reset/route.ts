import { logger } from '@/lib/logger';
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import prisma from "@/lib/prisma";
import { getRateLimiter } from "@/lib/rate-limit";
import { clientIp } from "@/lib/rate-limit/client-ip";
import { siteConfig } from "@/lib/site-config";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { normalizeEmail } from "@/lib/auth/registration-token";
import { registrationLocale } from "@/lib/auth/registration-mail";
import { issuePasswordResetToken } from "@/lib/auth/password-reset-token";
import { buildPasswordResetMail } from "@/lib/auth/password-reset-mail";
import { resolveExternalUrl } from "@/lib/auth/external-url";

// Password reset, step 1 (Issue #1282): { email, locale? } -> 202, always the same answer.
// An address with a password account (not anonymized) receives a link valid for one hour;
// any other address receives nothing, so the response says nothing about which addresses
// have accounts. Available only with email verification on
// (siteConfig.auth.registration.emailVerification): the deployment then has a working mail
// transport and proven addresses. 404 otherwise.
//
// See docs/knowledge/authentication.md "Password reset".

const MAX_EMAIL_LENGTH = 320;

function emailBucketKey(email: string): string {
  return createHash("sha256").update(email, "utf8").digest("hex");
}

export async function POST(request: Request) {
  if (!siteConfig.auth.registration?.emailVerification) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const decision = await getRateLimiter().check("auth:password-reset", clientIp(request.headers));
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: decision.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
      );
    }

    const body = ((await request.json().catch(() => null)) ?? {}) as { email?: unknown; locale?: unknown };
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    if (!email || email.length > MAX_EMAIL_LENGTH || !email.includes("@")) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!isMailConfigured()) {
      logger.error("[password-reset] no mail transport is configured (SMTP_URL)");
      return NextResponse.json({ error: "Password reset failed", code: "PASSWORD_RESET_FAILED" }, { status: 500 });
    }

    const accepted = NextResponse.json({ ok: true }, { status: 202 });
    // Per-address ceiling: past it the answer stays 202 and nothing is sent.
    const perAddress = await getRateLimiter().check("auth:password-reset:email", emailBucketKey(email));
    if (!perAddress.allowed) return accepted;

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, password: true, anonymized_at: true },
    });
    // OAuth-only accounts (no password) and erased accounts get nothing.
    if (!user || !user.password || user.anonymized_at) return accepted;

    const { protocol, host } = resolveExternalUrl({
      forwardedHost: request.headers.get("x-forwarded-host"),
      forwardedProto: request.headers.get("x-forwarded-proto"),
      hostHeader: request.headers.get("host"),
      nextUrl: new URL(request.url),
    });
    const token = await issuePasswordResetToken(prisma, email);
    await sendMail(
      await buildPasswordResetMail({ to: email, locale: registrationLocale(body.locale), origin: `${protocol}://${host}`, token }),
    );
    return accepted;
  } catch (err) {
    logger.error("[password-reset] failed", {
      name: err instanceof Error ? err.name : typeof err,
      code: (err as { code?: unknown } | null)?.code,
    });
    return NextResponse.json({ error: "Password reset failed", code: "PASSWORD_RESET_FAILED" }, { status: 500 });
  }
}
