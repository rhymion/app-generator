import { logger } from '@/lib/logger';
import { NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { hashPassword } from "@/lib/auth/bcrypt-cost";
import prisma from "@/lib/prisma";
import { getRateLimiter } from "@/lib/rate-limit";
import { clientIp } from "@/lib/rate-limit/client-ip";
import { passwordPolicyError } from "@/lib/auth/password-policy";
import { siteConfig } from "@/lib/site-config";
import {
  REGISTRATION_NOT_ALLOWED,
  isRegistrationEmailAllowed,
  registrationAllowedDomains,
} from "@/lib/auth/domain-allow-list";
import { consumeRegistrationToken } from "@/lib/auth/registration-token";

// Second step of self-registration with email verification (Issue #1092): the
// sign-up link's token plus the name and password the registrant chose. The
// token proves the address, so the account is created with emailVerified set,
// and the answer (201) carries the address so the page can sign the new user in.
//
// An unknown, expired or used token, and a token whose address got an account
// in the meantime (another sign-up path), all answer the same 400 INVALID_TOKEN.
// The route does not exist (404) while email verification is off.
// See docs/knowledge/authentication.md "Self-registration".

const MAX_NAME_LENGTH = 200;

function invalidToken() {
  return NextResponse.json({ error: "Invalid or expired link", code: "INVALID_TOKEN" }, { status: 400 });
}

export async function POST(request: Request) {
  if (!siteConfig.auth.registration?.emailVerification) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const decision = await getRateLimiter().check("auth:register:complete", clientIp(request.headers));
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: decision.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
      );
    }

    const body = (await request.json()) ?? {};
    const token = typeof body.token === "string" ? body.token : "";
    const password = typeof body.password === "string" ? body.password : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!token || !password || name.length > MAX_NAME_LENGTH) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    // Checked before the token is used, so a weak password does not burn the link.
    const weak = passwordPolicyError(password);
    if (weak) {
      return NextResponse.json({ error: weak, code: "WEAK_PASSWORD" }, { status: 400 });
    }
    const passwordHash = await hashPassword(password);

    const created = await prisma.$transaction(async (tx) => {
      const email = await consumeRegistrationToken(tx, token);
      if (!email) return null;
      // Re-checked here: the allow-list may have changed since the link was sent (Issue #1093).
      if (!isRegistrationEmailAllowed(email, registrationAllowedDomains(siteConfig.auth))) return "not_allowed" as const;
      const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) return null;
      const userId = createId();
      await tx.user.create({
        data: {
          id: userId,
          creator_id: userId,
          updater_id: userId,
          name: name || email,
          email,
          emailVerified: new Date(),
          password: passwordHash,
        },
      });
      return email;
    });
    if (!created) return invalidToken();
    if (created === "not_allowed") return NextResponse.json(REGISTRATION_NOT_ALLOWED, { status: 403 });

    // The address goes back to the page that holds the link (its owner) so it can
    // sign in with the password just chosen.
    return NextResponse.json({ ok: true, email: created }, { status: 201 });
  } catch (err) {
    // Same rule as the register route: never log the message, which can embed
    // the call arguments (the password hash).
    logger.error("[register:complete] failed", {
      name: err instanceof Error ? err.name : typeof err,
      code: (err as { code?: unknown } | null)?.code,
    });
    return NextResponse.json(
      { error: "Registration failed", code: "REGISTRATION_FAILED" },
      { status: 500 },
    );
  }
}
