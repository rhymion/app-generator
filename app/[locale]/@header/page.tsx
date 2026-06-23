"use client";
import { useSession, signOut } from "next-auth/react";
import { useSidebar } from "@/components/_standard/SidebarContext";
import { siteConfig, themeConfig } from "@/lib/site-config";
import { useTranslations, useLocale } from "next-intl";
import { Link, useRouter, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { AppAutocomplete } from "@/components/ui";
import NotificationBell from "@/components/_standard/NotificationBell";

// Endonym (the language's own name) for any BCP-47 tag — adding a new locale
// to routing.locales is the only change needed to expose it in the picker.
function getLocaleLabel(loc: string): string {
  try {
    const name = new Intl.DisplayNames([loc], { type: "language" }).of(loc);
    if (!name) return loc.toUpperCase();
    return name.charAt(0).toLocaleUpperCase(loc) + name.slice(1);
  } catch {
    return loc.toUpperCase();
  }
}

export default function HeaderPage() {
  const { data: session } = useSession();
  const { isOpen, toggle } = useSidebar();
  const t = useTranslations("Header");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function switchLocale(next: string) {
    router.replace(pathname, { locale: next });
  }

  return (
    <header className={`sticky top-0 z-50 flex items-center gap-3 px-4 py-3 ${themeConfig.header.bar}`}>
      {/* Hamburger – visible on mobile only when logged in */}
      {session && (
        <button
          onClick={toggle}
          aria-label={isOpen ? t("closeMenu") : t("openMenu")}
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

      {/* Locale switcher */}
      <div className="shrink-0">
        <AppAutocomplete
          size="small"
          disableClearable
          options={routing.locales}
          getOptionLabel={getLocaleLabel}
          value={locale}
          onChange={(next) => { if (next !== locale) switchLocale(next); }}
          isOptionEqualToValue={(opt, val) => opt === val}
          inputAriaLabel={t("language")}
          variant="headerLocale"
        />
      </div>

      {/* Auth */}
      <div className="flex items-center gap-3 shrink-0">
        {session?.user ? (
          <>
            {/* Search – routes to the cross-entity search page */}
            <Link
              href="/search"
              aria-label={t("searchAriaLabel")}
              title={t("search")}
              className={`shrink-0 inline-flex items-center ${themeConfig.header.menuButton}`}
            >
              {/* Magnifying glass icon */}
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m1.35-5.4a6.75 6.75 0 11-13.5 0 6.75 6.75 0 0113.5 0z" />
              </svg>
            </Link>
            <NotificationBell />
            <Link href={`/setting/view/${session.user.id}`} className={`flex items-center gap-2 no-underline`}>
              <span className="hidden sm:block text-sm opacity-75 truncate max-w-40">
                {session.user.name ?? session.user.email}
              </span>
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: `/${locale}/login` })}
              className={themeConfig.header.authButton}
            >
              {t("signOut")}
            </button>
          </>
        ) : (
          <Link href="/login" className={`no-underline ${themeConfig.header.authButton}`}>
            {t("signIn")}
          </Link>
        )}
      </div>
    </header>
  );
}
