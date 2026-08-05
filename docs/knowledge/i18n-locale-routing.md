# Internationalisation (i18n) — Locale-Based Routing

## Overview

The app supports multiple locales using **next-intl v4** with **locale-based URL routing**.
Every page URL is prefixed by the locale (`/en/booking`, `/ja/booking`), which gives:

- **SEO** — search engines index each locale at its own URL
- **CDN caching** — responses are cacheable per locale without cookie-based variance
- **Shareable links** — the locale is self-contained in the URL, not hidden in a cookie
- **Server-side rendering** — the locale is known at request time without client-side detection

Supported locales: `en` (English, default), `ja` (Japanese).

---

## File Structure

```
i18n/
  routing.ts          ← supported locales + default locale
  request.ts          ← server-side getRequestConfig (loads messages)
  navigation.ts       ← locale-aware Link, useRouter, usePathname, redirect

messages/
  en.json             ← English translation strings
  ja.json             ← Japanese translation strings

proxy.ts              ← Next.js middleware: locale routing + auth token check
app/
  layout.tsx          ← minimal root shell; reads locale via getLocale()
  [locale]/
    layout.tsx        ← locale layout: wraps NextIntlClientProvider + page shell
    @header/page.tsx  ← header with locale switcher (client component)
    @sidebar/page.tsx ← nav sidebar (client component)
    @footer/page.tsx  ← footer
    providers.tsx     ← SessionProvider + SidebarProvider
    login/page.tsx
    register/page.tsx
    [entity]/...      ← all generated entity pages
  api/                ← API routes (no locale prefix — unaffected by i18n)
```

---

## Key Files Explained

### `i18n/routing.ts`

Defines the supported locales and the default. Import this wherever the locale list is needed (e.g. the header locale switcher, `generateStaticParams`).

```ts
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'ja'],
  defaultLocale: 'en',
});
```

### `i18n/request.ts`

Called by next-intl on every server request. Reads the locale from the URL (set by the middleware) and loads the matching message file.

```ts
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !routing.locales.includes(locale as 'en' | 'ja')) {
    locale = routing.defaultLocale;
  }
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
```

### `i18n/navigation.ts`

Re-exports locale-aware navigation helpers created by next-intl. **Always import `Link`, `useRouter`, `usePathname`, and `redirect` from here** instead of `next/link` or `next/navigation` — the wrappers automatically prepend the current locale to every path.

```ts
import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
```

### `proxy.ts` (middleware)

The project uses `proxy.ts` as its middleware entry point (not `middleware.ts`). It chains two responsibilities:

1. **Locale routing** — next-intl redirects bare paths (`/booking` → `/en/booking`) and sets the locale for the request
2. **Auth protection** — non-public paths require a valid JWT; unauthenticated users are redirected to `/{locale}/login`

```ts
// proxy.ts (simplified)
const intlMiddleware = createIntlMiddleware(routing);
const PUBLIC_PATHS = ['/login', '/register'];

export async function proxy(req: NextRequest) {
  // determine path without locale prefix
  const isPublicPath = PUBLIC_PATHS.some(p => pathnameWithoutLocale === p);
  const intlResponse = intlMiddleware(req);   // handles locale redirect/rewrite

  if (isPublicPath) return intlResponse;

  const token = await getToken({ req, secret: process.env.AUTH_SECRET });
  if (!token) {
    url.pathname = `/${locale}/login`;
    return NextResponse.redirect(url);
  }
  return intlResponse;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
```

> **Do not create `middleware.ts`** — the framework detects both files and throws an error.

---

## Using Translations

### In server components

```ts
import { getTranslations } from 'next-intl/server';

export default async function MyPage() {
  const t = await getTranslations('Nav');
  return <h1>{t('home')}</h1>;
}
```

### In client components

```tsx
"use client";
import { useTranslations } from 'next-intl';

export default function MyComponent() {
  const t = useTranslations('Header');
  return <button>{t('signOut')}</button>;
}
```

> **Note:** `useTranslations` only works inside `NextIntlClientProvider`. The locale layout (`app/[locale]/layout.tsx`) wraps all pages in this provider, so any client component under `[locale]/` can call `useTranslations`.

### In `app/[locale]/layout.tsx`

The locale layout must call `setRequestLocale` (for static rendering support) and fetch messages before rendering:

```tsx
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

export default async function LocaleLayout({ children, params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <Providers>...</Providers>
    </NextIntlClientProvider>
  );
}
```

---

## Adding a New Locale

1. Add the locale to `i18n/routing.ts`:
   ```ts
   locales: ['en', 'ja', 'fr'],
   ```

2. Create the message file `messages/fr.json` with all required keys (copy `en.json` as a starting template).

3. Update the `localeLabels` map in `app/[locale]/@header/page.tsx`:
   ```ts
   const localeLabels: Record<string, string> = {
     en: "EN",
     ja: "日本語",
     fr: "FR",
   };
   ```

4. Update `i18n/request.ts` — widen the type guard to include the new locale:
   ```ts
   if (!locale || !routing.locales.includes(locale as 'en' | 'ja' | 'fr')) {
   ```

That's all — next-intl handles the rest automatically.

