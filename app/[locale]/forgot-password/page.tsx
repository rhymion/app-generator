"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { siteConfig } from "@/lib/site-config";
import AppBox from "@/components/ui/AppBox";
import AppButton from "@/components/ui/AppButton";
import AppFieldInput from "@/components/ui/forms/AppFieldInput";
import AppText from "@/components/ui/AppText";
import AppSurface from "@/components/ui/AppSurface";
import AppAlert from "@/components/ui/AppAlert";

// Password reset, step 1 (Issue #1282): asks for the address and then says to check the
// inbox, whatever the address. Only offered with email verification on
// (siteConfig.auth.registration.emailVerification); otherwise the API answers 404 and this
// page only links back to sign-in.
export default function ForgotPasswordPage() {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const enabled = Boolean(siteConfig.auth.registration?.emailVerification);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      const res = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formData.get("email"), locale }),
      });
      if (!res.ok) {
        setError(t("forgotPasswordFailed"));
        return;
      }
      setSent(true);
    } catch {
      setError(t("forgotPasswordFailed"));
    }
  }

  return (
    <AppBox display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
      <AppSurface elevation={3} p={4} width="100%" maxWidth={400}>
        <AppText variant="h5" fontWeight="bold" textAlign="center" mb={3}>
          {t("forgotPasswordTitle")}
        </AppText>
        {!enabled ? null : sent ? (
          <AppAlert severity="success">{t("forgotPasswordCheckEmailBody")}</AppAlert>
        ) : (
          <AppBox component="form" onSubmit={handleSubmit} display="flex" flexDirection="column" gap={2}>
            <AppText variant="body2" color="text.secondary">{t("forgotPasswordNotice")}</AppText>
            <AppFieldInput id="email" name="email" type="email" label={t("emailPlaceholder")} required fullWidth />
            {error && <AppAlert severity="error">{error}</AppAlert>}
            <AppButton type="submit" variant="contained" fullWidth>
              {t("forgotPasswordSend")}
            </AppButton>
          </AppBox>
        )}
        <AppText textAlign="center" variant="body2" mt={2}>
          <Link href="/login">{t("backToSignIn")}</Link>
        </AppText>
      </AppSurface>
    </AppBox>
  );
}
