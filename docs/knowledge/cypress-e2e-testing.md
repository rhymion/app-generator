# Cypress E2E Testing — Patterns & Lessons Learned

## Overview

This project generates Cypress E2E tests automatically from YAML schema definitions.
The generator produces three kinds of files per entity:

| File | Purpose |
|---|---|
| `cypress/support/{entity}/helper.ts` | Prisma populate functions for seeding test data |
| `cypress/e2e/{entity}.cy.ts` | Test spec (6 categories, see below) |
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

## Test Categories

Each generated spec covers 6 categories:

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
  cy.visit('/');
  cy.window().then((win) => { win.sessionStorage.clear(); });
  cy.login(TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
});
```

The `cy.login` call uses `cy.session` with `cacheAcrossSpecs: true` so the
login session is shared across spec files (but cleared explicitly in `beforeEach`
via `Cypress.session.clearAllSavedSessions()`).

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
