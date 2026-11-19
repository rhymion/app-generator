"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import AppBox from "@/components/ui/AppBox";
import AppButton from "@/components/ui/AppButton";
import AppText from "@/components/ui/AppText";
import AppSurface from "@/components/ui/AppSurface";
import AppAlert from "@/components/ui/AppAlert";

/**
 * Confirms an email change (POST /api/auth/email-change/complete). Opening the link changes
 * nothing by itself: the change needs the button, so a mail scanner that fetches the link does not
 * use it up.
 */
export default function ConfirmEmailForm() {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [token] = useState(() => searchParams.get("token") ?? "");
  const [linkInvalid, setLinkInvalid] = useState(token === "");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the token out of the address bar and the browser history once read.
  useEffect(() => {
    if (token && typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [token]);

  async function handleConfirm() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/email-change/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, locale }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDone(true);
      } else if (data.code === "INVALID_TOKEN") {
        setLinkInvalid(true);
      } else if (data.code === "EMAIL_TAKEN") {
        setError(t("confirmEmailTaken"));
      } else if (data.code === "EMAIL_NOT_ALLOWED") {
        setError(t("confirmEmailNotAllowed"));
      } else {
        setError(t("confirmEmailFailed"));
      }
    } catch {
      setError(t("confirmEmailFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppBox display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
      <AppSurface elevation={3} p={4} width="100%" maxWidth={400}>
        <AppText variant="h5" fontWeight="bold" textAlign="center" mb={3}>
          {t("confirmEmailTitle")}
        </AppText>
        {done ? (
          <AppBox display="flex" flexDirection="column" gap={2}>
            <AppAlert severity="success">{t("confirmEmailDone")}</AppAlert>
            <AppText textAlign="center" variant="body2">
              <Link href="/login">{t("backToSignIn")}</Link>
            </AppText>
          </AppBox>
        ) : linkInvalid ? (
          <AppAlert severity="error">{t("confirmEmailLinkInvalid")}</AppAlert>
        ) : (
          <AppBox display="flex" flexDirection="column" gap={2}>
            <AppText variant="body2" color="text.secondary">{t("confirmEmailHelper")}</AppText>
            {error && <AppAlert severity="error">{error}</AppAlert>}
            <AppButton type="button" variant="contained" fullWidth disabled={busy} onClick={handleConfirm}>
              {t("confirmEmailButton")}
            </AppButton>
          </AppBox>
        )}
      </AppSurface>
    </AppBox>
  );
}
