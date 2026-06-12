"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import AppBox from "@/components/ui/AppBox";
import AppButton from "@/components/ui/AppButton";
import AppFieldInput from "@/components/ui/forms/AppFieldInput";
import AppText from "@/components/ui/AppText";
import AppSurface from "@/components/ui/AppSurface";
import AppAlert from "@/components/ui/AppAlert";

export default function RegisterPage() {
  const router = useRouter();
  const t = useTranslations("Auth");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    try {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      if (formData.get('password') !== formData.get('confirm_password')) {
        setError(t("passwordMismatch"));
        return;
      }
      const registerRes = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          password: formData.get("password"),
        }),
      });

      if (!registerRes.ok) {
        const data = await registerRes.json();
        setError(data.error ?? t("registrationFailed"));
        return;
      }

      const signInResult = await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirect: false,
      });

      if (signInResult?.error) {
        setError(t("registrationFailed"));
        return;
      }

      router.push("/");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : t("registrationFailed"));
    }
  }

  return (
    <AppBox display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
      <AppSurface elevation={3} p={4} width="100%" maxWidth={400}>
        <AppText variant="h5" fontWeight="bold" textAlign="center" mb={3}>
          {t("registerTitle")}
        </AppText>
        <AppBox component="form" onSubmit={handleSubmit} display="flex" flexDirection="column" gap={2}>
          <AppFieldInput
            id="name"
            name="name"
            type="text"
            label={t("namePlaceholder")}
            required
            fullWidth
          />
          <AppFieldInput
            id="email"
            name="email"
            type="email"
            label={t("emailPlaceholder")}
            required
            fullWidth
          />
          <AppFieldInput
            id="password"
            name="password"
            type="password"
            label={t("passwordPlaceholder")}
            testId="password"
            required
            fullWidth
          />
          <AppFieldInput
            id="confirm_password"
            name="confirm_password"
            type="password"
            label={t("confirmPasswordPlaceholder")}
            testId="confirm-password"
            required
            fullWidth
          />
          {error && <AppAlert severity="error">{error}</AppAlert>}
          <AppButton type="submit" variant="contained" fullWidth>
            {t("registerButton")}
          </AppButton>
        </AppBox>
        <AppText textAlign="center" mt={2} variant="body2">
          <Link href="/login">{t("haveAccount")}</Link>
        </AppText>
      </AppSurface>
    </AppBox>
  );
}
