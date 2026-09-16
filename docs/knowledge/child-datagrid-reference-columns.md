# Child DataGrid Reference Columns (Many-to-One)

## Overview

Child entities inside a parent form's DataGrid can have many-to-one relationships pointing to other entities. This article documents how those reference columns are generated, displayed, and edited — including the dual-mode pattern that handles both the editable form and the read-only view.

**This page was rewritten in a later code-crosscheck pass to match the current generator implementation.** The previous revision described an `allDbTables?: DbTable[]` upfront-full-list design with a plain MUI `singleSelect`/`valueOptions` dropdown; the generator has since moved to a server-side search-as-you-type design shared with the many-to-many bridge (see `docs/knowledge/MANY_TO_MANY_IMPLEMENTATION.md`), built on a shared `EntityAutocompleteCellEditor` component. The old design is gone — `grep -rn "singleSelect" code_generator/templates/` finds no hits, and no `generateColumnDef`/`generateGetters`/`generateFormUpsert`/etc. camelCase functions exist anywhere in `code_generator/` (the only surviving trace is a docstring comment in `code_generator/generate_types.py:9` noting that file "replaces the `generateTypes()` function in `templates.ts`" — a defunct pre-Python-rewrite implementation, not current code).

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

- `target` — the entity whose rows can be picked via search
- `labelField` — the field of the target entity to display as the label (defaults to `name`); may also be a composite path (multiple fields or a dotted path into a deeper relation) resolved via the generic `build_label_expression` mechanism (`code_generator/helpers/label_field.py`)

No separate `field_detail` definition is needed; the `field` entity remains a pure child of `db_table`.

---

## Generated Code Changes

### `column_def.tsx` — Dual-mode column (`code_generator/generators.py`'s `column_def_context()`, ~line 3763)

For each many-to-one property on a child, the generator emits an edit-mode branch (an `EntityAutocompleteCellEditor` cell) and a read-only fallback branch (a plain `valueGetter`), switched on whether the caller passed a config object for that column (`code_generator/generators.py:3827-3855`):

```tsx
...(referenceIdConfig
  ? [{ field: 'reference_id', headerName: t('reference'), width: 200, editable,
       renderEditCell: (params: GridRenderEditCellParams) => (
         <EntityAutocompleteCellEditor {...params} config={referenceIdConfig} />
       ),
       valueFormatter: entityAutocompleteValueFormatter(referenceIdConfig) }]
  : [{ field: 'reference_id', headerName: t('reference'), width: 200, editable: false,
       valueGetter: (_value: any, row: any) => row.reference?.name ?? '' }]),
```

(`row.reference?.name` above is the simple case — a composite/deep `labelField` renders through `build_label_expression`'s built expression instead of a plain property path.)

| Mode | Condition | Behaviour |
|------|-----------|-----------|
| **Edit** | `{prop}Config` (an `EntityAutocompleteCellConfig`) is passed in | `renderEditCell` mounts `EntityAutocompleteCellEditor`, a server-search Autocomplete (see below); `valueFormatter` resolves the stored id to a label via `config.labelLookup` |
| **View** | No config passed | `valueGetter` reads the pre-fetched `row.{relation}` (or the built composite-label expression) directly — no search, no options list |

The column function is a hook-style export, one config param per many-to-one relation on the child (`code_generator/generators.py:3940`):

```ts
export function useFieldsColumns(
  editable: boolean = false,
  referenceIdConfig?: EntityAutocompleteCellConfig,
): GridColDef[]
```

### `getters.ts` — Nested Prisma include (`code_generator/build_context.py`'s child-include builder, ~line 3213)

For the detail query, a child with its own many-to-one relation(s) is fetched with a nested `include` instead of the plain `true`:

```ts
include: {
  fields: { include: { reference: true } },
  ...
}
```

This populates `field.reference` (the full `DbTable` row) in the returned detail data, which the read-only `valueGetter` above relies on. When the relation's `labelField` walks into a deeper relation (a composite/dotted path), the include map is merged one level deeper to match (`build_context.py`'s `_merge_into_child`) — the plain single-level shape above is the common case, not the only one.

