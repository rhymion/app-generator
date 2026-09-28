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

- `'string'` — the default. A `contains`/`equals`/`startsWith`/`endsWith`/
  `isAnyOf` clause depending on the operator the user picked (unrecognized
  operator falls back to `contains`).
- `'enum'` — validated against the column's known raw-literal member list
  (`ENUM_MEMBERS`, generate-time) before building `equals`/`not`/`in`; an
  invalid value (including the column's own translated display label, not
  just a bare typo) drops the clause instead of reaching Prisma.
- `'boolean'` — coerced to a real boolean (`v === true || v === 'true'`)
  before an `equals` clause.
- `'decimal'` — exact/comparison match. Never coerced through `Number()`
  when the incoming value is already a string (precision loss risk on
  money-scale values); when it arrived as a JS number (the `type: 'number'`
  filter's native `<input type="number">`), re-quantized via `toFixed()`
  against a generate-time `DECIMAL_SCALES` map first — a browser number
  input round-trips a typed value through an imprecise IEEE-754 double
  before this function ever sees it.
- `'number'` — parsed with `Number(value)`; the clause is dropped
  (not applied) if the result is `NaN`, rather than sending a bad value to
  Prisma.
- `'date'` — parsed with `new Date(value)`; the clause is dropped if the
  result is an Invalid Date. Covers both `format: date-time` and
  `format: date` (date-only, `@db.Date`) columns.

Every kind above except `'string'`'s fallback also honors the specific
comparison operator the user picked in the UI (`not`/`after`/`>`/`isAnyOf`/
etc) — see `docs/knowledge/list-filter-sort-typed-columns.md` for the full
per-kind operator table and the client-side `GridColDef.type`/
`valueOptions` wiring that gives each kind its real filter control (a
value dropdown, a date picker, a checkbox) instead of a plain text box.

`FIELD_KINDS` is derived once per entity, at generate time, in
`build_context.py`'s `_column_filter_kind()`: it reads the same
`_prisma_native_enum_type` / `_prisma_decimal_type` / `format: date-time`
/ `format: date` markers `schema_deriver.py` already attaches to a
property definition — no new schema authoring is required for this to
work on an existing column.

Dropping an unparseable/invalid filter value is deliberate fail-closed
behavior: the request does not crash, but it also does not silently apply
a wrong filter — the column's clause is simply absent from that request's
`AND` list, so the other clauses (if any) still apply.

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

- A relation column's labelField index: today, the relation *target's*
  labelField column (e.g. `approval_flow.entity_name`) is indexed only if
  it happens to also be independently UI-exposed on the target's own list
  page (the existing UI-exposed-index rule) — nothing derives an index
  specifically because a *different* entity's relation-filter now queries
  through it. A relation-filter query against a target column with no
  independent index falls back to a sequential scan on the target table
  under load; this is a correctness-unaffected, performance-only gap, not
  covered by this change.
