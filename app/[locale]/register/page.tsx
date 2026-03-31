"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Alert from "@mui/material/Alert";

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
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
      <Paper elevation={3} sx={{ p: 4, width: "100%", maxWidth: 400 }}>
        <Typography variant="h5" fontWeight="bold" textAlign="center" mb={3}>
          {t("registerTitle")}
        </Typography>
        <Box component="form" onSubmit={handleSubmit} display="flex" flexDirection="column" gap={2}>
          <TextField
            id="name"
            name="name"
            type="text"
            label={t("namePlaceholder")}
            required
            fullWidth
          />
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
          <TextField
            id="confirm_password"
            name="confirm_password"
            type="password"
            label={t("confirmPasswordPlaceholder")}
            slotProps={{
              htmlInput: {
                "data-testid": "confirm-password",
              },
            }}
            required
            fullWidth
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Button type="submit" variant="contained" fullWidth>
            {t("registerButton")}
          </Button>
        </Box>
        <Typography textAlign="center" mt={2} variant="body2">
          <Link href="/login">{t("haveAccount")}</Link>
        </Typography>
      </Paper>
    </Box>
  );
}
