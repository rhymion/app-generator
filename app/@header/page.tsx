"use client";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useSidebar } from "@/components/SidebarContext";
import { siteConfig, themeConfig } from "@/lib/site-config";

export default function HeaderPage() {
  const { data: session } = useSession();
  const { isOpen, toggle } = useSidebar();

  return (
    <header className={`sticky top-0 z-50 flex items-center gap-3 px-4 py-3 ${themeConfig.header.bar}`}>
      {/* Hamburger – visible on mobile only when logged in (sidebar is auth-gated) */}
      {session && (
        <button
          onClick={toggle}
          aria-label={isOpen ? "Close menu" : "Open menu"}
          aria-expanded={isOpen}
          aria-controls="sidebar-nav"
          className={`md:hidden shrink-0 ${themeConfig.header.menuButton}`}
        >
          {isOpen ? (
            /* X icon */
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            /* Hamburger icon */
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      )}

      {/* Title */}
      <h1 className={`flex-1 min-w-0 truncate text-xl sm:text-2xl md:text-3xl ${themeConfig.header.title}`}>
        {siteConfig.title}
      </h1>

      {/* Auth */}
      <div className="flex items-center gap-3 shrink-0">
        {session?.user ? (
          <>
            <span className="hidden sm:block text-sm opacity-75 truncate max-w-40">
              {session.user.name ?? session.user.email}
            </span>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className={themeConfig.header.authButton}
            >
              Sign Out
            </button>
          </>
        ) : (
          <Link href="/login" className={`no-underline ${themeConfig.header.authButton}`}>
            Sign In
          </Link>
        )}
      </div>
    </header>
  );
}