### `types.ts` — Autocomplete option props on `FormUpsertProps`

Rather than a full target list per relation, `FormUpsertProps` gains one **initial page + search callback** pair per unique target entity across *all* the parent's many-to-many fields, optional-FK lists, and embedded-child many-to-one relations combined (deduplicated by target — `code_generator/context.py`'s `all_option_targets`, `context.py:517`; rendered by `code_generator/templates/types.ts.jinja2:226-240`):

```ts
export type FormUpsertProps = Readonly<FormViewProps & {
  isEdit: boolean;
  initialDbTables?: DbTable[] & { permissionDenied?: boolean };
  initialDbTablesPermissionDenied?: boolean;
  searchDbTableOptions?: (query: string, includeIds: string[], limit?: number, context?: { callerEntity?: string; formValues?: Record<string, unknown> }) => Promise<DbTable[] & { permissionDenied?: boolean }>;
  // ...
}>;
```

There is no `allDbTables?: DbTable[]` / `dbTablePermissions?: ModelPermissions` pair — that shape does not exist in the current templates.

### `FormUpsert.tsx` — Per-relation `EntityAutocompleteCellConfig`, not a `useMemo` id/label list

For each child grid many-to-one relation, `form_upsert_context()` (`code_generator/generators.py:4549`, config-building block at `generators.py:5795-5857`) emits:

1. A `labelLookup` map (`useMemo<Map<string,string>>`) seeded from the rows already on screen (`src.{child}.{relation}`) plus the initial search page (`initial{Target}s`).
2. An `initialOptions` array (`{id, label}[]`) built from the same initial page.
3. An `EntityAutocompleteCellConfig` (`useMemo`) bundling a `searchAction` (calls `search{Target}Options`, then back-fills `labelLookup` with whatever it returns), `initialOptions`, `labelLookup`, and the field's translated `label`:

```tsx
const referenceIdConfig = useMemo<EntityAutocompleteCellConfig>(() => ({
  searchAction: async (query, includeIds) => {
    const rows = (await searchDbTableOptions?.(query, includeIds)) ?? [];
    rows.forEach(item => { referenceIdLookup.set(item.id, item.name); });
    return rows.map(item => ({ id: item.id, label: item.name }));
  },
  initialOptions: referenceIdInitialOpts,
  labelLookup: referenceIdLookup,
  label: tf('reference'),
}), [referenceIdInitialOpts, searchDbTableOptions, referenceIdLookup, tf]);

const fieldsColumns = useFieldsColumns(true, referenceIdConfig);
```

`EntityAutocompleteCellConfig` itself (the interface, plus the `EntityAutocompleteCellEditor` component and `entityAutocompleteValueFormatter` helper) is hand-written in `components/_standard/EntityAutocompleteCellEditor.tsx` — the generator only builds the per-column config values, not the editor mechanism.

### `FormView.tsx` — always `'use client'`

`code_generator/templates/form_view.tsx.jinja2` line 1 is an unconditional `'use client';` — every generated `FormView.tsx` is a Client Component regardless of whether the entity has any many-to-one child relation, DateTime field, or anything else. There is no generator branch that decides this per-entity.

### Pages — Fetch an initial search page, not the target's full list

Both `new/page.tsx` and `edit/[id]/page.tsx` fetch a small initial page (limit 50) via the target's own `search{Target}Options` server action, not a full-list getter:

```tsx
// edit/[id]/page.tsx (page_edit.tsx.jinja2)
const [detail, initialDbTables] = await Promise.all([
  getDbTableDetailPageData(id, 'update'),
  searchDbTableOptions('', [], 50),
]);
return (
  <FormUpsert
    src={detail.dbTable}
    initialDbTables={initialDbTables}
    searchDbTableOptions={searchDbTableOptions}
    ...
  />
);
```

