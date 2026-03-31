# Dark Mode and Hydration Errors in Next.js App Router with MUI

Adding dark mode to a [Next.js](https://nextjs.org/) App Router application sounds
straightforward — enable a theme option and you're done. In practice, combining
[Material UI (MUI)](https://mui.com/) with Next.js App Router introduces a subtle
set of pitfalls around **React hydration errors** that can be hard to diagnose
and harder to fix if you encounter them in the wrong order.

This article walks through the problem, why it happens, and the correct setup
sequence to get dark mode working without hydration errors.

---

## Background: What Is Hydration?

Next.js renders pages on the server and sends the resulting HTML to the browser.
React then runs on the client and "hydrates" that HTML — it attaches event
handlers and takes over control of the DOM. For this to work, the HTML structure
React produces on the client must exactly match what the server sent.

When there's a mismatch, React throws a hydration error:

> "Hydration failed because the server rendered HTML didn't match the client."

These errors are often invisible during development but appear in production, or
they can cause a blank page or a broken layout. See the
[React docs on hydration](https://react.dev/reference/react-dom/client/hydrateRoot#troubleshooting)
for a deeper explanation.

---

## Background: How MUI Styles Work

MUI uses [Emotion](https://emotion.sh/docs/introduction) as its CSS-in-JS engine.
Emotion generates `<style>` tags at runtime. In a server-rendered app, Emotion also
generates those styles on the server and embeds them in the initial HTML so the page
doesn't flash unstyled content.

The order and position of those `<style>` tags must be identical between the server
and the client. If they differ, React's hydration check fails.

---

## The Trap: Adding ThemeProvider Before AppRouterCacheProvider

A common mistake is to install MUI and immediately add a `ThemeProvider`:

```tsx
// app/layout.tsx — DO NOT do this yet
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

Without the correct Emotion cache setup, adding `ThemeProvider` triggers a cascade
of SSR style injection that produces hydration errors. You may see:

- `Hydration failed because the server rendered HTML didn't match the client`
- `Cannot read properties of null (reading 'parentNode')`

What makes this tricky is that *without* `ThemeProvider`, Emotion generates very
little CSS during SSR, so the bug stays hidden. As soon as `ThemeProvider` is
added, Emotion generates substantial CSS server-side and injects `<style>` tags in
a position that conflicts with React's hydration.

---

## Step 1: Install and Configure AppRouterCacheProvider

[`AppRouterCacheProvider`](https://mui.com/material-ui/integrations/nextjs/) is
MUI's official adapter for the Next.js App Router. It ensures Emotion's style cache
is shared correctly across SSR and client hydration, so `<style>` tags are inserted
in the same order and position on both sides.

Install the package:

```bash
npm install @mui/material-nextjs
```

Then wrap the root layout's body content:

```tsx
// app/layout.tsx
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider>
          {children}
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
```

This must be in place **before** you add `ThemeProvider`. If you add `ThemeProvider`
first, you'll encounter hydration errors that are difficult to trace back to the
missing cache provider.

---

## Step 2: Add ThemeProvider with Dark Mode

Once `AppRouterCacheProvider` is in place, you can safely add a `ThemeProvider`.
Because `ThemeProvider` and `CssBaseline` are client components (they use React
context), it's cleanest to extract them into a dedicated `Providers` component:

```tsx
// app/providers.tsx
'use client';

import { createTheme, ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

const theme = createTheme({
  colorSchemes: {
    dark: true,
  },
  cssVariables: {
    colorSchemeSelector: 'media',
  },
});

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      {children}
    </ThemeProvider>
  );
}
```

Then use it in the layout:

```tsx
// app/layout.tsx
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import Providers from './providers';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider>
          <Providers>
            {children}
          </Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
```

---

## Why `colorSchemeSelector: 'media'`

MUI v6+ supports two approaches for activating dark mode:

| Approach | How it works | SSR-safe? |
|---|---|---|
| `'class'` | Adds a `.dark` class to `<html>` via a JS script | Requires `getInitColorSchemeScript`, which is client-only |
| `'media'` | Scopes CSS variables inside `@media (prefers-color-scheme: dark)` | Yes — pure CSS, no script needed |

The `'class'` approach requires injecting
[`getInitColorSchemeScript`](https://mui.com/material-ui/customization/css-theme-variables/usage/#server-side-rendering)
into the page before React hydrates. However, this API is client-only and cannot
be called from a Next.js Server Component — attempting it throws a runtime error.

The `'media'` approach uses a CSS media query to apply dark-mode CSS variables.
Since the CSS is identical on server and client, there is no hydration mismatch.
This is the right default for Next.js App Router.

```css
/* What MUI generates under the hood with colorSchemeSelector: 'media' */
@media (prefers-color-scheme: dark) {
  :root {
    --mui-palette-background-default: #121212;
    --mui-palette-text-primary: #fff;
    /* ... */
  }
}
```

Dark mode activates automatically based on the OS/browser preference — no
JavaScript is required at runtime.

---

## Why `CssBaseline enableColorScheme`

```tsx
<CssBaseline enableColorScheme />
```

[`CssBaseline`](https://mui.com/material-ui/react-css-baseline/) resets browser
default styles (similar to [normalize.css](https://necolas.github.io/normalize.css/)).
The `enableColorScheme` prop adds `color-scheme: light dark` to `<body>`, which
tells the browser to adapt its native controls — scrollbars, form inputs, select
dropdowns, date pickers — to the active color scheme. Without it, browser-native
UI elements remain light even when MUI components are dark.

---

## Hardcoded Colors: The Hidden Dark Mode Bug

MUI components adapt automatically once `ThemeProvider` is set up. The risk area
is **hardcoded color values** in custom components, which bypass the theme entirely.

```tsx
// Broken in dark mode — hardcoded light grey
<div style={{ backgroundColor: '#f5f5f5' }}>
  Some content
</div>
```

`#f5f5f5` is near-white. On a dark background it creates a harsh light bar that
looks broken.

**Fix:** use MUI's CSS variables, which are updated automatically by the theme:

```tsx
// Theme-aware — adapts to light and dark mode
<div style={{ backgroundColor: 'var(--mui-palette-action-hover)' }}>
  Some content
</div>
```

Common MUI CSS variables that adapt to both light and dark mode:

| Variable | Use case |
|---|---|
| `var(--mui-palette-action-hover)` | Subtle tinted background (e.g. info bars) |
| `var(--mui-palette-background-paper)` | Card / paper surface |
| `var(--mui-palette-background-default)` | Page background |
| `var(--mui-palette-text-primary)` | Primary text |
| `var(--mui-palette-text-secondary)` | Muted / secondary text |
| `var(--mui-palette-divider)` | Borders and dividers |

Alternatively, use MUI's
[`sx` prop](https://mui.com/system/getting-started/the-sx-prop/) or the
[`useTheme()` hook](https://mui.com/material-ui/customization/theming/#accessing-the-theme-in-a-component),
which are always theme-aware:

```tsx
import { useTheme } from '@mui/material/styles';

function MyComponent() {
  const theme = useTheme();
  return (
    <div style={{ backgroundColor: theme.palette.action.hover }}>
      Some content
    </div>
  );
}
```

---

## Other Common Hydration Errors

### Locale-sensitive date formatting

`Date.toLocaleString()` and related methods produce different output depending on
the locale configured in the runtime. The Node.js server may use a system locale
that differs from the user's browser locale, causing a mismatch.

```tsx
// Potentially different output on server vs client
<span>{new Date(post.created_at).toLocaleString()}</span>
```

Two options:

**Option A — Suppress the warning** (when the client value is the correct one):

```tsx
<span suppressHydrationWarning>
  {new Date(post.created_at).toLocaleString()}
</span>
```

[`suppressHydrationWarning`](https://react.dev/reference/react-dom/components/common#common-props)
tells React to accept the mismatch on that specific element and use the
client-rendered value. Only use it where the mismatch is cosmetic and the client
value is the correct one to show (e.g. the user's local time format).

**Option B — Format with a fixed locale** (consistent on both sides):

```tsx
<span>
  {new Date(post.created_at).toLocaleString('en-US', { timeZone: 'UTC' })}
</span>
```

### Browser-only globals

Accessing `window`, `navigator`, `localStorage`, or `document` during render
will throw on the server (where they don't exist) or produce a mismatch:

```tsx
// Crashes on server
const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
```

Move these reads inside a `useEffect` (which only runs on the client) or use a
library like [`usehooks-ts`](https://usehooks-ts.com/react-hook/use-media-query)
that handles this safely.

### Math.random() and Date.now() in rendered output

These produce different values on each call, so server and client will never match:

```tsx
// Never do this in rendered output
<div id={`item-${Math.random()}`}>...</div>
```

Use a stable ID source instead, such as a database ID or the
[`useId()`](https://react.dev/reference/react/useId) hook.

---

## Setup Summary (correct order)

Getting the order right is important — adding `ThemeProvider` before
`AppRouterCacheProvider` triggers errors that are hard to trace.

1. Install `@mui/material-nextjs`
2. Add `AppRouterCacheProvider` to `app/layout.tsx` (wraps the body contents)
3. Create a client `Providers` component with `ThemeProvider` + `CssBaseline`
4. Use `colorSchemeSelector: 'media'` in the theme — no init script, SSR-safe
5. Replace any hardcoded color values in custom components with MUI CSS variables

---

## References

- [MUI: Next.js App Router integration](https://mui.com/material-ui/integrations/nextjs/)
- [MUI: Dark mode](https://mui.com/material-ui/customization/dark-mode/)
- [MUI: CSS theme variables — server-side rendering](https://mui.com/material-ui/customization/css-theme-variables/usage/#server-side-rendering)
- [MUI: CssBaseline](https://mui.com/material-ui/react-css-baseline/)
- [MUI: The sx prop](https://mui.com/system/getting-started/the-sx-prop/)
- [Next.js: App Router — Rendering](https://nextjs.org/docs/app/building-your-application/rendering)
- [React: hydrateRoot — troubleshooting](https://react.dev/reference/react-dom/client/hydrateRoot#troubleshooting)
- [React: suppressHydrationWarning](https://react.dev/reference/react-dom/components/common#common-props)
- [React: useId](https://react.dev/reference/react/useId)
- [Emotion: Server-side rendering](https://emotion.sh/docs/ssr)
