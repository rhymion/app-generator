# MUI X DateTimePicker — Cypress Testing & Configuration

## Version Context

- `@mui/x-date-pickers: ^8.26.0` (MUI X v8)
- `@mui/x-data-grid: ^8.25.0`

---

## DateTimePicker Configuration (`DateTimeWrapper.tsx`)

### Key settings applied

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

### `{...other}` spread order

`{...other}` comes **after** `slotProps` in the JSX, so any `slotProps` passed via
`other` would override ours. In practice, callers only pass `onChange`, `readOnly`,
or `disabled` — not `slotProps` — so this is safe.

---

## Cypress Commands: `fillDateTime`, `fillDate`, `fillTime`

### Approach: digit-only keyboard input (no calendar picker UI)

With `enableAccessibleFieldDOMStructure={false}`, MUI X exposes a single `<input>`
with a **sectioned masked format** (`MM/DD/YYYY hh:mm aa`). Typing digits directly
into this input causes MUI X to auto-advance through sections automatically:
`MM → DD → YYYY → HH → MM → AM/PM`.

The calendar picker UI is **not used** — it is unreliable in headless Chromium.

### Input sequence

| Command | Type into input |
|---|---|
| `fillDateTime` | `month + day + year + hour + minute + ampmChar` (e.g. `011520250900a`) |
| `fillDate` | `month + day + year` (e.g. `01152025`) |
| `fillTime` | `hour + minute + ampmChar` (e.g. `0900a`) |

`ampmChar`: `'a'` for AM, `'p'` for PM.

### DOM detachment on focus — broken chain pattern

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

### `fillDateTime` implementation

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

### Debugging tip: `assert(false)` masks the real error

`assert(false)` throws synchronously and aborts the Cypress command queue,
so any queued `cy.type()` / `cy.click()` failure never runs. You only see
the AssertionError, not the underlying CypressError. To bisect a failing step,
remove cy commands from the **end** of the test one at a time.

### `clearDateTime` command

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

---

## MUI DataGrid — Hydration Issue

### Root cause

`DataGridClient` is a `'use client'` component that still gets SSR'd by Next.js
App Router. The `Paper sx={{ height: 500 }}` container means MUI DataGrid cannot
compute virtual scroll dimensions during SSR, so it re-renders on client mount.
React logs "Hydration failed" and does a full client re-render.

### Impact on tests

`getDataGridRowCount()` — which uses `cy.get('div[role="row"][data-rowindex]')` —
can see 0 rows if it fires during the re-render window.

### Fix

Assert that a known data item is visible **before** checking row count:

```ts
cy.contains('Parent Only 1').should('be.visible');  // waits for stable hydration
getDataGridRowCount().should('eq', 1);
```

### Permanent fix options (not yet applied)

- Use `dynamic(() => import('./DataGridClient'), { ssr: false })` in each page
  to skip server-rendering the DataGrid (eliminates hydration entirely).
- Serialize `Date` fields to ISO strings before passing as props to client
  components (reduces hydration surface area).

---

## DateTimePicker in `FormView` (read-only)

`FormView` passes `readOnly` to `DateTimeWrapper`:

```tsx
<DateTimeWrapper label="Login Time" date_time={src.login_time} readOnly />
```

MUI DateTimePicker respects `readOnly={true}`:
- The field is non-editable
- The clear button (`clearable: true`) is automatically hidden
- No UI changes needed in `FormView`
