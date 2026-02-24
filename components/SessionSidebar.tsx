"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import Sidebar from "../app/@sidebar/page";
import { useSidebar } from "./SidebarContext";
import { themeConfig } from "@/lib/site-config";

export default function SessionSidebar() {
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
        <Sidebar />
      </div>

      {/* Mobile drawer – shown when isOpen */}
      {isOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          {/* Drawer panel */}
          <div className={`flex-none w-64 h-full overflow-y-auto shadow-xl mt-14 ${themeConfig.sidebar.panel}`}>
            <Sidebar />
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
