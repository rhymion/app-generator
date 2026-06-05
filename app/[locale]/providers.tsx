"use client";

import { SessionProvider, useSession } from "next-auth/react";
import { SidebarProvider } from "@/components/_standard/SidebarContext";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { AnalyticsProvider, useAnalyticsIdentify } from "@/app/providers/analytics-provider";

const theme = createTheme({
  colorSchemes: {
    dark: true,
  },
  cssVariables: {
    colorSchemeSelector: 'media',
  },
});

function AnalyticsSessionBridge() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const tenantId = session?.user?.tenantId ?? null;
  useAnalyticsIdentify(userId, tenantId);
  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AnalyticsProvider>
        <AnalyticsSessionBridge />
        <ThemeProvider theme={theme}>
          <CssBaseline enableColorScheme />
          <SidebarProvider>{children}</SidebarProvider>
        </ThemeProvider>
      </AnalyticsProvider>
    </SessionProvider>
  );
}
