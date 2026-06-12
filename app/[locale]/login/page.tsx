"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "@/i18n/navigation";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { siteConfig } from "@/lib/site-config";
import AppBox from "@/components/ui/AppBox";
import AppButton from "@/components/ui/AppButton";
import AppDivider from "@/components/ui/AppDivider";
import AppFieldInput from "@/components/ui/forms/AppFieldInput";
import AppText from "@/components/ui/AppText";
import AppSurface from "@/components/ui/AppSurface";
import AppAlert from "@/components/ui/AppAlert";

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("Auth");
  const [error, setError] = useState<string | null>(null);
  // When `authorize()` throws the sentinel "MFA_REQUIRED" we re-render the
  // form with an extra TOTP field rather than showing a generic error —
  // the user resubmits everything (email + password + mfa_code) and the
  // server gates the second submission on the code.
  const [mfaPrompt, setMfaPrompt] = useState(false);

  const enabledProviders = siteConfig.auth?.providers ?? ["credentials"];
  const showCredentials = enabledProviders.includes("credentials");
  const showGoogle = enabledProviders.includes("google");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    try {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const response = await signIn("credentials", {
        ...Object.fromEntries(formData),
        redirect: false,
      });

      if (response?.error) {
        // Auth.js v5 surfaces the message thrown from `authorize()` via the
        // `code` field on CredentialsSignin errors (with `error` set to the
        // generic 'CredentialsSignin' string), depending on version. We
        // accept either path so this works against both shapes.
        const message =
          (response as { code?: string }).code ?? response.error ?? "";
        if (message.includes("MFA_REQUIRED")) {
          setMfaPrompt(true);
          setError(t("mfaRequired"));
          return;
        }
        if (message.includes("Invalid MFA code")) {
          setMfaPrompt(true);
          setError(t("mfaInvalid"));
          return;
        }
        setError(t("invalidCredentials"));
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError(t("loginError"));
    }
  }

  function handleGoogle() {
    // Let NextAuth handle the redirect — on success it lands on `/` per the
    // callbackUrl, on failure it lands back here with ?error=...
    void signIn("google", { callbackUrl: "/" });
  }

  return (
    <AppBox display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
      <AppSurface elevation={3} p={4} width="100%" maxWidth={400}>
        <AppText variant="h5" fontWeight="bold" textAlign="center" mb={3}>
          {t("signInTitle")}
        </AppText>

        {showGoogle && (
          <AppBox display="flex" flexDirection="column" gap={2} mb={showCredentials ? 2 : 0}>
            <AppButton
              type="button"
              variant="outlined"
              fullWidth
              onClick={handleGoogle}
              aria-label={t("signInWithGoogle")}
            >
              {t("signInWithGoogle")}
            </AppButton>
          </AppBox>
        )}

        {showGoogle && showCredentials && (
          <AppDivider my={2}>
            <AppText variant="caption" color="text.secondary">
              {t("orDivider")}
            </AppText>
          </AppDivider>
        )}

        {showCredentials && (
          <AppBox component="form" onSubmit={handleSubmit} display="flex" flexDirection="column" gap={2}>
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
            {mfaPrompt && (
              <AppFieldInput
                id="mfa_code"
                name="mfa_code"
                type="text"
                label={t("mfaCodeLabel")}
                inputMode="numeric"
                autoComplete="one-time-code"
                testId="mfa_code"
                helperText={t("mfaHelper")}
                required
                fullWidth
                autoFocus
              />
            )}
            {error && <AppAlert severity={mfaPrompt ? "info" : "error"}>{error}</AppAlert>}
            <AppButton type="submit" variant="contained" fullWidth>
              {t("signInButton")}
            </AppButton>
          </AppBox>
        )}

        {showCredentials && (
          <AppText textAlign="center" mt={2} variant="body2">
            <Link href="/register">{t("noAccount")}</Link>
          </AppText>
        )}
      </AppSurface>
    </AppBox>
  );
}
