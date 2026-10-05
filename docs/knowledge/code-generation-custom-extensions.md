# Code Generation: Custom Extension Points

The code generator (under ./code_generator) overwrites most files on every run. To minimize manual re-work while still supporting entity-specific logic, extension points have been established. Each follows the same principle: the generator produces a boilerplate file that delegates to a separate, user-maintained file that is **never overwritten**.

A fifth extension point, the post-create hook (`lib/{entity}/service_after_create.ts`, an
`afterCreate(tx, entityId)` call inside `service.ts`'s create transaction), was retired once --
approval-request creation, its original consumer, moved to inline edge-trigger code in
`service.ts.jinja2` (see `docs/knowledge/appendix/approval-flow.md` §16.4) -- and later reinstated
as a general-purpose, no-op-by-default hook for arbitrary post-create side effects, unrelated to
approval-request creation (which still lives entirely in the edge-trigger code). See
`docs/knowledge/post-create-side-effect-hook.md` for the current contract: called in-tx, a throw
rolls back the whole create.

---

## Overview

| Extension point | File (not overwritten) | Purpose |
|---|---|---|
| Property-level custom field | `components/{entity}/{prop}.tsx` | Replace a form field with a custom UI component |
| Entity-level custom component | `components/{entity}/{ComponentName}.tsx` | Add a custom widget to the list, view, or edit page |
| Server-side service validation | `lib/{entity}/service_validation_custom.ts` | Pre-write validation inside DB transactions |
| Test-helper dependency values | `cypress/support/{entity}/helper_custom.ts` | Hand-written column values for the dependency rows a generated test helper creates |

`components/{entity}/form_validation.ts` is generated output, not an extension point: see section 3.

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

### Upsert-only fields are treated as write-only

A string property whose `x-custom-component.target` includes `upsert` but
omits `view` (e.g. `password`, `api_key`) is a write-only field:
`is_write_only_prop()`/`get_write_only_field_names()`
(`code_generator/helpers/schema_helpers.py`) is the single predicate that
drives every read path an entity has — `get{Parent}Detail()`
(`getters.ts.jinja2`) destructures the field out of the raw Prisma row
before the REST API JSON response or the view page's server data can ever
see it, and the same field name is excluded from `FormView`, the CSV export
allowlist, and the sort/filter allowlists.

This predicate must be evaluated against the entity's **full** property set
(`model_def.get('properties', {})` in `build_context.py`/`generators.py`),
not `filtered_props` (the subset narrowed by `x-generate.fields`). The
`get{Parent}Detail()` Prisma query has no `select` clause — it fetches
every column on the row regardless of `x-generate.fields` — so an entity
whose `fields` allowlist happens to omit a write-only column (this repo's
own `user` entity: `fields: [name, image_id, roles]`, password/api_key
excluded) would otherwise compute an empty write-only set and let the
unconditional `...{{ parent_camel }}` spread return the raw password hash
and api_key straight through `GET /api/user/{id}`. Confirmed by curl
(subtask_810e, 2026-08-25) and fixed by switching both call sites from
`filtered_props` to `model_def.get('properties', {})`.

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
`components/_standard/MfaToggle.tsx` — Read-only MFA status chip on the admin user-detail (view) page. Schema config:

```yaml
user_detail:
  x-custom-components:
    - name: MfaToggle
      path: "@/components/_standard/MfaToggle"
      target:
        - view
```

`props.src` is typed as `{ id: string; mfa_enabled?: boolean }` (minimal interface). At runtime Prisma includes `mfa_enabled` via the `...user` spread. Component renders an MUI `Chip` (green "MFA Enabled" / neutral "MFA Disabled") — **no edit/toggle widget**. Self-service Enable/Disable lives in the `/setting/mfa` flow accessed from the handwritten `/setting` page.

> **Note:** `components/setting/SettingsHub.tsx` was abolished (Option B). The `/setting` page is now a committed handwritten `app/[locale]/setting/page.tsx` (not generated). The `setting` entity uses `list: false` in `json_schema.yaml` to prevent overwriting.

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

- Every run writes `components/{entity}/form_validation.ts` with `_write()`, rendered from the schema (required-field and decimal checks). The file is **overwritten on every run**, so a hand edit is lost; it is not write-once.
- Hand-written server-side rules belong in `lib/{entity}/service_validation_custom.ts` (section 4), which the generator never overwrites.

### Generated body (default shape)

```ts
export function useFormValidation(_values: Record<string, unknown>): string | null {
  return null;
}
```

### Custom implementation

The generator overwrites this file, so the example below shows the shape of the hook only; it is not kept across runs.

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

## 4. Server-Side Service Validation (`service_validation_custom.ts`)

**This section describes an earlier design; the actual extension point moved
to a separate file.** `lib/{entity}/service_validation.ts` is itself
generator output, **fully overwritten on every `generate-code` run**
(`generate.py` writes it via `_write()`, not the write-once `_write_stub()`
path) — it holds the schema-driven checks (`REQUIRED_FIELDS`/
`DECIMAL_FIELDS`/one-to-one-relation checks, all derived straight from
`json_schema.yaml`) and exports `validateOnAdd(tx, data, actorId)` /
`validateOnUpdate(tx, id, data, prevRow, actorId)`, both called from the
Prisma transaction in `service.ts`. Editing this file directly is lost on
the next regeneration.

The actual **never-overwritten** extension point is
`lib/{entity}/service_validation_custom.ts`
(`service_validation_custom_stub.ts.jinja2`, written once via `_write_stub()`
— same skip-if-exists convention as `autocomplete_filter.ts`). Both
`validateOnAdd`/`validateOnUpdate` call its single export,
`validateCustomRules`, unconditionally, after the generated schema-driven
checks:

```ts
export async function validateCustomRules(
  _tx: unknown,
  _data: Record<string, unknown>,
  _currentId: string | null,
  _prevRow: Record<string, unknown> | null,
  _actorId: string,
): Promise<void> {}
```

- `data` — the raw create/update payload, keyed by schema property names.
- `currentId` — `null` on create, the row id on update.
- `prevRow` — the full row as it stood *before* this write (`null` on
  create) — see `docs/knowledge/pre-edit-row-handoff-to-custom-validation.md`.
- `actorId` — the id of the user performing the write, never `null` — see
  `docs/knowledge/actor-id-handoff-to-custom-validation.md`.
- Throwing rejects the save; the message surfaces to the caller (UI form or
  direct API request) alike, since this hook runs for both entry points.
- To show a specific, translated reason on the form, throw an `AppError` with a
  namespace-qualified message key as its fifth argument (and optional values as the
  sixth): `throw new AppError('VALIDATION', 'internal note', 'order_type', undefined,
  'ValidationMessages.orderHasLines')`. Add the key to the `ValidationMessages`
  namespace of the consumer's `prj/messages/en.json` and `ja.json`. A missing key shows
  the generic text. The REST error body carries the key too. See "Hand-written
  rejections with a message key" in `docs/knowledge/error-message-framework.md`.

Full design rationale (why this is a hand-written socket rather than a
schema-declared mechanism, and the self-referential-m2m case that motivated
it) is in `docs/knowledge/same-entity-validation-socket.md` — that is the
canonical doc for this extension point; treat the summary above as a pointer
to it, not a duplicate source of truth.

---

## 5. Test-Helper Dependency Values (`helper_custom.ts`)

`cypress/support/{entity}/helper.ts` is overwritten on every run. It creates the
parent rows (dependencies) its entity needs, with each column's default value. A
consumer whose business rules constrain a dependency row (for example a parent
whose type column must hold a particular value, while the column's default stays
unchanged for end users) hand-writes only those values in
`cypress/support/{entity}/helper_custom.ts` and keeps generating the whole helper.

### Where the file lives

- The generator writes a stub with `_write_stub()` the first time, for every entity generated with `test: true`. It has no `AUTO-GENERATED` marker, so the orphan sweep in `cleanup.py` never removes a customized copy. An entity whose helper is hand-written and tracked (`audit_log`) gets no stub.
- That file is in the generator tree, which is gitignored there and is not the consumer's repository. A consumer keeps its copy at `prj/cypress/support/{entity}/helper_custom.ts`; `prj:sync` copies it to the same relative path before `generate-code`, and the write-once stub is then left alone. Edits made only under the generator tree are lost on a fresh checkout.
- A second `generate-code` run keeps an edited file. An untouched stub is deleted by `cleanup` and written again.

### Contract

```ts
import type { DependencyKey } from './helper';

export function dependencyValues(
  key: DependencyKey,
  defaults: Record<string, unknown>,
): Record<string, unknown>;
```

- `DependencyKey` is `'<target model>.<dependency name>'`, for example `'step.step'` or `'step.placedStep'`. The name is the dependency's variable name: the foreign-key property stem when two or more foreign keys point at one model, otherwise the target. `helper.ts` exports the union of every key it uses, so a mistyped key fails the type check.
- The same key applies to every copy of that dependency in the helper: the plain create, the second instance, the per-row copies created in `populate<Entity>Data` / `populate<Entity>FullData`, the nested copies, and the find-or-create lookup.
- Before each create, `helper.ts` calls `dependencyValues(key, defaults)` with the columns it would write and creates the row with what comes back. Returning `defaults` keeps the generated behavior, which is what the stub does.
- Before each find-or-create lookup, it calls the hook with the lookup columns as `defaults` and uses the result as the `where`. A row that only matches the default value is therefore not reused when the hook changes that column.
- The hook applies only to dependencies created by this entity's helper. A dependency created inside another entity's helper needs the same rule in that helper's `helper_custom.ts`.
- The hook changes dependency values only. The helper's exported names are unchanged and may be relied on by hand-written specs: `populate<Entity>Dependencies`, `populate<Entity>Data`, `populate<Entity>FullData`, `_reset<Entity>CallSeq` (when generated), `populate<Entity><Child>Data`, `populate<Entity>With<Rel>Data`, `setup<Entity>ApprovalFlow`, and the approval and mention variants. Do not rename them.

### Fail-closed rules

`cypress/support/dependency-values.ts` checks what the hook returns and throws, naming the key and the column:

- a column that was not supplied must be a plain column of the dependency's model (not a foreign key, relation or system column);
- a supplied foreign-key or system column may not be changed or removed;
- a non-object result is rejected.

A removed or renamed hook file, or a changed `DependencyKey` export, fails `tsc` / `next build`; Cypress itself loads the helper without a type check, so the failure shows at build time.

### Example

```ts
// prj/cypress/support/step_placement/helper_custom.ts
import type { DependencyKey } from './helper';

export function dependencyValues(
  key: DependencyKey,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  if (key === 'step.step') return { ...defaults, step_type: 'composite' };
  return defaults;
}
```

The fixture entity `hook_slot` in `code_generator/tests/fixtures/child_datagrid_e2e_gate/` exercises this (`custom_helper/hook_slot.ts`, spec `helper_custom_dependency_values.cy.ts`).

### Entities with `x-exclusive-parents`

The generated helper rows, API create bodies and form fills of a child that declares `x-exclusive-parents` write exactly one owner: the owner column of the first declared parent that has a resolvable column, treated as a required field. The other owner columns are not written, so the save-time validator (`lib/{entity}/exclusive_parents.ts`) accepts the generated PUT and create requests. Entities without the declaration generate the same files as before.

---

## Relationship Between Client and Server Validation

For the booking entity, both `form_validation.ts` and `service_validation_custom.ts` check overlap, but serve different roles:

| | `form_validation.ts` | `service_validation_custom.ts` |
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
  form_validation.ts      ← overwritten by generator (schema-derived checks)
  {prop}.tsx              ← never touched by generator (type-a custom field)
  {ComponentName}.tsx     ← never touched by generator (type-b entity component)

lib/{entity}/
  service.ts                  ← overwritten by generator
  service_validation.ts       ← overwritten by generator (schema-driven checks; calls into service_validation_custom.ts)
  service_validation_custom.ts ← stub created once, never overwritten
  service_after_create.ts     ← stub created once, never overwritten (written whenever this lib dir is the model's own, regardless of can_new/can_create)

cypress/support/{entity}/
  helper.ts                   ← overwritten by generator
  helper_custom.ts            ← stub created once, never overwritten (one per test entity)
```
