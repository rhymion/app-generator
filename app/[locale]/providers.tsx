"use client";

import { SessionProvider } from "next-auth/react";
import { SidebarProvider } from "@/components/_standard/SidebarContext";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <SidebarProvider>{children}</SidebarProvider>
    </SessionProvider>
  );
}
