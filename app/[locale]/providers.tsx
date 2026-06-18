"use client";

import { SessionProvider } from "next-auth/react";
import { SidebarProvider } from "@/components/_standard/SidebarContext";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";

// background.default / background.paper read the CSS tokens defined in
// app/globals.css (--background / --surface), which switch on
// prefers-color-scheme. This keeps MUI surfaces (Paper, DataGrid, cards,
// list/table wrappers) in sync with the Tailwind-driven chrome and main area.
const theme = createTheme({
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
});

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        <SidebarProvider>{children}</SidebarProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
