"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter, Link } from "@/i18n/navigation";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import AppBox from "@/components/ui/AppBox";
import AppButton from "@/components/ui/AppButton";
import AppFieldInput from "@/components/ui/forms/AppFieldInput";
import AppText from "@/components/ui/AppText";
import AppSurface from "@/components/ui/AppSurface";
import AppAlert from "@/components/ui/AppAlert";

/**
 * Name and password for a sign-up whose address the emailed link proved
 * (POST /api/auth/register/complete). On success the new user is signed in.
 */
export default function RegisterCompleteForm() {
  const router = useRouter();
  const t = useTranslations("Auth");
  const searchParams = useSearchParams();
  const [token] = useState(() => searchParams.get("token") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(token === "");

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
      const res = await fetch("/api/auth/register/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: formData.get("name"), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "INVALID_TOKEN") {
          setLinkInvalid(true);
          return;
        }
        setError(data.code === "WEAK_PASSWORD" && data.error ? data.error : t("registrationFailed"));
        return;
      }
      const signInResult = await signIn("credentials", { email: data.email, password, redirect: false });
      if (signInResult?.error) {
        router.push("/login");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError(t("registrationFailed"));
    }
  }

  return (
    <AppBox display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
      <AppSurface elevation={3} p={4} width="100%" maxWidth={400}>
        <AppText variant="h5" fontWeight="bold" textAlign="center" mb={3}>
          {t("registerCompleteTitle")}
        </AppText>
        {linkInvalid ? (
          <AppBox display="flex" flexDirection="column" gap={2}>
            <AppAlert severity="error">{t("registerLinkInvalid")}</AppAlert>
            <AppText textAlign="center" variant="body2">
              <Link href="/register">{t("registerStartAgain")}</Link>
            </AppText>
          </AppBox>
        ) : (
          <AppBox component="form" onSubmit={handleSubmit} display="flex" flexDirection="column" gap={2}>
            <AppFieldInput id="name" name="name" type="text" label={t("namePlaceholder")} required fullWidth />
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
            <AppText variant="body2" textAlign="center" color="text.secondary">
              {t.rich("legalAgreementNotice", {
                terms: (chunks) => <Link href="/legal/terms">{chunks}</Link>,
                privacy: (chunks) => <Link href="/legal/privacy">{chunks}</Link>,
              })}
            </AppText>
            <AppButton type="submit" variant="contained" fullWidth>
              {t("registerCompleteButton")}
            </AppButton>
          </AppBox>
        )}
      </AppSurface>
    </AppBox>
  );
}
