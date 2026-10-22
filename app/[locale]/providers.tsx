"use client";

import { SessionProvider } from "next-auth/react";
import { SidebarProvider } from "@/components/_standard/SidebarContext";
import { useMemo } from "react";
import { useLocale } from "next-intl";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import type { ThemeOptions } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { getDayjsLocale, getMuiLocaleBundles } from "@/lib/mui-locale";

// background.default / background.paper read the CSS tokens defined in
// app/globals.css (--background / --surface), which switch on
// prefers-color-scheme. This keeps MUI surfaces (Paper, DataGrid, cards,
// list/table wrappers) in sync with the Tailwind-driven chrome and main area.
const themeOptions: ThemeOptions = {
  cssVariables: { colorSchemeSelector: 'media' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#6366f1' },
        secondary: { main: '#8b5cf6' },
        background: { default: 'var(--background)', paper: 'var(--surface)' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#6366f1' },
        secondary: { main: '#8b5cf6' },
        background: { default: 'var(--background)', paper: 'var(--surface)' },
      },
    },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Inter", "Noto Sans JP", system-ui, sans-serif',
    h1: { fontWeight: 700 },
    h2: { fontWeight: 700 },
    h3: { fontWeight: 600 },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', borderRadius: 8, fontWeight: 600 },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { borderRadius: 12, boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { borderRadius: 12 },
      },
    },
    MuiTextField: {
      defaultProps: { size: 'small' },
    },
  },
};

export default function Providers({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  // The locale bundles carry DataGrid / picker `localeText`, so every grid and
  // picker below follows the active app locale without per-component props.
  const theme = useMemo(
    () => createTheme(themeOptions, ...getMuiLocaleBundles(locale)),
    [locale],
  );
  return (
    <SessionProvider>
      <ThemeProvider theme={theme}>
        <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={getDayjsLocale(locale)}>
          <CssBaseline enableColorScheme />
          <SidebarProvider>{children}</SidebarProvider>
        </LocalizationProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