`searchDbTableOptions` itself is passed straight through as a prop (a Server Action reference), so `FormUpsert`'s live search on the client calls back into it directly — there is no separate `dbTablePermissions`/`ModelPermissions` fetch; permission handling rides on the `permissionDenied` flag already carried by the search/initial-page result types (see `docs/knowledge/fk-read-permission-graceful-degradation.md`).

---

## Data Flow Summary

```
Schema (x-relationship) ──► getters.ts: nested include ──► field.reference populated (detail load only)

Edit page:
  searchDbTableOptions (server action) ──► page fetches initial page (limit 50) ──► FormUpsert
    ──► referenceIdConfig (useMemo: searchAction/initialOptions/labelLookup/label)
        ──► useFieldsColumns(true, referenceIdConfig)
            ──► EntityAutocompleteCellEditor (server-search Autocomplete, stores ID)

View page (or no config passed):
  field.reference ──► valueGetter in useFieldsColumns(false)
                     ──► plain text display (no search, no options)
```

---

## Code Generator Implementation Notes

The generator is Python (`code_generator/`), not the JS `templates.ts` this page described in earlier revisions. The relevant pieces:

| Concern | Where |
|---|---|
| Dual-mode column emission, per-relation config param | `code_generator/generators.py`'s `column_def_context()` (~3763), relation branch at 3827-3855 |
| `EntityAutocompleteCellConfig` construction (`labelLookup`/`initialOptions`/`searchAction`) | `code_generator/generators.py`'s `form_upsert_context()` (~4549), relation-option block at 5795-5857 |
| `initial{Target}s`/`search{Target}Options` props on `FormUpsertProps` | `code_generator/context.py`'s `all_option_targets` (~517); rendered by `code_generator/templates/types.ts.jinja2:226-240` |
| Nested detail `include` for a child's own relation | `code_generator/build_context.py`'s child-include builder (~3213-3268) |
| Initial search-page fetch + prop wiring in `new`/`edit` pages | `code_generator/templates/page_new.tsx.jinja2` / `page_edit.tsx.jinja2` |
| Composite/deep `labelField` rendering | `code_generator/helpers/label_field.py`'s `build_label_expression` |
| The editor component itself (hand-written, not generated) | `components/_standard/EntityAutocompleteCellEditor.tsx` |

### Why the config must be built before the column call

`referenceIdConfig` is a `const` (not hoisted). If `useFieldsColumns(true, referenceIdConfig)` appeared before the `useMemo` declarations it depends on, the runtime would throw a "cannot access before initialization" error. The generator emits the config/lookup `useMemo` setups first, then the column-hook call.

---

## Gotchas

- **Column header naming**: The generator strips `_id` from the property name (`reference_id` → header key `reference`, translated via `t('reference')`), matching the convention used for parent-level relationships (e.g. Procedure → Parent). Verified: `code_generator/generators.py:3829-3830` (`label_base = key.removesuffix('_id')`, `header_camel = to_camel_case(label_base)`).
- **`valueGetter` and Next.js Server Components**: Functions cannot be passed as props from Server Components to Client Components. Any `FormView`/read-only column path that returns a `valueGetter` closure must run in a Client Component — moot in practice today since `FormView.tsx` is unconditionally `'use client'` (see above).
- **No options yet (still relevant, different mechanism than before)**: `EntityAutocompleteCellEditor`'s read-mode display comes from `config.labelLookup`, which is seeded from the row's already-included relation plus the initial search page. A relation id that isn't in either (e.g. a stale id pointing at a row outside the first 50 results and not present on the row's own include) renders via `entityAutocompleteValueFormatter`'s fallback — an empty string — not the raw id. This differs from the old `singleSelect`/`valueOptions` behavior (MUI DataGrid showing the raw cuid on an unmatched value), which no longer applies to relationship columns since they no longer use `singleSelect` at all (that column type is still used for plain enum fields — `code_generator/generators.py:3886,3925` — just not for `x-relationship` columns).
