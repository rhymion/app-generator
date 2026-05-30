# Code Generation: Custom Extension Points

The code generator (under ./code_generator) overwrites most files on every run. To minimize manual re-work while still supporting entity-specific logic, four extension points have been established. Each follows the same principle: the generator produces a boilerplate file that delegates to a separate, user-maintained file that is **never overwritten**.

---

## Overview

| Extension point | File (not overwritten) | Purpose |
|---|---|---|
| Property-level custom field | `components/{entity}/{prop}.tsx` | Replace a form field with a custom UI component |
| Entity-level custom component | `components/{entity}/{ComponentName}.tsx` | Add a custom widget to the list, view, or edit page |
| Client-side form validation | `components/{entity}/form_validation.ts` | Real-time validation in FormUpsert |
| Server-side service validation | `lib/{entity}/service_validation.ts` | Pre-write validation inside DB transactions |
| Post-create hook | `lib/{entity}/service_after_create.ts` | Run logic inside the create transaction after the record is saved |

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

`components/setting/api_key.tsx` — renders the API key with a "Generate" button. The generator references it but never touches it.

---

## 2. Entity-Level Custom Components (`x-custom-components` on `_detail`)

> **Naming note.** The property-level key is `x-custom-component` (singular, one
> object); the entity-level key is `x-custom-components` (plural, **list** of
> objects). The shapes differ on purpose — an entity can mount several
> independent widgets across `list`, `view`, and `edit` pages.

### Schema config

Add `x-custom-components` to the `_detail` definition as a list. The `target` field on each
entry controls which pages render it. Default (no `target`) is `[list]` for backward
compatibility.

```yaml
# Single component on the list page only (default / backward compat).
# Plural key + list value even for a single entry.
shift_template_detail:
  x-custom-components:
    - name: CopyShiftsButton
  allOf: ...

# Single component on view + edit, with a shared component from components/_standard/.
leave_request_detail:
  x-custom-components:
    - name: ApprovalSection
      path: "@/components/_standard/ApprovalSection"   # optional; overrides default import path
      target:
        - view
        - edit
  allOf: ...

# Multiple components on one entity.
checkup_detail:
  x-custom-components:
    - name: AggregateScore
      path: "@/components/checkup/aggregate_score"
      target: [new, edit, view]
    - name: JudgeResult
      path: "@/components/checkup/judge_result"
      target: [new, edit]
    - name: CreatePDF
      path: "@/components/checkup/create_pdf"
      target: [new, edit, view]
  allOf: ...
```

The `path` option overrides the default import location (`components/{entity}/{ComponentName}`).
Use it for reusable components shared across entities that live in `components/_standard/`.

### What the generator does

- **`target: [list]`** — imports `{ComponentName}` in the list page and renders it in the button bar.
- **`target: [view]`** — imports `{ComponentName}` in `FormView.tsx` and renders `<{ComponentName} src={src} permissions={permissions} />` at the bottom.
- **`target: [edit]`** — same in `FormUpsert.tsx`.
- Multiple targets can be combined per entry; multiple entries are independent.
- The component file is **never created or overwritten**.

### Component interface

```tsx
// list target
interface Props { permissions: ModelPermissions; }

// view / edit target
interface Props {
  src: LeaveRequestDetail;        // the full entity record including nested data
  permissions?: ModelPermissions;
  currentUserRoleIds?: string[];  // role IDs of the logged-in user (fetched server-side)
  currentUserId?: string | null;  // ID of the logged-in user
}
```

`currentUserRoleIds` and `currentUserId` are fetched server-side by the generated page and forwarded
automatically to the component whenever `target` includes `view` or `edit`.

### Example

`components/shift_template/CopyShiftsButton.tsx` — list-page button to copy shift templates.
`components/leave_request/ApprovalSection.tsx` — shows approval requests with Approve/Reject buttons in view and edit pages.
`components/setting/SettingsHub.tsx` — account-settings hub (MFA + connected-accounts cards) rendered at the top of the `/setting` list page, regen-safe because it lives in `components/setting/` and is mounted via `x-custom-components`.
`components/_standard/MfaToggle.tsx` — Read-only MFA status chip on the admin user-detail (view) page. Schema config (co-exists with `SettingsHub`):

```yaml
user_detail:
  x-custom-components:
    - name: MfaToggle
      path: "@/components/_standard/MfaToggle"
      target:
        - view
```

`props.src` is typed as `{ id: string; mfa_enabled?: boolean }` (minimal interface). At runtime Prisma includes `mfa_enabled` via the `...user` spread. Component renders an MUI `Chip` (green "MFA Enabled" / neutral "MFA Disabled") — **no edit/toggle widget**. Self-service Enable/Disable lives in the `/setting/mfa` flow accessed via `SettingsHub`.

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

## 5. Post-Create Hook (`service_after_create.ts`)

Every entity with `new: true` gets an `afterCreate` call inside the Prisma `$transaction` in `service.ts`, executed after the record is created.

### Generated boilerplate (service.ts)

```ts
import { afterCreate } from './service_after_create';

export async function addLeaveRequest(...): Promise<{ id: string }> {
  return await prisma.$transaction(async (tx) => {
    await validateOnAdd(tx, { ... });
    const created = await tx.leave_request.create({
      data: { ..., approvable: { create: {} } },
      include: { approvable: true },   // present when one-to-one rels exist
    });
    await afterCreate(tx, created as Record<string, unknown>, { ...formData });
    return { id: created.id };
  });
}
```

### Generator behavior

- On first generation: writes a **no-op stub** at `lib/{entity}/service_after_create.ts`.
- On subsequent runs: stub is **never overwritten** if the file already exists.

### Stub (default)

```ts
export async function afterCreate(
  _tx: unknown,
  _created: Record<string, unknown>,
  _data: Record<string, unknown>,
): Promise<void> {}
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `tx` | `unknown` | Prisma transaction client (cast internally as needed) |
| `created` | `Record<string, unknown>` | The created record, including nested one-to-one relations when present (e.g. `created.approvable`) |
| `data` | `Record<string, unknown>` | The form data passed to the service function (keyed by schema property names) |

### Custom implementation

```ts
// lib/leave_request/service_after_create.ts
import type { PrismaClient } from '@/app/generated/prisma';

type Tx = Omit<PrismaClient, '$connect' | ...>;

export async function afterCreate(
  tx: unknown,
  created: Record<string, unknown>,
  _data: Record<string, unknown>,
): Promise<void> {
  const approvable = created.approvable as { id: string } | null | undefined;
  if (!approvable?.id) return;

  const flows = await (tx as Tx).approval_flow.findMany({
    where: { entity_name: 'leave_request' },
  });
  for (const flow of flows) {
    await (tx as Tx).approval_request.create({
      data: { approvable_id: approvable.id, approval_flow_id: flow.id, status: 0 },
    });
  }
}
```

**Note**: `afterCreate` runs inside the same `$transaction` as the parent `create`. Any error thrown will roll back the entire transaction including the parent record.

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
  service.ts                  ← overwritten by generator
  service_validation.ts       ← stub created once, never overwritten
  service_after_create.ts     ← stub created once, never overwritten (when new: true)
```
