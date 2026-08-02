# Terms of Service / Privacy Policy

## Overview

The generated application ships a Terms of Service and a Privacy Policy at
`/[locale]/legal/terms` and `/[locale]/legal/privacy`, linked from the
registration page. Both are **templates**: they describe what the generated
application actually does by default (see "Content accuracy" below), but
every deployment must fill in the `[PLACEHOLDER]` fields and have the result
reviewed by qualified counsel before relying on it. This is stated in the
document itself (`Legal.templateDisclaimer`), not only here.

## Design: document locale is decoupled from the site UI locale

This is the key decision and the reason these pages don't follow the normal
["Adding a New Locale"](./i18n-locale-routing.md#adding-a-new-locale)
4-step procedure (editing `i18n/routing.ts`, `i18n/request.ts`, the header's
`localeLabels`, etc).

- The site's UI chrome locale (`en`/`ja`, gated by `i18n/routing.ts`) still
  only supports what's listed there — adding a legal-document translation
  does **not** add a new UI locale.
- The **document content locale** is a separate, independent axis, selected
  via a `?lang=` query parameter on the `/legal/terms` and `/legal/privacy`
  pages (`lib/legal/content.ts`, `components/legal/LegalDocumentView.tsx`).
  Query parameters are invisible to `proxy.ts`'s path-based locale
  middleware, so they never collide with the next-intl locale prefix or
  need `routing.locales` touched.
- Available document locales are **discovered from disk** at request time
  (`getAvailableLegalLocales()` lists `content/legal/*.md` and extracts the
  locale from the filename) — there is no hardcoded locale list to edit.

**Consequence — adding a document language is adding two files, nothing
else:**

```
content/legal/terms.fr.md
content/legal/privacy.fr.md
```

The language switcher on both pages picks the new file up automatically
(it lists whatever `getAvailableLegalLocales()` returns), and
`/en/legal/terms?lang=fr` (or `/ja/legal/terms?lang=fr`) renders it
immediately — no code change, no template change, no rebuild-time step.
This was verified in the isolated dev worktree by temporarily adding a
third locale, confirming it rendered, then removing the temporary files
before committing (see the task's completion report for the exact
commands/output — the temporary locale is intentionally not committed).

If a requested/site locale has no content file, `readLegalDocument()` falls
back: requested locale → site locale → whatever locale happens to exist.
The document therefore never 404s outright.

## Why plain Markdown, not JSON or MDX

- **Not `messages/*.json`**: legal text is long-form prose with headings,
  paragraphs, and lists. Escaping that structure into JSON string values is
  unnatural to write and diff, and it would also force document content
  through the same file as short UI labels.
- **Not MDX**: `@next/mdx` is already configured in this repo (see
  `mdx-components.tsx`, `next.config.ts`), but MDX compiles to and executes
  JavaScript. Legal documents are inert prose that non-engineers (legal/ops
  staff) are the most likely people to edit — plain Markdown keeps that
  editable without a code review being required for the interpreter to stay
  safe (no JSX/JS can be smuggled into a `.md` file the way it could into a
  `.mdx` file). Rendering uses `react-markdown` + `remark-gfm`, which parse
  text and never `eval` anything.
- Content lives outside `app/` (`content/legal/`) so it is data, not a
  route — Next.js's file-based router never treats it as a page.

## Rendering pipeline

`app/[locale]/legal/terms/page.tsx` and `.../privacy/page.tsx` are thin
Server Components that resolve `{ locale }` (site UI locale) and
`{ lang }` (requested document locale, from `searchParams`), then delegate
to `components/legal/LegalDocumentView.tsx`, which:

1. Calls `getAvailableLegalLocales(doc)` to build the language switcher.
2. Calls `readLegalDocument(doc, lang ?? locale, locale)` to load Markdown
   source with fallback.
3. Renders it via `<ReactMarkdown remarkPlugins={[remarkGfm]}>` inside a
   Tailwind `prose` wrapper (`@tailwindcss/typography`, already a
   dependency, used the same way as the pre-existing empty
   `app/[locale]/docs` scaffold).

## Vercel deployment note: `outputFileTracingIncludes`

`readLegalDocument()` reads `content/legal/*.md` via `fs.readFileSync` with
a runtime-built path, not a static `import`. Vercel's build-time file
tracer only bundles files it can discover by static analysis, so without a
hint it can drop `content/legal/*.md` from the deployed function even
though `next build`/`next start` works locally (this repo does not set
`output: 'standalone'`, so the local dev/test/build commands run from the
full source tree regardless and never hit this gap — it is Vercel-specific
tracing, not something the local gate exercises).

`next.config.ts` sets:

```ts
outputFileTracingIncludes: {
  '/**': ['./content/legal/**/*'],
},
```

so the whole `content/legal/` directory is always included in the deployed
bundle.

## Where the links live

- `proxy.ts`'s `PUBLIC_PATHS` includes `/legal` — these pages must be
  reachable by a signed-out visitor coming from the registration flow.
- `app/[locale]/register/page.tsx` renders `Auth.legalAgreementNotice` via
  `t.rich(...)`, embedding `<Link href="/legal/terms">` /
  `<Link href="/legal/privacy">` for the two tagged spans. Using `t.rich`
  (rather than string-concatenating two separately-translated link labels)
  lets each locale's translation control word order and surrounding
  punctuation, which matters for Japanese.
- The login page and footer were deliberately **not** touched — adding
  links there was scoped out of this task; see the task's completion
  report for that recommendation.

## Content accuracy

The English/Japanese copy describes only what this codebase actually does
(verified by reading `auth.ts`, `prisma/schema.prisma`, `lib/_notifier.ts`,
and the CSV import/export and attachment upload UI, not written from a
generic template): credentials + optional Google OAuth, optional TOTP MFA,
JWT session cookie for credentials sign-in, an `audit_log` model recording
actor/action/target, in-app (not email/push) notifications, CSV
import/export, file attachments (local filesystem or a configured cloud
storage provider depending on deployment — `@vercel/blob` and
`@google-cloud/storage` are both present as dependencies), multi-tenant
(`tenant_id`) data isolation, and no bundled third-party analytics/tracking
by default. Anywhere the actual value depends on how a given deployment is
configured (which storage backend, which hosting provider, retention
period, contact address, governing law, company name), the document uses an
explicit `[PLACEHOLDER]` rather than a guessed default — see the task's
completion report for the full placeholder list.

## Tests

- `lib/legal/content.test.ts` (vitest) — locale discovery and fallback
  resolution.
- `app/[locale]/register/page.test.tsx` (vitest) — the register page's
  agreement notice renders both links with the correct `href`s. The
  `next-intl` mock had to grow a `t.rich` implementation for this (see
  [i18n-locale-routing.md](./i18n-locale-routing.md#vitest-unit-tests) for
  the plain-`t` mock this extends).
- `cypress/e2e/legal_pages.cy.ts` (mandatory UI e2e gate,
  `npm run test:e2e:cy:ui`) — both documents open in `en` and `ja` without
  authentication, and the register page's links resolve to them.
