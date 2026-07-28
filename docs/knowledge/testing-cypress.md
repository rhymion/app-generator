# Testing with Cypress

## Overview

This project generates Cypress E2E tests automatically from YAML schema definitions.
The generator produces three kinds of files per entity:

| File | Purpose |
|---|---|
| `cypress/support/{entity}/helper.ts` | Prisma populate functions for seeding test data |
| `cypress/e2e/{entity}.cy.ts` | UI test spec (see categories below) |
| `cypress/e2e/api/{entity}.cy.ts` | API test spec via `cy.request()` (when `api: true`) |
| `cypress/support/generated-tasks.ts` | Task registry imported by `cypress.config.ts` |

---

## Task Registration

### Problem
Old approach: manually adding populate tasks to `cypress.config.ts`.
This breaks when the generator overwrites the helper file (function names change).

### Solution
`cypress/support/generated-tasks.ts` exports `getGeneratedTasks()` which returns all
populate tasks as an object. `cypress.config.ts` imports and spreads it:

```ts
import { getGeneratedTasks } from "./cypress/support/generated-tasks";

on('task', {
  async 'db:reset'() { ... },
  async 'db:seed'() { ... },
  ...getGeneratedTasks(),  // all generated populate tasks
});
```

The generator maintains this file automatically. Only `db:reset` and `db:seed` stay manual.

---

## Test categories

### UI tests

Each generated spec covers these categories:

| # | Category | Key assertion |
|---|---|---|
| 1.1 | Empty list | `assertDataGridEmpty()` |
| 1.2 | One item | `cy.contains('Name 1').should('be.visible')` → `getDataGridRowCount().should('eq', 1)` |
| 1.3 | Multiple items | same pattern |
| 2.1 | Create (required only) | URL includes `/{entity}` after save |
| 2.2 | Create (full data) | View page fields match |
| 3.1 | Edit (add optional) | View page reflects added data |
| 3.2 | Edit (remove optional) | Uses `db:populate{Entity}Full` task |
| 3.3 | Edit (mixed) | Changes name, checks result |
| 4.1 | Delete single from list | `getDataGridRowCount().should('eq', 1)` |
| 4.2 | Delete multiple from list | same pattern |
| 4.3 | Delete from edit page | URL returns to list, item gone |
| 5.1 | Fail create (required parent missing) | URL stays on `/new` |
| 5.2 | Fail create (required child missing) | URL stays on `/new` |
| 6.1 | Fail edit (required parent cleared) | URL stays on `/edit` |
| 6.2 | Fail edit (required child cleared) | URL stays on `/edit` |

Run with: `npm run test:e2e:cy:ui` (full suite takes roughly 6 minutes).

Each spec logs in fresh in `beforeEach` (see `beforeEach` Pattern below), so changes
to rate-limiting (thresholds, adapter swaps) can hit auth rate limits across the
suite. Check `RATE_LIMIT_AUTH_CREDENTIALS_LIMIT` (`lib/rate-limit/index.ts`), which
lets `.env.test` raise the login rate limit for test runs, before assuming a UI
test failure is a real bug.

### API tests

Generated when `api: true && test: true` in x-generate config. Located in `cypress/e2e/api/`.
Uses `cy.request()` — no browser UI involved, reliable in headless mode.

Run with: `npm run test:e2e:cy:api`

| # | Category | Method | Expected status |
|---|---|---|---|
| 1.1 | Empty list | GET | 200, `[]` |
| 1.2 | List with items | GET | 200, length 1 |
| 2.1 | Detail by id | GET /:id | 200, correct id |
| 2.2 | 404 for missing | GET /:id | 404 |
| 3.1 | Create + verify GET | POST | 201, then GET 200 |
| 4.1 | Update + verify GET | PUT /:id | 200, then GET 200 |
| 4.2 | Delete + verify 404 | DELETE /:id | 204, then GET 404 |
| 5.1 | Fail: missing name | POST | ≥400 |
| 6.1 | 401 no API key | GET | 401 |
| 6.2 | 401 invalid key | GET | 401 |
| 7.1 | 403 GET (deny role) | GET | 403 |
| 7.2 | 403 POST (deny role) | POST | 403 |

#### Permission testing approach
The `db:createLimitedApiUser(modelName)` task creates a user with a DenyRole that has
all permissions set to `false`. This triggers `authz.ts`'s explicit-match path (no
default grant), returning 403. The main test user has no roles → no matching records
→ default grant → 200.

