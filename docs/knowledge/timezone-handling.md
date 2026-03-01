# Timezone Handling

## Overview

The application stores times in PostgreSQL using timezone-aware types:

- `@db.Timestamptz(0)` — full datetime with timezone (used in `shift.start_time`, `shift.end_time`)
- `@db.Timetz(0)` — time-of-day with timezone (used in `shift_template.start_time`, `shift_template.end_time`)

Both are returned by Prisma as JavaScript `Date` objects, but with an important difference in how `Timetz` values are represented.

---

## How Prisma Stores Timetz

`Timetz` values have no date component, so Prisma anchors them to the **Unix epoch (`1970-01-01`)**.

The **UTC-normalized** UTC instant is stored. For example:

| User-entered time | Stored in DB | Prisma JS Date (UTC) |
|---|---|---|
| `08:00+09:00` (8 AM JST) | `08:00:00+09:00` | `1970-01-01T23:00:00.000Z` |
| `17:00+09:00` (5 PM JST) | `17:00:00+09:00` | `1970-01-01T08:00:00.000Z` |
| `09:00+00:00` (9 AM UTC) | `09:00:00+00:00` | `1970-01-01T09:00:00.000Z` |

**Key takeaway**: `date.getUTCHours()` on a `Timetz` Date gives the UTC hour — **not** the local hour that the user originally entered. For JST (UTC+9), `8 AM` → `getUTCHours() = 23`.

### The getUTCHours() pitfall

Using `getUTCHours()` to reconstruct a shift on a local calendar date produces the wrong result:

```typescript
// Template: 08:00+09:00 (8 AM JST), stored as 1970-01-01T23:00:00Z
const h = template.start_time.getUTCHours(); // 23 — WRONG, this is the UTC hour

// Trying to create shift for Tuesday March 3:
const shiftStart = new Date(Date.UTC(2026, 2, 3, h, 0, 0));
// = 2026-03-03T23:00:00Z = 2026-03-04T08:00:00+09:00  ← Wednesday! Off by one day.
```

This also breaks overnight detection:

```typescript
// 8 AM JST stored as T23:00Z, 5 PM JST stored as T08:00Z
const isOvernight = template.start_time.getTime() > template.end_time.getTime();
// 23:00 > 08:00 → true  ← Incorrectly marked as overnight!
```

---

## Correct Pattern: Extract Local Time with Intl.DateTimeFormat

Use `Intl.DateTimeFormat.formatToParts()` to get the local hour/minute/second in the target timezone:

```typescript
function localTimeIn(date: Date, tz: string): { h: number; m: number; s: number } {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  return { h: get('hour') % 24, m: get('minute'), s: get('second') };
  // % 24 handles the edge case where midnight is returned as 24 by some engines
}
```

Usage for shift creation (in `copy-shifts.ts`):

```typescript
const startLocal = localTimeIn(template.start_time, timeZone); // { h: 8, m: 0, s: 0 }
const endLocal   = localTimeIn(template.end_time,   timeZone); // { h: 17, m: 0, s: 0 }

// Overnight detection: compare local total minutes
const isOvernight = (startLocal.h * 60 + startLocal.m) > (endLocal.h * 60 + endLocal.m);

// Apply local time to the calendar date via dayjs.tz
const shiftStart = current
  .hour(startLocal.h).minute(startLocal.m).second(startLocal.s).millisecond(0)
  .toDate();
```

Where `current` is a `dayjs.tz` object: `dayjs.tz('2026-03-03', 'Asia/Tokyo')`.

This correctly produces `2026-03-03T08:00:00+09:00` = `2026-03-02T23:00:00Z`.

---

## dayjs.tz Patterns

All timezone-aware date arithmetic uses `dayjs` with the `utc` and `timezone` plugins.

```typescript
import dayjs from 'dayjs';
import utcPlugin from 'dayjs/plugin/utc';
import timezonePlugin from 'dayjs/plugin/timezone';
dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);
```

