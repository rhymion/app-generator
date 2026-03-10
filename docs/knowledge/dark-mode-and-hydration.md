# Dark Mode and Hydration Error Prevention

## Overview

This app uses MUI components inside a Next.js App Router project. Without explicit configuration,
MUI always renders in light mode regardless of the OS/browser preference. This document covers
how dark mode is enabled and how to avoid React hydration errors that arise from it.

## Enabling MUI Dark Mode

**File: `app/[locale]/providers.tsx`**

```tsx
import { createTheme, ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";

const theme = createTheme({
  colorSchemes: {
    dark: true,
  },
  cssVariables: {
    colorSchemeSelector: 'media',
  },
});

export default function Providers({ children }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      {children}
    </ThemeProvider>
  );
}
```

### Why `colorSchemeSelector: 'media'`

MUI v7 supports two approaches for dark mode:

| Selector | How it works | SSR safe? |
|---|---|---|
| `'class'` | Adds `.dark` class to `<html>` via JS script | Requires `getInitColorSchemeScript` (client-only, breaks SSR) |
| `'media'` | Scopes CSS variables inside `@media (prefers-color-scheme: dark)` | Yes — pure CSS, identical server/client output |

The `'media'` approach is the right choice for Next.js App Router because:
- No JavaScript is needed to activate dark mode
- Server and client render identical HTML
- CSS handles the switching transparently

### Why `CssBaseline enableColorScheme`

`<CssBaseline enableColorScheme />` sets `color-scheme: light dark` on `<body>`, which tells the
browser to adapt native controls (scrollbars, form inputs, etc.) to match the color scheme.
Without it, browser-native UI elements may remain light even when MUI components are dark.

## Hardcoded Colors in Components

MUI components adapt automatically once `ThemeProvider` is set up. The risk area is **inline
styles or hardcoded color values** in custom components, which bypass the theme entirely.

### Problem example

```tsx
// AuditInfo.tsx — broken in dark mode
<div style={{ backgroundColor: '#f5f5f5' }}>
```

`#f5f5f5` is a light grey that becomes a near-white bar on a dark background.

### Fix: use MUI CSS variables

```tsx
// Use a theme-aware CSS variable instead
<div style={{ backgroundColor: 'var(--mui-palette-action-hover)' }}>
```

Common MUI CSS variables that adapt to both light and dark mode:

| Variable | Use case |
|---|---|
| `var(--mui-palette-action-hover)` | Subtle tinted background (e.g. info bars) |
| `var(--mui-palette-background-paper)` | Card / paper surface |
| `var(--mui-palette-background-default)` | Page background |
| `var(--mui-palette-text-primary)` | Primary text |
| `var(--mui-palette-text-secondary)` | Muted/secondary text |
| `var(--mui-palette-divider)` | Borders and dividers |

Alternatively, use MUI's `sx` prop or `useTheme()` hook which are always theme-aware.

## Hydration Error Prevention

React hydration errors occur when the HTML rendered on the server differs from what React
renders on the client during hydration. In Next.js App Router this manifests as:

> "Hydration failed because the server rendered HTML didn't match the client."

### Cause 1: Locale-sensitive date formatting

`Date.toLocaleString()` and related methods produce different output depending on the locale
configured in the runtime. The server (Node.js) may use a system locale that differs from
the user's browser locale.

**Affected components:** `AuditInfo.tsx`, `CommentListWrapper.tsx`

**Fix:** Add `suppressHydrationWarning` to the element that contains the formatted date.

```tsx
<Typography variant="caption" suppressHydrationWarning>
  {formatDate(comment.created_at)}
</Typography>
```

`suppressHydrationWarning` tells React to accept the mismatch on that specific node and use
the client-rendered value. This is appropriate when:
- The difference is cosmetic (display formatting, not data)
- The client value is the correct one to show (user's local time format)

Do **not** use it to suppress meaningful data differences — only use it where the server
genuinely cannot know the correct client-side value.

### Cause 2: MUI color scheme class injection

When using `colorSchemeSelector: 'class'`, MUI requires `getInitColorSchemeScript` to be
injected into the page before React hydrates. However, `getInitColorSchemeScript` is a
client-only API and cannot be called from a Next.js server component — attempting to do so
throws a runtime error.

**Fix:** Use `colorSchemeSelector: 'media'` instead (see above). This avoids the need for
any script injection and eliminates the hydration mismatch.

### General checklist for avoiding hydration errors

- Avoid `Date.toLocaleString()` / `toLocaleDateString()` in SSR-rendered output; use
  `suppressHydrationWarning` or format with a fixed locale if unavoidable
- Avoid reading `window`, `navigator`, `localStorage`, or other browser globals during render
- Avoid `Math.random()` or `Date.now()` in rendered output
- Avoid CSS-in-JS that depends on runtime state during SSR
- Prefer CSS variables and media queries over JS-driven theming for color schemes
