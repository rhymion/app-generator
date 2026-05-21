# Cypress E2E Testing — Patterns & Lessons Learned

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

## UI Test Categories

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

---

## API Test Categories

Generated when `api: true && test: true` in x-generate config. Located in `cypress/e2e/api/`.
Uses `cy.request()` — no browser UI involved, reliable in headless mode.

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

### Permission testing approach
The `db:createLimitedApiUser(modelName)` task creates a user with a DenyRole that has
all permissions set to `false`. This triggers `authz.ts`'s explicit-match path (no
default grant), returning 403. The main test user has no roles → no matching records
→ default grant → 200.

API tests use `TEST_API_KEY` (defined in `cypress/support/test-credentials.ts`) which
is seeded into the test user by `seedTestDatabase()` in `db-helpers.ts`.

---

## MUI DataGrid — Hydration Timing

### Problem
Tests 1.2 and 1.3 fail intermittently because `getDataGridRowCount()` is called
immediately after `cy.visit()`. MUI DataGrid SSR rendering differs from client
rendering (virtual scrolling recalculates on mount), causing a brief React
hydration re-render that temporarily shows 0 rows.

### Solution
Always assert a named item is visible **before** checking row count:

```ts
cy.contains('Parent Only 1').should('be.visible');  // waits for stable render
getDataGridRowCount().should('eq', 1);
```

This ensures the DataGrid has fully rendered before the count assertion.

### Root cause
`DataGridClient` (`components/DataGridClient.tsx`) is `'use client'` but still SSR'd
by Next.js App Router. The `Paper sx={{ height: 500 }}` container means MUI DataGrid
cannot compute virtual scroll dimensions server-side, so it re-renders on mount.

---

## `getDataGridRowCount()` Implementation

```ts
// cypress/support/datagrid-helpers.ts
export function getDataGridRowCount() {
  return cy.get('div[role="row"][data-rowindex]').its('length');
}
```

Cypress retries the entire chain automatically. Pairing with `.should('eq', N)` is
correct — Cypress will retry until the count matches or the assertion times out.

---

## `fillDateTime` — Keyboard Input Approach

### Problem
The original approach clicked the calendar icon button to open the MUI DateTimePicker
popup, then navigated year → month → day → time → OK. This **fails in headless
Chromium** (`cy:test`): Cypress's synthetic `.click()` does not give the document
real focus, so MUI either never opens the picker or closes it immediately due to blur
detection. The `.MuiPickerPopper-root` element never appears in the DOM.

The error looks like:
```
AssertionError: Timed out retrying after 4000ms:
Expected to find element: `.MuiPickerPopper-root`, but never found it.
```

It does **not** occur in headed `cy:open` because the browser window has real focus.

### Solution
Type directly into the MUI X input. With `enableAccessibleFieldDOMStructure={false}`,
MUI X renders a single `<input>` with section-based keyboard handling. Typing digits
auto-advances through each section: MM → DD → YYYY → HH → MM → AM/PM.

```ts
Cypress.Commands.add('fillDateTime', (label: string, dateString: string) => {
  const parts = dateString.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\s+(AM|PM)$/i);
  const [, month, day, year, hour, minute, ampm] = parts!;
  const ampmChar = ampm.toUpperCase() === 'AM' ? 'a' : 'p';

  cy.contains('label', label)
    .parent()
    .find('input')
    .click()
    .type(month + day + year + hour + minute + ampmChar);
});
```

For `"01/15/2025 09:00 AM"` this types `"011520250900a"`. Works identically in
headed and headless mode — no picker popup required.

---

## Sticky Header and `scrollBehavior`

### Problem
Cypress's default `scrollBehavior` is `'top'`, which scrolls the target element to
the top of the viewport before clicking. The app has a sticky header (~48px, `z-50`).
In headless mode, elements scrolled to the very top are covered by the header, so
clicks land on the header instead of the button — **silently** (no Cypress error).

### Solution
Set `scrollBehavior: 'center'` in `cypress.config.ts`:

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

---

## Suppressing Known Next.js Uncaught Exceptions

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

---

## FK Dependency Chain in Populate Helpers

When an entity has FK relationships (e.g., booking → resource → organization), the
generator:
1. Resolves transitive dependencies via DFS
2. Creates dependencies in topological order
3. Generates a `populate{Entity}Dependencies()` function that returns all created deps
4. The test task `db:populate{Entity}Dependencies` returns the dep objects, allowing
   tests to reference `deps.resource.name` for Autocomplete selectors

---

## beforeEach Pattern

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

## GitHub Actions / CI

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
The test database is provided by `npm run docker:up` (docker-compose), which
starts Postgres on port 5432 matching `DATABASE_URL` in `.env.test`. Do **not** add
a redundant `services.postgres` block in the workflow — it runs on a different port
and is never connected to.

---

## Test Data Values

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
