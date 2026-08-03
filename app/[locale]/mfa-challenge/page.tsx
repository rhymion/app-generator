"use client";

import { useSession } from "next-auth/react";
// Plain next/navigation router, not next-intl's `@/i18n/navigation` one:
// `callbackUrl` (from the query string, set by proxy.ts) is already a full
// locale-prefixed path (e.g. "/en/user"). next-intl's router auto-prepends
// the current locale to whatever it's given, which would double it up into
// "/en/en/user" — confirmed by an earlier failing run of this page's tests.
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import AppBox from "@/components/ui/AppBox";
import AppButton from "@/components/ui/AppButton";
import AppFieldInput from "@/components/ui/forms/AppFieldInput";
import AppText from "@/components/ui/AppText";
import AppSurface from "@/components/ui/AppSurface";
import AppAlert from "@/components/ui/AppAlert";
import { completeMfaChallenge } from "./actions";

/**
 * Second-factor challenge shown after a first factor succeeds (Google
 * OAuth, or an existing session whose owner just enabled MFA) but the
 * session is still `mfa_pending` (cmd_527). proxy.ts redirects every
 * protected route here until the flag clears — this page must stay
 * reachable itself (see proxy.ts's `isMfaChallengePath` exemption) or the
 * user gets stuck in a redirect loop.
 *
 * A Sign Out link is always rendered in the app header (it doesn't depend
 * on `mfa_pending`), so a user who can't complete the challenge (lost
 * device, no recovery codes left) isn't locked out of the app entirely —
 * they can sign out and contact an admin.
 */
function safeCallbackPath(raw: string | null): string {
  // Guard against open-redirect: only accept a same-origin absolute path.
  // A protocol-relative URL ("//evil.com") parses as "no host" by
  // `startsWith('/')` alone, so explicitly reject a second leading slash.
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export default function MfaChallengePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const t = useTranslations("Auth");

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const callbackUrl = safeCallbackPath(searchParams.get("callbackUrl"));

  useEffect(() => {
    // Nothing left to verify — either the challenge was already completed
    // in another tab, or the user landed here directly without a pending
    // session. Send them on to their destination instead of showing a form
    // with nothing to submit.
    if (status === "authenticated" && !session?.mfa_pending) {
      router.replace(callbackUrl);
    }
  }, [status, session?.mfa_pending, callbackUrl, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await completeMfaChallenge(code);
      if (!result.ok) {
        setError(result.error === "SESSION_REQUIRED" ? t("loginError") : t("mfaInvalid"));
        setSubmitting(false);
        return;
      }
      // Full page navigation rather than the client-side router: leaving
      // this page is a security-relevant transition (the session goes from
      // "first factor only" to "fully verified"), so force a fresh
      // server-side session read on the destination page instead of relying
      // on an in-flight client transition to pick up the just-mutated JWT.
      // A `router.push()` + `unstable_update()` combination was tried first
      // and intermittently left the URL on /mfa-challenge despite the
      // destination RSC payload having already been fetched — a client-side
      // router transition race, not an auth bug. `window.location` sidesteps
      // it entirely with a real navigation.
      window.location.href = callbackUrl;
    } catch {
      setError(t("loginError"));
      setSubmitting(false);
    }
  }

  if (status !== "authenticated" || !session?.mfa_pending) {
    return null;
  }

  return (
    <AppBox display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
      <AppSurface elevation={3} p={4} width="100%" maxWidth={400}>
        <AppText variant="h5" fontWeight="bold" textAlign="center" mb={1}>
          {t("mfaChallengeTitle")}
        </AppText>
        <AppText variant="body2" color="text.secondary" textAlign="center" mb={3}>
          {t("mfaHelper")}
        </AppText>

        <AppBox component="form" onSubmit={handleSubmit} display="flex" flexDirection="column" gap={2}>
          <AppFieldInput
            id="mfa_code"
            name="mfa_code"
            type="text"
            label={t("mfaCodeLabel")}
            inputMode="numeric"
            autoComplete="one-time-code"
            testId="mfa_code"
            value={code}
            onChange={setCode}
            required
            fullWidth
            autoFocus
          />
          {error && <AppAlert severity="error">{error}</AppAlert>}
          <AppButton type="submit" variant="contained" fullWidth disabled={submitting}>
            {t("signInButton")}
          </AppButton>
        </AppBox>
      </AppSurface>
    </AppBox>
  );
}
