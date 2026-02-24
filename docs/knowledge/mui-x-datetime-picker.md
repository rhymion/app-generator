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

## Cypress Command: `fillDateTime`

### Why keyboard input alone fails

With `enableAccessibleFieldDOMStructure={false}`, the picker input uses a
**sectioned masked format** (`MM/DD/YYYY hh:mm aa`). Typing the full formatted
string (`01/15/2025 09:00 AM`) causes problems because:
- `.clear()` → `{ctrl+a}{del}` can leave the cursor at the last section
- Separator characters (`/`, `:`, space) are interpreted inconsistently across
  MUI versions when typed into the masked input

### Calendar-based approach (current implementation)

`fillDateTime` opens the picker calendar UI and interacts step-by-step:

```
1. Click calendar-open button (last button in field = open, after optional clear)
2. Click month/year header → year-picker view
3. Click target year → month-picker view
   (MUI shows month picker because 'month' is in the views array)
4. Click target month → day-calendar view
5. Click the target day — simple text match on day number
6. Select hours via scroll list (ul[aria-label="Select hours"])
7. Select minutes via scroll list (ul[aria-label="Select minutes"])
8. Select AM/PM via scroll list (ul[aria-label="Select meridiem"])
9. Click OK to confirm
```

### Why not use Prev/Next month arrows for navigation

The Prev/Next month arrows (`[aria-label="Previous month"]`) are only visible in
**day-calendar view**. In year-picker and month-picker views they are absent.
After clicking the year header to enter year-picker view, the arrows disappear.
Using year → month → day picker steps avoids any need to navigate with arrows.

### Time picker: scroll lists, not keyboard input

MUI X v8 DateTimePicker time selection uses **scroll-list UI** — three vertical
lists for hours, minutes, and meridiem. Each is a `<ul>` element. There is no
keyboard text input for time in the default picker UI.

> Attempting to click `button[aria-label="edit time"]` to switch to a digital
> keyboard input is unreliable. Use the scroll lists instead.

### MUI X v8 selector reference

| Element | Selector |
|---|---|
| Picker popup | `.MuiPickerPopper-root` |
| Calendar header label | `.MuiPickersCalendarHeader-label` |
| Year calendar | `.MuiYearCalendar-root button` |
| Month calendar | `.MuiMonthCalendar-root [aria-label="{MonthName}"]` |
| Day button | `.MuiPickersDay-root` + `.contains(String(day))` |
| Hours scroll list | `ul[aria-label="Select hours"]` |
| Minutes scroll list | `ul[aria-label="Select minutes"]` |
| AM/PM scroll list | `ul[aria-label="Select meridiem"]` |
| Confirm button | `button` containing text `OK` |
| Clear button | `button[title="Clear"]` |

> **Note:** The popup class is `.MuiPickerPopper-root` (no `s` after `Picker`).
> Do not confuse with `.MuiPickersPopper-root` — that selector does not match.

> **Note:** These selectors target MUI X v8 with default English locale and
> `enableAccessibleFieldDOMStructure={false}`. If MUI changes its rendering or
> you change locale, some selectors may need adjustment.

### `fillDateTime` implementation

```ts
const PICKER_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

Cypress.Commands.add('fillDateTime', (label: string, dateString: string) => {
  const parts = dateString.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (!parts) throw new Error(`fillDateTime: Expected "MM/DD/YYYY HH:MM AM/PM", got "${dateString}"`);
  const [, month, day, year, hour, minute, ampm] = parts;

  const targetYear = parseInt(year);
  const targetMonth = parseInt(month);
  const targetDay = parseInt(day);
  const targetMonthName = PICKER_MONTH_NAMES[targetMonth - 1];

  // 1. Open picker (last button in field, after optional Clear button)
  cy.contains('label', label).parent().find('button').last().click();
  cy.get('.MuiPickerPopper-root').should('be.visible');

  // 2. Click month/year header → year-picker view
  cy.get('.MuiPickersCalendarHeader-label').click();

  // 3. Click year → month-picker view
  cy.get('.MuiYearCalendar-root button').contains(String(targetYear)).scrollIntoView().click();

  // 4. Click month → day-calendar view
  cy.get(`.MuiMonthCalendar-root [aria-label="${targetMonthName}"]`).click();

  // 5. Click day (text match — aria-label format varies by locale)
  cy.get('.MuiPickersDay-root').contains(String(targetDay)).click();

  // 6-8. Select time via scroll lists
  cy.get('.MuiPickerPopper-root').find('ul[aria-label="Select hours"]').children().contains(hour).scrollIntoView().click();
  cy.get('.MuiPickerPopper-root').find('ul[aria-label="Select minutes"]').children().contains(minute).scrollIntoView().click();
  cy.get('.MuiPickerPopper-root').find('ul[aria-label="Select meridiem"]').children().contains(ampm).click();

  // 9. Confirm
  cy.get('.MuiPickerPopper-root').contains('button', 'OK').click();
});
```

### Why year → month → day (not Prev/Next arrows)

An earlier approach tried to navigate using `[aria-label="Previous month"]` /
`[aria-label="Next month"]` arrows after clicking the year in the year picker.
This fails because:
- Clicking the calendar header switches to **year-picker view**
- Clicking a year switches to **month-picker view** (when `'month'` is in `views`)
- Prev/Next month arrows are only rendered in **day-calendar view**
- They are absent in year-picker and month-picker views

The fix: click year → click month → both are one-click selections, landing
directly on the correct day-calendar view with no arrow navigation needed.

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
