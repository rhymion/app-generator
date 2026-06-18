/**
 * Site Configuration
 *
 * Edit this file to customize your application.
 * Changes here are reflected throughout the app automatically.
 */

export type NavLink = {
  label: string;
  href: string;
  external?: boolean;
};

/**
 * Authentication providers shown on the /login page. Order is preserved in the
 * UI. The list is the *display* gate; each entry has its own runtime gate:
 *
 *   - 'credentials' — the email/password form (always available code-wise; hide
 *     it here to ship an SSO-only deployment).
 *   - 'google'      — only registers server-side when GOOGLE_CLIENT_ID and
 *     GOOGLE_CLIENT_SECRET are both set. If a provider is listed here but its
 *     env vars are missing, clicking its button will fail at the NextAuth
 *     handler — keep the two in sync.
 *
 * MFA / TOTP are not part of the provider list — they layer on top of whichever
 * provider performs the first-factor authentication.
 */
export type AuthProviderId = 'credentials' | 'google';

// ─── App Identity ────────────────────────────────────────────────────────────

export const siteConfig = {
  /** Title shown in the browser tab and the header bar */
  title: "oshicry",

  /**
   * Authentication providers exposed on the login page. See AuthProviderId
   * above for the runtime gating contract.
   *
   * `allowedDomains` (optional) restricts OAuth sign-in to email addresses
   * whose `@domain` is on the list (case-insensitive). Empty array = allow
   * all. The check only runs for OAuth providers — credentials accounts are
   * created by an admin path, not self-service, so a domain filter there
   * would be defence-in-depth at best.
   */
  auth: {
    providers: ['credentials', 'google'] as AuthProviderId[],
    allowedDomains: [] as string[],
  },

  /** Links listed in the sidebar navigation */
  navLinks: [
    { label: "Home", href: "/", external: false },
      { label: "User", href: "/user" },
    { label: "Role", href: "/role" },
    { label: "Organization", href: "/organization" },
    { label: "Permission", href: "/permission" },
    { label: "Approval Flow", href: "/approval_flow" },
    { label: "Dashboard", href: "/dashboard" },
  ] satisfies NavLink[],
};

// ─── Theme (Tailwind classes) ─────────────────────────────────────────────────
//
// Change the Tailwind class strings below to restyle the app.
// Full class names must be used (no dynamic concatenation) so Tailwind can
// detect them. See https://tailwindcss.com/docs/customizing-colors for colour
// reference.

export const themeConfig = {
  header: {
    /** Outer <header> bar */
    bar: "bg-gradient-to-r from-indigo-900 via-purple-900 to-indigo-800 text-white shadow-lg",
    /** App title text */
    title: "font-bold text-white tracking-tight",
    /** Hamburger / close button */
    menuButton: "hover:bg-white/20 rounded-lg p-1.5 transition-colors",
    /** Sign-in / sign-out button */
    authButton: "bg-white/15 hover:bg-white/25 text-white rounded-lg px-3 py-1.5 text-sm font-medium transition-colors backdrop-blur-sm border border-white/10",
  },
  sidebar: {
    /** Sidebar panel background */
    panel: "bg-slate-50 border-r border-slate-200",
    /** Individual nav link */
    link: "text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 block px-4 py-2.5 no-underline transition-colors rounded-lg mx-2 font-medium text-sm",
    /** Overlay backdrop (mobile) */
    backdrop: "bg-black/50 backdrop-blur-sm",
  },
  footer: {
    bar: "bg-slate-900 text-slate-400 border-t border-slate-800",
  },
  content: {
    /** Main content area background */
    background: "bg-slate-100",
  },
};
