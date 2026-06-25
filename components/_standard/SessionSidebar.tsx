"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import Sidebar from "../../app/[locale]/@sidebar/page";
import { useSidebar } from "./SidebarContext";
import { themeConfig } from "@/lib/site-config";

export default function SessionSidebar({ hiddenHrefs = [] }: { hiddenHrefs?: string[] }) {
  const { data: session } = useSession();
  const { isOpen, close } = useSidebar();
  const pathname = usePathname();

  // Close the mobile drawer whenever the user navigates
  useEffect(() => {
    close();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session) return null;

  return (
    <>
      {/* Desktop sidebar – always visible on md+ */}
      <div className="hidden md:flex flex-none">
        <Sidebar hiddenHrefs={hiddenHrefs} />
      </div>

      {/* Mobile drawer – shown when isOpen */}
      {isOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          {/* Drawer panel — height is viewport minus the mt-14 header offset so the
              full nav list (including the bottom Sign Out) can be scrolled into view.
              Using plain h-full would make the panel 100vh tall *plus* the mt-14
              offset, pushing its bottom 3.5rem below the viewport where overflow-y-auto
              can never reach it (latent until the nav list is long enough to scroll). */}
          <div className={`flex-none w-64 h-[calc(100%-3.5rem)] overflow-y-auto shadow-xl mt-14 ${themeConfig.sidebar.panel}`}>
            <Sidebar hiddenHrefs={hiddenHrefs} />
          </div>
          {/* Backdrop – click to close */}
          <div
            className={`flex-1 ${themeConfig.sidebar.backdrop}`}
            onClick={close}
            aria-hidden="true"
          />
        </div>
      )}
    </>
  );
}