API tests use `TEST_API_KEY` (defined in `cypress/support/test-credentials.ts`) which
is seeded into the test user by `seedTestDatabase()` in `db-helpers.ts`.

---

## Mandatory gate (`test:e2e:cy:api`) composition

`test:e2e:cy:api` is the mandatory gate referenced by `CLAUDE.md`. Its `--spec`
argument is a single dynamic glob:

- `cypress/e2e/api/**` — automatically includes every generated API spec.

The gate does **not** include any UI specs. In particular, `purchase_order.cy.ts`
and `receiving_receipt.cy.ts` are full UI specs (they still exist under
`cypress/e2e/` and run as part of `npm run test:e2e:cy:ui`), but they are excluded
from the mandatory gate's `--spec` value — a prior draft of this doc described them
as an explicit curated addition to `test:e2e:cy:api`, which never matched
`package.json` and has been corrected here (cmd_467).

If a future UI regression needs to become a hard gate, add its spec path to the
`--spec` value in `package.json` directly — no separate config file governs this.

---

## Cypress commands and helpers

### `getDataGridRowCount()`

```ts
// cypress/support/datagrid-helpers.ts
export function getDataGridRowCount() {
  return cy.get('div[role="row"][data-rowindex]').its('length');
}
```

Cypress retries the entire chain automatically. Pairing with `.should('eq', N)` is
correct — Cypress will retry until the count matches or the assertion times out.

### `fillDateTime`, `fillDate`, `fillTime`

With `enableAccessibleFieldDOMStructure={false}`, MUI X exposes a single `<input>`
with a **sectioned masked format** (`MM/DD/YYYY hh:mm aa`). Typing digits directly
into this input causes MUI X to auto-advance through sections automatically:
`MM → DD → YYYY → HH → MM → AM/PM`.

The calendar picker UI is **not used** — it is unreliable in headless Chromium.

| Command | Type into input |
|---|---|
| `fillDateTime` | `month + day + year + hour + minute + ampmChar` (e.g. `011520250900a`) |
| `fillDate` | `month + day + year` (e.g. `01152025`) |
| `fillTime` | `hour + minute + ampmChar` (e.g. `0900a`) |

`ampmChar`: `'a'` for AM, `'p'` for PM.

#### DOM detachment on focus — broken chain pattern

**Problem**: MUI X re-renders the input's internal structure when it receives
focus (section highlight state, aria attributes). The DOM node Cypress obtained
via `.find('input')` is replaced, so a chained `.type()` gets a stale (detached)
element and throws:

> CypressError: `cy.type()` failed because the page updated as a result of this
> command, but you tried to continue the command chain. The subject is no longer
> attached to the DOM.

**Fix**: break the chain between `.click()` and `.type()` so Cypress re-queries
the input after the re-render:

```ts
// BAD — stale reference after MUI re-render on focus:
cy.contains('label', label).parent().find('input').click().type('...');

// GOOD — re-queries the live element after click:
cy.contains('label', label).parent().find('input').click();
cy.contains('label', label).parent().find('input').type('...');
```

#### `fillDateTime` implementation

```ts
Cypress.Commands.add('fillDateTime', (label: string, dateString: string) => {
  const parts = dateString.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (!parts) throw new Error(`fillDateTime: Expected "MM/DD/YYYY HH:MM AM/PM", got "${dateString}"`);
  const [, month, day, year, hour, minute, ampm] = parts;
  const ampmChar = ampm.toUpperCase() === 'AM' ? 'a' : 'p';

  cy.contains('label', label).parent().find('input').click();
  cy.contains('label', label).parent().find('input').type(month + day + year + hour + minute + ampmChar);
});
```

#### Debugging tip: `assert(false)` masks the real error

`assert(false)` throws synchronously and aborts the Cypress command queue,
so any queued `cy.type()` / `cy.click()` failure never runs. You only see
the AssertionError, not the underlying CypressError. To bisect a failing step,
remove cy commands from the **end** of the test one at a time.

### `clearDateTime`

After adding `clearable: true` to `DateTimeWrapper`, the clear button appears.
The button uses a `title` attribute (not `aria-label`):

```ts
Cypress.Commands.add('clearDateTime', (label: string) => {
  cy.contains('label', label).parent().find('button[title="Clear"]').click();
});
```

> **Note:** The selector is `button[title="Clear"]`, **not**
> `button[aria-label="Clear value"]`. The `aria-label` attribute does not appear
> on this button in MUI X v8.

### Sticky Header and `scrollBehavior`

