"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "@/i18n/navigation";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Alert from "@mui/material/Alert";

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("Auth");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    try {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const response = await signIn("credentials", {
        ...Object.fromEntries(formData),
        redirect: false,
      });

      if (response?.error) {
        setError(t("invalidCredentials"));
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError(t("loginError"));
    }
  }

  return (
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
      <Paper elevation={3} sx={{ p: 4, width: "100%", maxWidth: 400 }}>
        <Typography variant="h5" fontWeight="bold" textAlign="center" mb={3}>
          {t("signInTitle")}
        </Typography>
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
          {error && <Alert severity="error">{error}</Alert>}
          <Button type="submit" variant="contained" fullWidth>
            {t("signInButton")}
          </Button>
        </Box>
        <Typography textAlign="center" mt={2} variant="body2">
          <Link href="/register">{t("noAccount")}</Link>
        </Typography>
      </Paper>
    </Box>
  );
}