> This 4-step procedure is for the **site UI locale** (chrome, labels,
> forms). It does not apply to Terms of Service / Privacy Policy content
> locales, which are resolved independently of `routing.locales` — see
> [legal-documents.md](./legal-documents.md#design-document-locale-is-decoupled-from-the-site-ui-locale).

---

## Navigation

All internal links must use `Link` / `useRouter` from **`@/i18n/navigation`**, not from `next/link` or `next/navigation`. The wrappers prefix paths with the current locale automatically.

```tsx
// ✅ correct
import { Link } from '@/i18n/navigation';
<Link href="/booking">Bookings</Link>   // renders as /en/booking or /ja/booking

// ❌ wrong — bypasses locale prefix
import Link from 'next/link';
<Link href="/booking">Bookings</Link>   // renders as /booking (no locale)
```

### Switching locale

From a client component, use `useRouter().replace` with the `locale` option:

```tsx
const router = useRouter();     // from @/i18n/navigation
const pathname = usePathname(); // from @/i18n/navigation

router.replace(pathname, { locale: 'ja' });
```

The header already exposes this as labelled buttons (EN / 日本語).

---

## Message File Structure

```json
{
  "Header": {
    "signIn": "Sign In",
    "signOut": "Sign Out",
    "openMenu": "Open menu",
    "closeMenu": "Close menu"
  },
  "Nav": {
    "home": "Home",
    "dbTables": "DB Tables",
    ...
  },
  "Auth": {
    "signInTitle": "Sign in to your account",
    "registerTitle": "Create your account",
    ...
  }
}
```

Add new namespaces (top-level keys) as features grow. Keep key names camelCase and scoped to their UI context.

---

## Code Generator Integration

The generator outputs pages to `app/[locale]/[entity]/` (not `app/[entity]/`).
The relevant line in `code_generator/generate.py`:

```python
app_dir = out / 'app' / '[locale]' / parent
```

API routes are **not** locale-prefixed — they stay at `app/api/[entity]/`:

```python
api_dir = out / 'app' / 'api' / parent
```

### `messages/*.json` are append-only, never generator-truncated (cmd_560)

`code_generator/generators_i18n.py::update_i18n_and_config` (called at the end
of every `generate-code` run) treats every `messages/*.json` file as
append-only: `_update_json` adds a key only when it is genuinely missing and
never removes or overwrites an existing one, so a manually-translated
`messages/ja.json` value always survives a normal `generate-code` run. `en.json`
is the source-of-truth locale (`i18n/routing.ts` `defaultLocale`); any key
newly added to a *different* locale file carries that same English text as an
untranslated placeholder, and the build log prints a `WARNING: untranslated
keys added` line naming exactly which keys still need translation — check for
that line after `generate-code`, don't assume a clean "Updated: messages/ja.json"
line means everything is translated.

**`code_generator/cleanup.py` must never delete entries from `messages/*.json`.**
It used to: `_clean_appended_files` computed the Fields/EntityLabel/Nav keys
belonging to whatever schema was passed and deleted every matching key from
`messages/*.json` — including entries for real, still-in-use entities, because
`npm run cleanup` always rebuilds its schema argument fresh from whatever
`json_schema.yaml` currently says (there is no "only the removed entity" input
available to it). Running `npm run cleanup` while a temp fixture entity was
still present in the schema (e.g. to remove that fixture's generated files
before reverting the schema file — a normal fixture-testing workflow) wiped
every real entity's translated keys too. A subsequent `generate-code` then
looked at those now-missing keys as "genuinely missing" and refilled them with
the English schema default — the observed symptom was `messages/ja.json`
turning wholesale English. `cleanup.py` now leaves `messages/*.json` alone
entirely (it still cleans `lib/site-config.ts` and
`app/[locale]/@sidebar/page.tsx`, which are pure schema-derived href/label
pairs with no human-edited content, so re-deriving them is safe).

---

## Testing

### Cypress E2E

All `cy.visit()` calls use the `/en/` prefix (the default locale):

```ts
cy.visit('/en/booking');
cy.visit('/en/booking/new');
cy.visit('/en/');
```

This is baked into the test template (`code_generator/templates/test_spec.cy.ts.jinja2`). Regenerating tests will produce the correct paths automatically.

### Vitest unit tests

Components that use next-intl hooks cannot import the real `@/i18n/navigation` module in tests (it triggers ESM resolution errors). Mock both packages:

```ts
vi.mock('@/i18n/navigation', () => ({
  useRouter: vi.fn(() => ({ push: mockPush, refresh: mockRefresh })),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next-intl', () => ({
  useTranslations: (_namespace: string) => (key: string) => {
    const messages: Record<string, string> = {
      registerTitle: 'Create your account',
      // ... all keys used by the component under test
    };
    return messages[key] ?? key;
  },
}));
```

> Never mock `next/navigation` directly for components that import from `@/i18n/navigation`.

---

## Gotchas

| Issue | Cause | Fix |
|---|---|---|
| `Both middleware.ts and proxy.ts detected` | `middleware.ts` exists alongside `proxy.ts` | Delete `middleware.ts`; `proxy.ts` is the sole middleware entry point |
| ESM resolution error in tests | next-intl imports `next/navigation` without `.js` extension | Mock `@/i18n/navigation` and `next-intl` instead of the real modules |
| Locale switcher navigates to wrong path | Using `router.push(locale + pathname)` manually | Use `router.replace(pathname, { locale })` from `@/i18n/navigation` |
| `getTranslations` fails in client component | Server-only function used inside `"use client"` boundary | Use `useTranslations` instead |
| Sidebar translations missing | `SessionSidebar` (client) imports `Sidebar` — must be client component | `@sidebar/page.tsx` uses `useTranslations`, not `getTranslations` |
