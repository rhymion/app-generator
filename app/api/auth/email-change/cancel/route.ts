import { logger } from '@/lib/logger';
import { NextResponse } from "next/server";
import { getRateLimiter } from "@/lib/rate-limit";
import { clientIp } from "@/lib/rate-limit/client-ip";
import { siteConfig } from "@/lib/site-config";
import { cancelPendingEmailChange } from "@/lib/auth/email-change";

// Cancels a pending email change: { token } from the page the link in the notice to the current
// address opens. The single-use cancel token is the credential: it names the account, and holding
// it proves control of the current address. 200 removes the pending change link, so the new
// address can no longer be confirmed. An unknown, expired or used token, a change that was already
// completed or replaced, or an erased account answers 400 INVALID_TOKEN. The route does not exist
// (404) while email verification is off.
//
// See docs/knowledge/authentication.md "Changing the email address".

function invalidToken() {
  return NextResponse.json({ error: "Invalid or expired link", code: "INVALID_TOKEN" }, { status: 400 });
}

export async function POST(request: Request) {
  if (!siteConfig.auth.registration?.emailVerification) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    // Same per-IP budget as the other emailed-link steps.
    const decision = await getRateLimiter().check("auth:register:complete", clientIp(request.headers));
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfter: decision.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
      );
    }

    const body = ((await request.json().catch(() => null)) ?? {}) as { token?: unknown };
    const token = typeof body.token === "string" ? body.token : "";
    if (!token) return invalidToken();

    const result = await cancelPendingEmailChange(token);
    return result.ok ? NextResponse.json({ ok: true }, { status: 200 }) : invalidToken();
  } catch (err) {
    logger.error("[email-change:cancel] failed", {
      name: err instanceof Error ? err.name : typeof err,
      code: (err as { code?: unknown } | null)?.code,
    });
    return NextResponse.json({ error: "Cancelling the email change failed", code: "EMAIL_CHANGE_CANCEL_FAILED" }, { status: 500 });
  }
}