**Problem**: Cypress's default `scrollBehavior` is `'top'`, which scrolls the target element to
the top of the viewport before clicking. The app has a sticky header (~48px, `z-50`).
In headless mode, elements scrolled to the very top are covered by the header, so
clicks land on the header instead of the button — **silently** (no Cypress error).

**Solution**: Set `scrollBehavior: 'center'` in `cypress.config.ts`:

```ts
export default defineConfig({
  e2e: {
    scrollBehavior: 'center',
    // ...
  },
});
```

This scrolls targets to the center of the viewport, safely below the sticky header.
This option applies globally to all specs.

### Suppressing Known Next.js Uncaught Exceptions

`cypress/support/e2e.ts` suppresses two categories of exceptions that are not real
test failures:

```ts
Cypress.on('uncaught:exception', (err) => {
  // Next.js server actions use redirect() which throws — expected behavior
  if (err.message.includes('NEXT_REDIRECT')) return false;

  // Next.js app router's InnerLayoutRouter wraps pages in <Suspense> on the client,
  // but the initial SSR HTML has <main> at that slot. React self-heals automatically.
  if (err.message.includes('Hydration failed') ||
      err.message.includes('There was an error while hydrating')) return false;

  return true;
});
```

The hydration mismatch is structural: server renders `<main>` as a sibling of
`<SessionSidebar>`, but the client-side Next.js router internally wraps page content
in `<Suspense>` (InnerLayoutRouter). React detects the diff, logs the error, and
re-renders client-side — the page works correctly after recovery.

### FK Dependency Chain in Populate Helpers

When an entity has FK relationships (e.g., booking → resource → organization), the
generator:
1. Resolves transitive dependencies via DFS
2. Creates dependencies in topological order
3. Generates a `populate{Entity}Dependencies()` function that returns all created deps
4. The test task `db:populate{Entity}Dependencies` returns the dep objects, allowing
   tests to reference `deps.resource.name` for Autocomplete selectors

### `beforeEach` Pattern

Every generated spec resets state completely to avoid test pollution:

```ts
beforeEach(() => {
  cy.task('db:reset');
  cy.task('db:seed');
  Cypress.session.clearAllSavedSessions();
  cy.clearCookies();
  cy.clearLocalStorage();
  cy.visit('/en/');
  cy.window().then((win) => { win.sessionStorage.clear(); });
  cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
});
```

The `cy.login` call uses `cy.session` with `cacheAcrossSpecs: true` so the
login session is shared across spec files (but cleared explicitly in `beforeEach`
via `Cypress.session.clearAllSavedSessions()`).

---

## MUI DataGrid patterns

### Hydration timing issue

**Problem**: Tests 1.2 and 1.3 fail intermittently because `getDataGridRowCount()` is called
immediately after `cy.visit()`. MUI DataGrid SSR rendering differs from client
rendering (virtual scrolling recalculates on mount), causing a brief React
hydration re-render that temporarily shows 0 rows.

**Root cause**: `DataGridClient` (`components/DataGridClient.tsx`) is `'use client'` but still
SSR'd by Next.js App Router. The `Paper sx={{ height: 500 }}` container means MUI DataGrid
cannot compute virtual scroll dimensions server-side, so it re-renders on mount.
React logs "Hydration failed" and does a full client re-render.

**Fix**: Always assert a named item is visible **before** checking row count:

```ts
cy.contains('Parent Only 1').should('be.visible');  // waits for stable render
getDataGridRowCount().should('eq', 1);
```

This ensures the DataGrid has fully rendered before the count assertion.

### Permanent fix options (not yet applied)

- Use `dynamic(() => import('./DataGridClient'), { ssr: false })` in each page
  to skip server-rendering the DataGrid (eliminates hydration entirely).
- Serialize `Date` fields to ISO strings before passing as props to client
  components (reduces hydration surface area).

---

## MUI DateTimePicker patterns

### Version context

- `@mui/x-date-pickers: ^8.26.0` (MUI X v8)
- `@mui/x-data-grid: ^8.25.0`

### DateTimePicker Configuration (`DateTimeWrapper.tsx`)

```tsx
<DateTimePicker
  enableAccessibleFieldDOMStructure={false}   // (1)
  slotProps={{
    field: { clearable: true },               // (2)
    textField: { margin: 'normal' },
  }}
  {...other}
/>
```

**(1) `enableAccessibleFieldDOMStructure={false}`**

MUI X v8 changed the default to `true`, which renders each date section as a
`<span>` element with a zero-size hidden `<input>`. Cypress cannot interact with
that hidden input via `.clear()` or `.type()`.

