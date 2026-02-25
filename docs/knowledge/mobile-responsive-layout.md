# Mobile-Responsive Layout

## Overview

The app shell (header, sidebar, footer) is designed to work on both desktop and mobile screens. On mobile the sidebar is hidden by default and opens as a full-screen drawer when the user taps the hamburger button in the header.

---

## File Structure

```
lib/site-config.ts              ← single config file (title, nav links, theme)
components/SidebarContext.tsx   ← React context: isOpen / open / close / toggle
components/SessionSidebar.tsx   ← renders desktop panel OR mobile drawer
app/providers.tsx               ← SessionProvider + SidebarProvider
app/layout.tsx                  ← responsive shell (min-h-screen flex flex-col)
app/@header/page.tsx            ← sticky header with hamburger button
app/@sidebar/page.tsx           ← nav link list (server component)
app/@footer/page.tsx            ← footer bar
app/globals.css                 ← base colour tokens only
```

---

## Customisation

Everything a user would normally want to change lives in **`lib/site-config.ts`**.

### App title and nav links (`siteConfig`)

```ts
export const siteConfig = {
  title: "My App Name",
  navLinks: [
    { label: "Home", href: "/" },
    { label: "Settings", href: "/settings" },
    { label: "Docs", href: "https://example.com", external: true },
  ],
};
```

### Colours and visual style (`themeConfig`)

All values are plain Tailwind class strings. Changing a value here updates every component that references it.

```ts
export const themeConfig = {
  header: {
    bar:        "bg-blue-900 text-white",   // header background + text
    title:      "font-bold text-white",
    menuButton: "hover:bg-white/20 rounded p-1 transition",
    authButton: "bg-white/20 hover:bg-white/30 text-white rounded px-3 py-1.5 text-sm font-medium transition",
  },
  sidebar: {
    panel:    "bg-gray-100",
    link:     "text-gray-700 hover:bg-gray-200 block px-4 py-2 no-underline transition",
    backdrop: "bg-black/40",    // mobile overlay colour
  },
  footer: {
    bar: "bg-gray-900 text-white",
  },
};
```

---

## Mobile Drawer Behaviour

### State management

`SidebarContext` (a React context) holds `isOpen` and provides `open`, `close`, and `toggle` helpers. It is provided by `SidebarProvider` inside `app/providers.tsx`, so both the header and the sidebar wrapper can read the same state.

### Header (hamburger button)

- Rendered only when the user is logged in (sidebar is auth-gated).
- Hidden on `md+` screens via `md:hidden`.
- Shows a ☰ icon when closed, ✕ when open.

### SessionSidebar

Renders two independent UI regions:

| Region | Visibility | Behaviour |
|---|---|---|
| Desktop panel | `hidden md:flex` | Always shown when logged in |
| Mobile drawer | `md:hidden`, conditional on `isOpen` | Full-screen overlay with sidebar panel + backdrop |

Clicking the backdrop (`flex-1` div) calls `close()`. Navigating to a new route also calls `close()` via a `useEffect` on `usePathname()`.

### Z-index layers

| Layer | z-index | Notes |
|---|---|---|
| Header | `z-50` (sticky) | Always on top |
| Mobile drawer | `z-40` (fixed) | Below header; above page content |

---

## Responsive Breakpoint

The switch between mobile and desktop layout happens at **`md` (768 px)**. To change this, replace every `md:` prefix in `SessionSidebar.tsx` and the hamburger button in `@header/page.tsx` with `lg:` (1024 px) or any other breakpoint.

---

## Dark Mode

Base body colours (`--background`, `--foreground`) in `app/globals.css` respond to `prefers-color-scheme: dark`. Component-level colours (header, sidebar, footer) are set via `themeConfig` and do not automatically invert — override them manually for a dark theme variant if needed.