### Iterating days in a timezone

```typescript
const startDay = dayjs.tz(startDateStr, timeZone); // midnight of startDate in tz
for (let current = startDay; !current.isAfter(endDay, 'day'); current = current.add(1, 'day')) {
  const dayOfWeek = current.day(); // 0 = Sunday in the local timezone
}
```

`current.add(1, 'day')` handles DST transitions correctly (adds a calendar day, not 86400 seconds).

### Computing day boundaries for display

```typescript
const days = Array.from({ length: 7 }, (_, i) => {
  const d = dayjs.tz(weekStart, resolvedTz).add(i, 'day');
  return {
    key: d.format('YYYY-MM-DD'),
    midnight: d.toDate(),              // UTC instant for start of this local day
    nextMidnight: d.add(1, 'day').toDate(), // UTC instant for end of this local day
  };
});
```

Bar positioning uses timestamp arithmetic against these UTC instants — fully timezone-neutral once midnights are correctly computed.

---

## Auto-detecting Browser Timezone

The browser's local timezone is available via the standard Web API:

```typescript
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
// e.g. "Asia/Tokyo", "America/New_York", "Europe/London"
```

In React components, set this on mount to avoid SSR mismatch:

```typescript
const [resolvedTz, setResolvedTz] = useState('UTC');
useEffect(() => {
  setResolvedTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
}, []);
```

The `'UTC'` fallback on the server means bars are initially rendered in UTC and then re-rendered after hydration in the correct local timezone. This produces a visible re-render (flash) if the timezone differs significantly from UTC. To eliminate this, either:
- Pass the timezone as a URL parameter (set by client JS on first visit)
- Use a cookie-based approach

---

## Displaying Times in a Specific Timezone

For display, use `Intl.DateTimeFormat` with explicit `timeZone`:

```typescript
const fmtInTz = (date: Date, tz: string) =>
  new Intl.DateTimeFormat('en', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
```

---

## Future Considerations

### Explicit timezone selection

If an explicit timezone selector is added to the UI (e.g., for admins managing shifts across regions):
- A `TimeZoneSelect` component already exists at `components/TimeZoneSelect.tsx`
- It uses `Intl.supportedValuesOf('timeZone')` with a static fallback list
- The `copyShiftTemplatesToShifts` server action already accepts a `timeZone` parameter
- The `ShiftGanttChart` client component can accept a `timeZone` prop (currently auto-detects)

### Daylight Saving Time

`dayjs.tz(...).add(1, 'day')` adds a **calendar day**, not 86400 seconds, so it correctly handles DST transitions (e.g., a day can be 23 or 25 hours long). However, there are a few edge cases to be aware of:

**Shift copy across DST boundary**

When copying shift templates that span a DST transition week:
- The `localTimeIn()` + `current.hour(h)...toDate()` approach is correct — dayjs applies the time in the local timezone for that specific date, so the UTC offset is taken from the actual calendar date.
- Example: a `08:00 JST` shift copied to a date that JST has always been `+09:00` will always produce the right UTC instant.

**Shifts with fixed-offset storage**

If a shift is stored as `2026-03-08T02:30:00-05:00` (a time that doesn't exist in America/New_York due to spring-forward), PostgreSQL will store the UTC equivalent and the offset; Prisma will return it as that UTC instant. Reading it back with `.toLocaleString()` will produce an unexpected result in the EST/EDT boundary region.

**DST wall-clock ambiguity (fall-back)**

When the clock falls back, a local time like `01:30` occurs twice. `dayjs.tz('2026-11-01', 'America/New_York').hour(1).minute(30)` resolves to the **first** occurrence (before fall-back, EDT = UTC-4). If you need the second occurrence you must use UTC-offset arithmetic directly.

These DST edge cases are unlikely to affect a Japanese deployment (JST is fixed at UTC+9 with no DST), but will matter if the application is used in North America or Europe.
