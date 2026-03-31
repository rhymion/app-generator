# Date-Only Fields and Timezone Pitfalls in Next.js + Prisma

If your application stores dates like "due date" or "birthday" — values where only the calendar date matters and time is irrelevant — you might expect them to be simpler to handle than full datetimes. In practice they carry a subtle timezone trap that causes the stored date to shift by one day depending on which hemisphere your user is in.

This article documents the problem we hit, how we diagnosed it, and the pattern we settled on.

---

## The Trap: JavaScript `Date` Is Always UTC

JavaScript's `Date` object represents a **single point in time**, always stored as milliseconds since the Unix epoch (UTC). There is no such thing as a "date without time" in JavaScript — only an instant that happens to be midnight somewhere.

PostgreSQL's `DATE` type, on the other hand, stores exactly that: a calendar date with no time and no timezone. When Prisma reads a `DATE` column, it must represent it as a JavaScript `Date`. It anchors the value to **UTC midnight**:

```
DB stores: 2026-03-25
Prisma returns: 2026-03-25T00:00:00.000Z
```

This representation is accurate — there is no information loss. But it creates a problem the moment you convert it to local time.

---

## How the Shift Happens

### On display

`dayjs("2026-03-25T00:00:00.000Z")` converts the UTC instant to the viewer's local timezone:

- **Tokyo (UTC+9):** `2026-03-25T09:00:00+09:00` → displays March 25 ✓ (correct, but shows 09:00 time)
- **California (UTC−8):** `2026-03-24T16:00:00−08:00` → displays **March 24** ✗

A user in California sees the wrong date — one day behind what was stored.

### On write

The same shift happens in reverse. The MUI X DatePicker gives back a `dayjs` object for the user's picked date in local time. When we serialize it as `dueDate.toISOString()`:

- **Tokyo:** `dayjs("2026-03-25")` = midnight JST = `2026-03-24T15:00:00.000Z` → stored as `2026-03-24` ✗
- **California:** `dayjs("2026-03-25")` = midnight PST = `2026-03-25T08:00:00.000Z` → stored as `2026-03-25` ✓

So the write bug is the mirror image of the read bug: western timezones display the wrong date, eastern timezones write the wrong date.

---

## The Fix: Local Midnight as the Bridge

The root problem is using a UTC-midnight `Date` as if it were a local date. The solution is to convert it to a **local-midnight** `Date` before handing it to any display or state code, and to serialize it as a **date-only string** on write.

### Key JavaScript fact

```js
new Date("2026-03-25")          // Date-only ISO → UTC midnight (spec-mandated)
new Date("2026-03-25T00:00:00") // Datetime without tz suffix → LOCAL midnight
```

The `'T00:00:00'` suffix (no timezone) is the bridge. It makes the browser construct midnight in the local timezone rather than UTC.

### Display: FormView and FormUpsert initial state

```tsx
// Correctly converts the UTC-midnight Date from Prisma to local midnight
const localMidnight = new Date(
  new Date(src.due_date).toISOString().slice(0, 10) + 'T00:00:00'
);
```

Step by step:
1. `new Date(src.due_date)` — handles both `Date` objects and ISO strings (Next.js serializes `Date` props to strings for client components)
2. `.toISOString()` — reliable ISO string: `"2026-03-25T00:00:00.000Z"`
3. `.slice(0, 10)` — extract the UTC date: `"2026-03-25"`
4. `+ 'T00:00:00'` — make it local midnight: `"2026-03-25T00:00:00"` → parsed as local time

In Tokyo this is `2026-03-25T00:00:00+09:00`. In California it is `2026-03-25T00:00:00−08:00`. `dayjs()` of either gives March 25. ✓

> **Why not `String(src.due_date).slice(0, 10)`?**
> `String(dateObject)` gives the browser's locale string like `"Wed Mar 25 2026 09:00:00 GMT+0900"`. Slicing that gives `"Wed Mar 25"`, not `"2026-03-25"`. Always use `.toISOString()`.

### Write: FormData submission

Instead of `dueDate.toISOString()`, use dayjs's format method:

```tsx
formData.set('due_date', dueDate?.format('YYYY-MM-DD') || '');
```

This produces the plain date string `"2026-03-25"`. On the server, `new Date("2026-03-25")` is parsed as UTC midnight per spec — exactly what the `DATE` column expects. ✓

### Component: use `DatePicker`, not `DateTimePicker`

`DateTimePicker` with `views={['year','month','day']}` (no hours/minutes) still renders the full datetime format in the text input, showing a time portion. For date-only fields, use `DatePicker`, which renders only the date format.

Since `DatePicker` receives a local-midnight `Date` (created by the conversion above), `dayjs(date_time)` inside the component correctly shows the calendar date without needing any special UTC handling inside the component itself.

---

## The Approach We Rejected

Our first attempt extracted the UTC date inside `DateTimeWrapper`:

```tsx
function toDateOnlyDayjs(date_time: Date | null) {
  if (!date_time) return null;
  return dayjs(new Date(date_time).toISOString().slice(0, 10));
}
```

This worked for loading values from the database. But it failed for user interaction: when the user picks March 25 in Tokyo, the DatePicker's `onChange` passes a dayjs object for `2026-03-25T00:00:00+09:00`. Calling `.toDate()` on that gives `2026-03-24T15:00:00.000Z`. Applying `toISOString().slice(0,10)` extracts `"2026-03-24"` — one day back. Every pick in an eastern timezone would silently decrement the date.

Manual typing made it worse: during typing the picker emits intermediate invalid `Date` values, and calling `toISOString()` on an invalid `Date` throws `"Invalid Date"`.

The lesson: **do not transform dates inside the shared component**. Transform at the call site, so the component always receives a correctly-typed value and can use `dayjs()` directly.

---

## Summary

| Concern | Pattern |
|---|---|
| Load from DB for display | `new Date(new Date(src.field).toISOString().slice(0, 10) + 'T00:00:00')` |
| Load from DB into state | `dayjs(new Date(src.field).toISOString().slice(0, 10) + 'T00:00:00')` |
| Submit to server | `dueDate?.format('YYYY-MM-DD')` |
| Component for date-only | `DatePicker` (not `DateTimePicker`) |

The pattern is consistent and works correctly in all timezones, including both JST (UTC+9) and Pacific Time (UTC−8), and handles the full editing lifecycle: initial load, user interaction, manual typing, and form submission.
