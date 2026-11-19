import { logger } from '@/lib/logger';
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { hashPassword } from "@/lib/auth/bcrypt-cost";
import prisma from "@/lib/prisma";
import { getRateLimiter } from "@/lib/rate-limit";
import { clientIp } from "@/lib/rate-limit/client-ip";
import { checkPassword } from "@/lib/auth/password-policy";
import { siteConfig } from "@/lib/site-config";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { issueRegistrationToken, normalizeEmail } from "@/lib/auth/registration-token";
import { buildRegistrationMail, registrationLocale } from "@/lib/auth/registration-mail";
import { resolveExternalUrl } from "@/lib/auth/external-url";
import {
  REGISTRATION_NOT_ALLOWED,
  isRegistrationEmailAllowed,
  registrationAllowedDomains,
} from "@/lib/auth/domain-allow-list";

// Self-registration. Two modes, chosen by siteConfig.auth.registration.emailVerification
// (written by generate-code from x-generator.email-verification.enabled; Issue #1092):
//
//   off (default)  { name, email, password } creates the account at once (201), and an
//                  address that already has an account answers 409.
//   on             { email, locale? } creates nothing. The answer is 202 whether or not
//                  the address has an account; the address receives either a sign-up link
//                  (finished at POST /api/auth/register/complete) or a notice that an
//                  account already exists.
//
// In both modes an address outside siteConfig.auth.registrationAllowedDomains (when the
// list is set) is refused with 403 before anything is read, written or mailed (Issue #1093).
//
// See docs/knowledge/authentication.md "Self-registration".

function domainAllowed(email: string): boolean {
  return isRegistrationEmailAllowed(email, registrationAllowedDomains(siteConfig.auth));
}

const MAX_EMAIL_LENGTH = 320;

function emailBucketKey(email: string): string {
  return createHash("sha256").update(email, "utf8").digest("hex");
}

function linkOrigin(request: Request): string {
  const headers = request.headers;
  const { protocol, host } = resolveExternalUrl({
    forwardedHost: headers.get("x-forwarded-host"),
    forwardedProto: headers.get("x-forwarded-proto"),
    hostHeader: headers.get("host"),
    nextUrl: new URL(request.url),
  });
  return `${protocol}://${host}`;
}

async function requestSignUpLink(request: Request, body: { email?: unknown; locale?: unknown }): Promise<NextResponse> {
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  if (!email || email.length > MAX_EMAIL_LENGTH || !email.includes("@")) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  // Before the mail transport, the rate limit and the account lookup: a refused
  // domain never triggers an outbound message (Issue #1093).
  if (!domainAllowed(email)) {
    return NextResponse.json(REGISTRATION_NOT_ALLOWED, { status: 403 });
  }
  // A production deployment with verification on and no mail transport fails
  // loudly instead of answering 202 for links that are never sent.
  if (!isMailConfigured()) {
    logger.error("[register] email verification is on but no mail transport is configured (SMTP_URL)");
    return NextResponse.json(
      { error: "Registration failed", code: "REGISTRATION_FAILED" },
      { status: 500 },
    );
  }

  const accepted = NextResponse.json({ ok: true }, { status: 202 });
  // Per-address ceiling: past it the answer stays 202 and no mail is sent, so
  // the response says nothing about the address either way.
  const perAddress = await getRateLimiter().check("auth:register:email", emailBucketKey(email));
  if (!perAddress.allowed) return accepted;

  const locale = registrationLocale(body.locale);
  const origin = linkOrigin(request);
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  const message = existing
    ? await buildRegistrationMail({ kind: "existing", to: email, locale, origin })
    : await buildRegistrationMail({
        kind: "new",
        to: email,
        locale,
        origin,
        token: await issueRegistrationToken(prisma, email),
      });
  await sendMail(message);
  return accepted;
}

export async function POST(request: Request) {
  try {
    // Per-IP ceiling, checked before any body parsing or database read.
    const decision = await getRateLimiter().check("auth:register", clientIp(request.headers));
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: decision.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
      );
    }

    const body = await request.json();

    if (siteConfig.auth.registration?.emailVerification) {
      return await requestSignUpLink(request, body ?? {});
    }

    const { name, email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (typeof email !== "string" || !domainAllowed(email)) {
      return NextResponse.json(REGISTRATION_NOT_ALLOWED, { status: 403 });
    }

    const weak = await checkPassword(password, { email, name: typeof name === "string" ? name : null });
    if (weak) {
      return NextResponse.json({ error: weak, code: "WEAK_PASSWORD" }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }

    const userId = createId();
    await prisma.user.create({
      data: {
        id: userId,
        creator_id: userId,
        updater_id: userId,
        name: name ?? email,
        email,
        password: await hashPassword(password),
      },
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    // Log only the error class and Prisma code: a database validation error's
    // message embeds the call arguments, including the submitted password hash.
    logger.error("[register] failed", {
      name: err instanceof Error ? err.name : typeof err,
      code: (err as { code?: unknown } | null)?.code,
    });
    return NextResponse.json(
      { error: "Registration failed", code: "REGISTRATION_FAILED" },
      { status: 500 }
    );
  }
}