Setting to `false` restores the v6-style single visible `<input>` element that
Cypress interacts with normally via `.find('input').first()`.

**(2) `field: { clearable: true }`**

Adds a clear (×) button inside the field so users can clear optional datetime
values. MUI automatically hides the clear button when `readOnly={true}` is passed
(as it is from `FormView`), so view pages are unaffected.

#### `{...other}` spread order

`{...other}` comes **after** `slotProps` in the JSX, so any `slotProps` passed via
`other` would override ours. In practice, callers only pass `onChange`, `readOnly`,
or `disabled` — not `slotProps` — so this is safe.

### DateTimePicker in `FormView` (read-only)

`FormView` passes `readOnly` to `DateTimeWrapper`:

```tsx
<DateTimeWrapper label="Login Time" date_time={src.login_time} readOnly />
```

MUI DateTimePicker respects `readOnly={true}`:
- The field is non-editable
- The clear button (`clearable: true`) is automatically hidden
- No UI changes needed in `FormView`

---

## CI/CD

### AUTH_SECRET and `.env.test`

`.env.test` is committed with a hardcoded `AUTH_SECRET`. The CI workflow must **not**
override this with `AUTH_SECRET: ${{ secrets.AUTH_SECRET }}` unless the secret is
actually configured in repository settings. If the secret is unset, GitHub Actions
expands it to an empty string `""`, which takes process-level precedence over
`.env.test`, giving NextAuth an empty key → HKDF throws:

```
TypeError: "ikm" must be at least one byte in length
```

This causes the NextAuth JWT to not be created, so the session cookie is never
issued, login appears to succeed but "Sign Out" never appears, and Cypress fails.

**Rule**: Only add `AUTH_SECRET` to the CI env block if the corresponding GitHub
repository secret is configured. Otherwise omit it and let `.env.test` provide it.

### Database

The test database is provided by `npm run docker:up:test` (docker-compose), which
starts Postgres on port 5432 matching `DATABASE_URL` in `.env.test`. Do **not** add
a redundant `services.postgres` block in the workflow — it runs on a different port
and is never connected to.

`docker-compose.test.yml`'s `postgres-test` and `redis-test` are single shared
instances. Do **not** run multiple E2E suites (e.g. `test:e2e:cy:api` and
`test:e2e:cy:ui`) concurrently against them — each suite's `db:reset` races the
other's in-flight test data, causing FK violations and other spurious failures.
Run E2E suites sequentially, not in parallel.

---

## Gotchas and known issues

### Test data values

| Field type | Required value | Edit value |
|---|---|---|
| text (name) | `Test {Title}` | `Updated {Title}` |
| text (other) | `Test {Label}` | `Updated {Label}` |
| number | `100` (clamped to min/max) | `200` |
| datetime (start/login) | `01/15/2025 09:00 AM` | `06/15/2025 02:00 PM` |
| datetime (end/logout) | `01/15/2025 05:00 PM` | `06/15/2025 06:00 PM` |
| boolean | `true` | `false` |
| autocomplete | `deps.{target}.name` | same |

End/logout datetimes use 5 PM to distinguish from start/login at 9 AM.

### `fillDateTime` calendar picker fails in headless mode

The original approach clicked the calendar icon button to open the MUI DateTimePicker
popup. This **fails in headless Chromium**: Cypress's synthetic `.click()` does not
give the document real focus, so MUI either never opens the picker or closes it
immediately due to blur detection. The `.MuiPickerPopper-root` element never appears
in the DOM.

```
AssertionError: Timed out retrying after 4000ms:
Expected to find element: `.MuiPickerPopper-root`, but never found it.
```

It does **not** occur in headed `cy:open` because the browser window has real focus.
**Fix**: use digit-only keyboard input (see `fillDateTime` above).

### `process.env.NODE_ENV` branches are statically fixed at Next.js build time

Next.js inlines and dead-code-eliminates `process.env.NODE_ENV` checks at build
time — a production build always resolves `NODE_ENV === 'test'` to `false`, even
when the app is actually running against the test env. Do **not** gate test-only
behavior on `NODE_ENV`; use a dedicated env var (e.g. an explicit test-mode flag
read from `.env.test`) instead, so the branch survives the production build.

### `singleSelect` display with no options

MUI DataGrid shows the raw value (the cuid) when no matching `valueOptions` entry is
found. Always ensure the parent list is passed from the page; use `valueGetter` as a
separate fallback for view mode.
