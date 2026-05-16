"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "@/i18n/navigation";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Alert from "@mui/material/Alert";
import { siteConfig } from "@/lib/site-config";

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
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
      <Paper elevation={3} sx={{ p: 4, width: "100%", maxWidth: 400 }}>
        <Typography variant="h5" fontWeight="bold" textAlign="center" mb={3}>
          {t("signInTitle")}
        </Typography>

        {showGoogle && (
          <Box display="flex" flexDirection="column" gap={2} mb={showCredentials ? 2 : 0}>
            <Button
              type="button"
              variant="outlined"
              fullWidth
              onClick={handleGoogle}
              aria-label={t("signInWithGoogle")}
            >
              {t("signInWithGoogle")}
            </Button>
          </Box>
        )}

        {showGoogle && showCredentials && (
          <Divider sx={{ my: 2 }}>
            <Typography variant="caption" color="text.secondary">
              {t("orDivider")}
            </Typography>
          </Divider>
        )}

        {showCredentials && (
          <Box component="form" onSubmit={handleSubmit} display="flex" flexDirection="column" gap={2}>
            <TextField
              id="email"
              name="email"
              type="email"
              label={t("emailPlaceholder")}
              required
              fullWidth
            />
            <TextField
              id="password"
              name="password"
              type="password"
              label={t("passwordPlaceholder")}
              slotProps={{
                htmlInput: {
                  "data-testid": "password",
                },
              }}
              required
              fullWidth
            />
            {mfaPrompt && (
              <TextField
                id="mfa_code"
                name="mfa_code"
                type="text"
                label={t("mfaCodeLabel")}
                inputMode="numeric"
                autoComplete="one-time-code"
                slotProps={{
                  htmlInput: {
                    "data-testid": "mfa_code",
                  },
                }}
                helperText={t("mfaHelper")}
                required
                fullWidth
                autoFocus
              />
            )}
            {error && <Alert severity={mfaPrompt ? "info" : "error"}>{error}</Alert>}
            <Button type="submit" variant="contained" fullWidth>
              {t("signInButton")}
            </Button>
          </Box>
        )}

        {showCredentials && (
          <Typography textAlign="center" mt={2} variant="body2">
            <Link href="/register">{t("noAccount")}</Link>
          </Typography>
        )}
      </Paper>
    </Box>
  );
}
