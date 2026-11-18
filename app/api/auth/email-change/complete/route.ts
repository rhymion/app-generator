import { logger } from '@/lib/logger';
import { NextResponse } from "next/server";
import { getRateLimiter } from "@/lib/rate-limit";
import { clientIp } from "@/lib/rate-limit/client-ip";
import { siteConfig } from "@/lib/site-config";
import { registrationLocale } from "@/lib/auth/registration-mail";
import { resolveExternalUrl } from "@/lib/auth/external-url";
import { completeEmailChange } from "@/lib/auth/email-change";

// Email change, step 2 (Issue #1400): { token, locale? } from the page the emailed link opens.
// The single-use token is the credential: it names the account and the new address, and holding
// it proves control of that address. 200 stores the new address (marked verified) and notifies the
// previous one. An unknown, expired or used token, or an erased account, answers 400
// INVALID_TOKEN; an address another account took after the link was sent answers 409 EMAIL_TAKEN;
// an address whose domain left the registration allow-list since the link was sent answers 403
// EMAIL_NOT_ALLOWED (Issue #1402).
// The route does not exist (404) while email verification is off.
//
// See docs/knowledge/authentication.md "Changing the email address".

function invalidToken() {
  return NextResponse.json({ error: "Invalid or expired link", code: "INVALID_TOKEN" }, { status: 400 });
}

function emailNotAllowed() {
  return NextResponse.json({ error: "This email address cannot be used.", code: "EMAIL_NOT_ALLOWED" }, { status: 403 });
}

function emailTaken() {
  return NextResponse.json({ error: "The address is already in use", code: "EMAIL_TAKEN" }, { status: 409 });
}

export async function POST(request: Request) {
  if (!siteConfig.auth.registration?.emailVerification) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    // Same per-IP budget as the sign-up completion step.
    const decision = await getRateLimiter().check("auth:register:complete", clientIp(request.headers));
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: decision.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
      );
    }

    const body = ((await request.json().catch(() => null)) ?? {}) as { token?: unknown; locale?: unknown };
    const token = typeof body.token === "string" ? body.token : "";
    if (!token) return invalidToken();

    const { protocol, host } = resolveExternalUrl({
      forwardedHost: request.headers.get("x-forwarded-host"),
      forwardedProto: request.headers.get("x-forwarded-proto"),
      hostHeader: request.headers.get("host"),
      nextUrl: new URL(request.url),
    });
    const result = await completeEmailChange(token, registrationLocale(body.locale), `${protocol}://${host}`);
    if (result.ok) return NextResponse.json({ ok: true }, { status: 200 });
    if (result.reason === "taken") return emailTaken();
    if (result.reason === "not_allowed") return emailNotAllowed();
    return invalidToken();
  } catch (err) {
    // Another account took the address between the check and the write.
    if ((err as { code?: unknown } | null)?.code === "P2002") return emailTaken();
    logger.error("[email-change:complete] failed", {
      name: err instanceof Error ? err.name : typeof err,
      code: (err as { code?: unknown } | null)?.code,
    });
    return NextResponse.json({ error: "Email change failed", code: "EMAIL_CHANGE_FAILED" }, { status: 500 });
  }
}
