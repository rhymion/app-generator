# Child DataGrid Reference Columns (Many-to-One)

## Overview

Child entities inside a parent form's DataGrid can have many-to-one relationships pointing to other entities. This article documents how those reference columns are generated, displayed, and edited — including the dual-mode pattern that handles both the editable form and the read-only view.

---

## Schema Definition

Declare the relationship on the child entity's `_id` property using `x-relationship`:

```yaml
field:
  type: object
  properties:
    reference_id:
      type:
        - string
        - "null"
      pattern: "^c[a-z0-9]{24,}$"
      x-relationship:
        type: many-to-one
        target: db_table
        labelField: name
```

- `target` — the entity whose list will populate the dropdown
- `labelField` — the field of the target entity to display as the label (defaults to `name`)

No separate `field_detail` definition is needed; the `field` entity remains a pure child of `db_table`.

---

## Generated Code Changes

### `column_def.tsx` — Dual-mode column

The generator detects `x-relationship` on child properties and produces a spread that switches behaviour based on whether options are available:

```tsx
...(referenceIdOptions && referenceIdOptions.length > 0
  ? [{ field: 'reference_id', headerName: 'Reference', width: 200,
       editable: editable, type: 'singleSelect' as const,
       valueOptions: referenceIdOptions }]
  : [{ field: 'reference_id', headerName: 'Reference', width: 200,
       editable: false,
       valueGetter: (_value: any, row: any) => row.reference?.name ?? '' }]),
```

| Mode | Condition | Behaviour |
|------|-----------|-----------|
| **Edit** | `referenceIdOptions` is non-empty | `singleSelect` dropdown; stores ID, displays label |
| **View** | No options passed | `valueGetter` reads the pre-fetched `row.reference?.name` |

The column function signature gains one parameter per relationship:

```ts
fields_columns(
  editable: boolean = false,
  referenceIdOptions?: Array<{ value: string | null; label: string }>
): GridColDef[]
```

### `getters.ts` — Nested Prisma include

For the detail query, child relations are fetched with a nested `include` instead of the plain `true`:

```ts
include: {
  fields: { include: { reference: true } },
  ...
}
```

This populates `field.reference` (the full `DbTable` object) in the returned data, which `valueGetter` relies on in view mode.

### `types.ts` — Child type and FormUpsertProps

The child type gains an optional relation object:

```ts
export type Field = {
  id: string;
  reference_id: string | null;
  reference?: DbTable | null;   // populated in detail queries
  // ...
};
```

`FormUpsertProps` gains the target list and its permissions:

```ts
export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  allDbTables?: DbTable[];
  dbTablePermissions?: ModelPermissions;
}>;
```

### `FormUpsert.tsx` — Options memo + column call

Options are built with `useMemo` **before** the column function call (ordering matters):

```tsx
const referenceIdOptions = useMemo(() =>
  (allDbTables ?? []).map(item => ({ value: item.id, label: item.name })),
[allDbTables]);

const fieldsColumns = fields_columns(true, referenceIdOptions);
```

### `FormView.tsx` — `'use client'` required

Because the column definition for view mode contains a `valueGetter` function, `FormView` must be a Client Component. The generator sets `'use client'` automatically whenever any child entity has a many-to-one relationship (or DateTime fields).

### Pages — Fetch target list

Both `new/page.tsx` and `edit/[id]/page.tsx` fetch the target entity list and pass it down:

```tsx
// edit/[id]/page.tsx
const [detail, dbTablesData] = await Promise.all([
  getDbTableDetailPageData(id, 'update'),
  getDbTableListPageData(false),
]);
return (
  <FormUpsert
    src={detail.dbTable}
    allDbTables={dbTablesData.dbTables}
    dbTablePermissions={dbTablesData.userPermissions}
    ...
  />
);
```

---

## Data Flow Summary

```
Schema (x-relationship) ──► getters.ts: nested include ──► field.reference populated

Edit page:
  allDbTables ──► FormUpsert ──► referenceIdOptions (useMemo)
                                 ──► fields_columns(true, referenceIdOptions)
                                     ──► singleSelect dropdown (stores ID)

View page:
  field.reference.name ──► valueGetter in fields_columns(false)
                           ──► plain text display (no options needed)
```

---

## Code Generator Implementation Notes

Changes made to the code generator templates in `code_generator/` (previously `utils/scripts/templates.ts`):

| Function | Change |
|---|---|
| `generateColumnDef()` | Detect `x-relationship`; emit dual-mode spread; add options param to function signature |
| `generateGetters()` | Use `{ include: { relName: true } }` for children with relationships instead of `true` |
| `generateTypes()` | Add relation object to child type; add target to `FormUpsertProps`; add target import |
| `generateFormUpsert()` | Collect child relationship targets as `selectionTargets`; emit `useMemo` options before column call |
| `generatePageNew()` / `generatePageEdit()` | Include child relationship targets in selection fetches |
| `generateFormView()` | Set `needsClientDirective = true` when any child has a many-to-one relationship |

### Why options must be declared before the column call

`referenceIdOptions` is a `const` (not hoisted). If the `fields_columns(true, referenceIdOptions)` call appeared before the `useMemo` declaration, the runtime would throw a "cannot access before initialization" error. The generator emits option setups first, then the column setup.

---

## Gotchas

- **Column header naming**: The generator strips `_id` from the property name (`reference_id` → `Reference`), matching the convention used for parent-level relationships (e.g. Procedure → Parent).
- **Self-referencing tables**: When a child references the same entity as its parent (e.g. `field.reference_id → db_table`), the `DbTable` type is already defined in the same `types.ts` file — no extra import is generated.
- **`valueGetter` and Next.js Server Components**: Functions cannot be passed as props from Server Components to Client Components. Any `FormView` that calls `fields_columns(false)` (which returns a `valueGetter`) must be marked `'use client'`.
- **`singleSelect` display with no options**: MUI DataGrid shows the raw value (the cuid) when no matching `valueOptions` entry is found. Always ensure `allDbTables` is passed from the page; the view path uses `valueGetter` as a separate fallback that avoids this.
