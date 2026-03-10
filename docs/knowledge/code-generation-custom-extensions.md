# Code Generation: Custom Extension Points

The code generator (`utils/scripts/generate.ts` + `templates.ts`) overwrites most files on every run. To minimize manual re-work while still supporting entity-specific logic, four extension points have been established. Each follows the same principle: the generator produces a boilerplate file that delegates to a separate, user-maintained file that is **never overwritten**.

---

## Overview

| Extension point | File (not overwritten) | Purpose |
|---|---|---|
| Property-level custom field | `components/{entity}/{prop}.tsx` | Replace a form field with a custom UI component |
| Entity-level custom component | `components/{entity}/{ComponentName}.tsx` | Add a custom button/widget to the list page |
| Client-side form validation | `components/{entity}/form_validation.ts` | Real-time validation in FormUpsert |
| Server-side service validation | `lib/{entity}/service_validation.ts` | Pre-write validation inside DB transactions |

---

## 1. Property-Level Custom Field (`x-custom-component` on a property)

### Schema config

Add `x-custom-component` to a property definition in `json_schema_db_table.yaml`:

```yaml
api_key:
  type: string
  x-custom-component:
    target:
      - upsert      # appears in FormUpsert (omit for view-only)
      - view        # appears in FormView  (omit for upsert-only)
```

### What the generator does

- **FormUpsert**: skips generating a `TextField` for that property; instead imports `ApiKey` from `./api_key` and renders `<ApiKey value={apiKey} onChange={setApiKey} />`. State is managed with `useState<string>` and included in `formData.set(...)`.
- **FormView**: same pattern but renders `<ApiKey value={src.api_key} />` (read-only).
- The component file (`components/{entity}/{prop}.tsx`) is **never created or overwritten** by the generator.

### Component interface

```tsx
// For upsert target:
interface Props { value: string; onChange: (v: string) => void; }

// For view target:
interface Props { value: string; }
```

### Example

`components/user_account/api_key.tsx` — renders the API key with a "Generate" button. The generator references it but never touches it.

---

## 2. Entity-Level Custom Component (`x-custom-component` on `_detail`)

### Schema config

Add `x-custom-component` to the `_detail` definition:

```yaml
shift_template_detail:
  x-custom-component:
    name: CopyShiftsButton
  allOf:
    - ...
```

### What the generator does

- **List page** (`app/[locale]/{entity}/page.tsx`): imports `CopyShiftsButton` from `@/components/{entity}/CopyShiftsButton` and renders it in the button bar alongside the chart button (if any).
- The component file is **never created or overwritten**.

### Component interface

```tsx
interface Props { permissions: ModelPermissions; }
```

The component receives the current user's permissions so it can conditionally enable/disable actions.

### Example

`components/shift_template/CopyShiftsButton.tsx` — opens a dialog to copy shift templates to actual shifts for a selected date range.

---

## 3. Client-Side Form Validation (`form_validation.ts`)

Every entity with `new` or `edit` enabled gets a `useFormValidation` hook called from its FormUpsert. This handles real-time feedback to the user before submission.

### Generated boilerplate (FormUpsert)

```tsx
import { useFormValidation } from './form_validation';

// Inside component:
const validationError = useFormValidation({
  isEdit,
  id: src.id,
  resource_id: resourceId,   // all reactive (useState) values
  start_time: startTime,     // keyed by schema property name
  end_time: endTime,
});

// In JSX:
{validationError && <p style={{ color: 'red' }}>{validationError}</p>}
```

### Generator behavior

- On first generation: writes a **no-op stub** at `components/{entity}/form_validation.ts`.
- On subsequent runs: stub is **never overwritten** if the file already exists.

### Stub (default)

```ts
export function useFormValidation(_values: Record<string, unknown>): string | null {
  return null;
}
```

### Custom implementation

The hook receives all `useState`-based form values (datetimes, relationship IDs, booleans, enums, custom props) plus `isEdit` and `id`. Text/number fields use refs and are not included since they don't trigger reactive re-renders.

