"use client";
import { useSession, signOut } from "next-auth/react";
import { useSidebar } from "@/components/_standard/SidebarContext";
import { siteConfig, themeConfig } from "@/lib/site-config";
import { useTranslations, useLocale } from "next-intl";
import { Link, useRouter, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
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
        <Autocomplete
          size="small"
          disableClearable
          options={routing.locales as readonly string[]}
          getOptionLabel={getLocaleLabel}
          value={locale}
          onChange={(_, next) => { if (next && next !== locale) switchLocale(next); }}
          isOptionEqualToValue={(opt, val) => opt === val}
          sx={{
            minWidth: 140,
            "& .MuiOutlinedInput-root": {
              color: "white",
              backgroundColor: "rgba(255,255,255,0.1)",
              "& fieldset": { borderColor: "rgba(255,255,255,0.3)" },
              "&:hover fieldset": { borderColor: "rgba(255,255,255,0.5)" },
              "&.Mui-focused fieldset": { borderColor: "rgba(255,255,255,0.7)" },
            },
            "& .MuiSvgIcon-root": { color: "white" },
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              variant="outlined"
              aria-label={t("language")}
            />
          )}
        />
      </div>

      {/* Auth */}
      <div className="flex items-center gap-3 shrink-0">
        {session?.user ? (
          <>
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
