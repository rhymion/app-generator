"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import AppBox from "@/components/ui/AppBox";
import AppButton from "@/components/ui/AppButton";
import AppFieldInput from "@/components/ui/forms/AppFieldInput";
import AppText from "@/components/ui/AppText";
import AppSurface from "@/components/ui/AppSurface";
import AppAlert from "@/components/ui/AppAlert";

/**
 * New password for the account the emailed link was sent to
 * (POST /api/auth/password-reset/complete). When the account uses MFA the server answers
 * MFA_REQUIRED and the form asks for a TOTP or recovery code before trying again.
 */
export default function ResetPasswordForm() {
  const t = useTranslations("Auth");
  const searchParams = useSearchParams();
  const [token] = useState(() => searchParams.get("token") ?? "");
  const [linkInvalid, setLinkInvalid] = useState(token === "");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the token out of the address bar and the browser history once read.
  useEffect(() => {
    if (token && typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [token]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      const password = formData.get("password");
      if (password !== formData.get("confirm_password")) {
        setError(t("passwordMismatch"));
        return;
      }
      const mfaCode = formData.get("mfa_code");
      const res = await fetch("/api/auth/password-reset/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, ...(mfaCode ? { mfaCode } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDone(true);
        return;
      }
      if (data.code === "INVALID_TOKEN") {
        setLinkInvalid(true);
      } else if (data.code === "MFA_REQUIRED") {
        setNeedsMfa(true);
      } else if (data.code === "INVALID_MFA_CODE") {
        setNeedsMfa(true);
        setError(t("mfaInvalid"));
      } else if (data.code === "MFA_RATE_LIMITED") {
        setError(t("mfaRateLimited"));
      } else {
        setError(data.code === "WEAK_PASSWORD" && data.error ? data.error : t("resetPasswordFailed"));
      }
    } catch {
      setError(t("resetPasswordFailed"));
    }
  }

  return (
    <AppBox display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
      <AppSurface elevation={3} p={4} width="100%" maxWidth={400}>
        <AppText variant="h5" fontWeight="bold" textAlign="center" mb={3}>
          {t("resetPasswordTitle")}
        </AppText>
        {done ? (
          <AppBox display="flex" flexDirection="column" gap={2}>
            <AppAlert severity="success">{t("resetPasswordDone")}</AppAlert>
            <AppText textAlign="center" variant="body2">
              <Link href="/login">{t("backToSignIn")}</Link>
            </AppText>
          </AppBox>
        ) : linkInvalid ? (
          <AppBox display="flex" flexDirection="column" gap={2}>
            <AppAlert severity="error">{t("resetPasswordLinkInvalid")}</AppAlert>
            <AppText textAlign="center" variant="body2">
              <Link href="/forgot-password">{t("resetPasswordStartAgain")}</Link>
            </AppText>
          </AppBox>
        ) : (
          <AppBox component="form" onSubmit={handleSubmit} display="flex" flexDirection="column" gap={2}>
            <AppFieldInput id="password" name="password" type="password" label={t("passwordPlaceholder")} testId="password" required fullWidth />
            <AppFieldInput
              id="confirm_password"
              name="confirm_password"
              type="password"
              label={t("confirmPasswordPlaceholder")}
              testId="confirm-password"
              required
              fullWidth
            />
            {needsMfa && (
              <>
                <AppText variant="body2" color="text.secondary">{t("resetPasswordMfaHelper")}</AppText>
                <AppFieldInput id="mfa_code" name="mfa_code" type="text" label={t("mfaCodeLabel")} testId="mfa-code" required fullWidth />
              </>
            )}
            {error && <AppAlert severity="error">{error}</AppAlert>}
            <AppButton type="submit" variant="contained" fullWidth>
              {t("resetPasswordButton")}
            </AppButton>
          </AppBox>
        )}
      </AppSurface>
    </AppBox>
  );
}