```ts
// components/booking/form_validation.ts
import { useState, useEffect } from 'react';
import { checkBookingOverlap } from '@/lib/booking/service_validation';
import type { Dayjs } from 'dayjs';

export function useFormValidation(values: Record<string, unknown>): string | null {
  const [error, setError] = useState<string | null>(null);
  const { resource_id, start_time, end_time, isEdit, id } = values as { ... };

  useEffect(() => {
    if (!resource_id || !start_time || !end_time) { setError(null); return; }
    if (start_time.isAfter(end_time) || start_time.isSame(end_time)) {
      setError('Start time must be before end time');
      return;
    }
    const excludeId = isEdit ? id : null;
    checkBookingOverlap(resource_id, start_time.toISOString(), end_time.toISOString(), excludeId)
      .then(hasOverlap => setError(hasOverlap ? 'Booking overlaps with existing booking' : null))
      .catch(() => setError(null));
  }, [resource_id, start_time, end_time, isEdit, id]);

  return error;
}
```

**Note**: `checkBookingOverlap` is a Server Action defined in `lib/booking/service_validation.ts`, callable from client components.

---

## 4. Server-Side Service Validation (`service_validation.ts`)

Every entity with `new` or `edit` enabled gets `validateOnAdd`/`validateOnUpdate` calls inside the Prisma transaction in `service.ts`. This is the authoritative validation — it runs even for API calls, not just UI submissions.

### Generated boilerplate (service.ts)

```ts
import { validateOnAdd, validateOnUpdate } from './service_validation';

export async function addBooking(creatorId: string, name: string, resourceId: string, startTime: Date, endTime: Date) {
  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, {
      name: name,
      resource_id: resourceId,
      start_time: startTime,
      end_time: endTime,
    });
    return await tx.booking.create({ data: { ... } });
  });
}
```

Data is passed as `Record<string, unknown>` keyed by **schema property names** (snake_case). Values use the service function's parameter types (`Date` for datetime fields, not `Dayjs`).

### Generator behavior

- On first generation: writes a **no-op stub** at `lib/{entity}/service_validation.ts`.
- On subsequent runs: stub is **never overwritten** if the file already exists.

### Stub (default)

```ts
export async function validateOnAdd(_tx: unknown, _data: Record<string, unknown>): Promise<void> {}

export async function validateOnUpdate(_tx: unknown, _id: string, _data: Record<string, unknown>): Promise<void> {}
```

### Custom implementation

```ts
// lib/booking/service_validation.ts
export async function validateOnAdd(_tx: unknown, data: Record<string, unknown>): Promise<void> {
  const { resource_id, start_time, end_time } = data as {
    resource_id: string; start_time: Date; end_time: Date;
  };
  if (!resource_id || !start_time || !end_time) return;
  if (start_time >= end_time) throw new Error('Start time must be before end time');
  await assertNoBookingOverlap(prisma, resource_id, start_time, end_time);
}

export async function validateOnUpdate(_tx: unknown, id: string, data: Record<string, unknown>): Promise<void> {
  // Same but passes id as excludeId for the overlap check
}
```

The `tx` parameter is typed as `unknown` to avoid coupling the validation file to the generated `TransactionClient` type. Cast it internally if transaction-scoped queries are needed.

---

## Relationship Between Client and Server Validation

For the booking entity, both `form_validation.ts` and `service_validation.ts` check overlap, but serve different roles:

| | `form_validation.ts` | `service_validation.ts` |
|---|---|---|
| **When** | On every state change (real-time) | Inside the DB transaction (on submit) |
| **Input** | Dayjs values from `useState` | Date values from service function params |
| **On error** | Displays message, does not block submit | Throws — transaction rolled back |
| **Covers API calls** | No | Yes |

The client-side check is UX; the server-side check is the enforcement layer.

---

## File Naming Summary

```
components/{entity}/
  FormUpsert.tsx          ← overwritten by generator
  FormView.tsx            ← overwritten by generator
  form_validation.ts      ← stub created once, never overwritten
  {prop}.tsx              ← never touched by generator (type-a custom field)
  {ComponentName}.tsx     ← never touched by generator (type-b entity component)

lib/{entity}/
  service.ts              ← overwritten by generator
  service_validation.ts   ← stub created once, never overwritten
```
