# List Page Filter/Sort: Column-Type Dispatch

## What this covers

The generated list page's server-side filter/sort (`get{Parent}Page()` in
`getters.ts.jinja2`, backed by `buildFilter`/`buildOrderBy` in
`lib/_pagination.ts`) picks the correct Prisma `where`/`orderBy` clause
shape per column, based on that column's real type — not a single
hardcoded string `contains`. It also supports filtering/sorting by an FK
display column's relation labelField, not just the FK id column itself.

## The two capabilities

### 1. Per-column clause-shape kind

Every scalar column in `FILTERABLE_FIELDS`/`SORTABLE_FIELDS` also has an
entry in a generated `FIELD_KINDS` map (`getters.ts.jinja2`), one of:

- `'string'` — the default. Unchanged behavior: a string filter value
  becomes `{ contains: value, mode: 'insensitive' }`; a non-string value
  becomes an equality match.
- `'enum'` / `'boolean'` / `'decimal'` — exact match (`{ [field]: value }`).
  Prisma's native enum, Boolean, and Decimal filters don't accept
  `contains`; Decimal is never coerced through `Number()` to avoid
  precision loss on money-scale values.
- `'number'` — parsed with `Number(value)`; the clause is dropped
  (not applied) if the result is `NaN`, rather than sending a bad value to
  Prisma.
- `'date'` — parsed with `new Date(value)`; the clause is dropped if the
  result is an Invalid Date.

`FIELD_KINDS` is derived once per entity, at generate time, in
`build_context.py`'s `_column_filter_kind()`: it reads the same
`_prisma_native_enum_type` / `_prisma_decimal_type` / `format: date-time`
markers `schema_deriver.py` already attaches to a property definition — no
new schema authoring is required for this to work on an existing column.

Dropping an unparseable `'number'`/`'date'` filter value is deliberate
fail-closed behavior: the request does not crash, but it also does not
silently apply a wrong filter — the column's clause is simply absent from
that request's `AND` list, so the other clauses (if any) still apply.

### 2. Relation display column filter/sort (via labelField)

An FK display column shown in `x-display.table` — e.g. `policy` on
`service_request`, backed by `policy_id` — filters and sorts through the
relation's own labelField column, not the FK id. This is driven by a
generated `RELATION_FILTER_FIELDS` map (`getters.ts.jinja2`):

```ts
const RELATION_FILTER_FIELDS: RelationFilterMap = {
  'requestor_role': { field: 'name' },
  'approver_role': { field: 'name' },
};
```

`buildFilter` emits a nested one-hop `contains` clause for a relation
field (`{ [field]: { [relations[field].field]: { contains: value, mode:
'insensitive' } } }`); `buildOrderBy` emits a nested `orderBy`
(`{ [field]: { [relations[field].field]: dir } }`). A relation field's
membership in `relations` does not depend on `allowed`/`FILTERABLE_FIELDS`
— relation columns were never eligible for that flat allow-list, so they
get their own gate.

**Scope**: only a relation column with a plain, single-column labelField
(no dot, e.g. `entity_name`, not `approver_role.name`) qualifies —
composite/dotted labelFields are excluded, matching the same
"simple labelField" guard `build_context.py` already uses for
searchable-relation-fields. `build_context.py` computes
`relation_filter_fields_quoted` itself, from `x-display.table` membership
and the parent's own relation list — this is *not* computed in
`generators.py`'s `page_list_context()` (which also derives relation
display formatting), because `generate.py` snapshots the render context
`getters.ts.jinja2` uses before `page_list_context()` ever runs for a
given entity; a value added there would never reach `getters.ts`.

## What is explicitly out of scope

- The MUI DataGrid filter panel's `operator` (contains/equals/is/after/
  before/...) is not forwarded to the server at all — `DataGridClient.tsx`
  only ever sends `{ field, value }`. The server always applies one fixed
  clause shape per column kind, regardless of which operator the user
  picked in the UI. Concretely: typing a partial value into an enum/date/
  number/decimal column's filter now returns zero rows instead of
  crashing — correct-but-surprising UX, not a functional defect. Wiring
  `GridColDef.type` (`singleSelect`/`date`/`number`) and the real operator
  through is a separate, larger change (new client-side column
  metadata plus a per-operator server translation) left for a later pass.
- A relation column's labelField index: today, the relation *target's*
  labelField column (e.g. `approval_flow.entity_name`) is indexed only if
  it happens to also be independently UI-exposed on the target's own list
  page (the existing UI-exposed-index rule) — nothing derives an index
  specifically because a *different* entity's relation-filter now queries
  through it. A relation-filter query against a target column with no
  independent index falls back to a sequential scan on the target table
  under load; this is a correctness-unaffected, performance-only gap, not
  covered by this change.
