# `x-filter-values`: View-Scoped Row Restriction

## The problem it solves

Some proxy views should only ever handle a subset of the underlying model's
rows — e.g. an "active orders" view of a shared `order` model that should
never show, or be writable for, a cancelled order. Before this key existed,
that restriction had no schema-level expression: it had to be hand-built
into a custom getter/service, or (worse) left to the UI layer only, which a
direct API call could bypass entirely.

`x-filter-values` declares the restriction at the schema level and enforces
it unconditionally, server-side, across every read and write path — the
same design goal `x-self-only` (see `docs/knowledge/self-only-entity.md`)
serves for ownership. `x-filter-values` is about which *values* a row has;
`x-self-only` is about who *owns* a row. Both compose via AND with every
other row-scope condition (org isolation, `x-self-only`) — never OR.

## Schema declaration

```yaml
active_setting:
  allOf: [{ $ref: '#/definitions/setting' }]
  x-generate: { ... }
  x-filter-values:
    status: [active, pending]
    is_archived: [false]
```

Map of `field: [allowed values, ...]`. Multiple fields combine with **AND**;
multiple values for one field combine with **IN**. There is no NOT/OR form
in this initial design — add one only once a real use case needs it, not
speculatively.

Like `x-readonly-fields` (see `readonly-field-form-rendering.md`),
`x-filter-values` is entity-level metadata that stays on the view entity
that declares it. `build_user_schema.py` carries it in
`_VIEW_LEVEL_CONFIG_KEYS`, so it is never copied onto the shared raw
entity — one proxy view's declaration cannot leak onto another view of the
same underlying model. `build_context.py` reads it from
`schema['definitions'][def_key]` (the view entity's own definition,
single-level — there is no raw-entity fallback to check, since it is never
written there in the first place).

Every field named in `x-filter-values` must be an existing property on the
entity — `build_context.py` fails closed (raises `ValueError`) on an
unresolved field name at generate time, the same fail-closed posture
`x-readonly-fields` already uses for its own field-name validation.

## What "unconditional" means in the generated code

Every affected code path enforces `x-filter-values` as an unconditional
`AND` clause — no permission grant (`general`/`Creator`/`Assignee` roles)
can widen past it:

- **`getters.ts`** — `build{Entity}AccessWhere()` (covers list, export, and
  FK autocomplete/sort-filter candidate lookup — all three call this one
  function) gets the filter pushed into the same `and` array that already
  holds org isolation and `x-self-only`. `get{Entity}Detail()` (single-row
  read) has its own inline `where` clause and gets the same conditions
  added directly — a filtered-out row's detail GET returns `null` → 404,
  unifying "not found" with "not permitted," the same org-isolation/
  self-only 404 convention.
- **`search_helpers.ts`** — the cross-entity full-text search union. The
  filter is bound as a parameterized `IN (...)` clause (`Prisma.sql`/
  `Prisma.join`), never string-concatenated, matching every other
  access-scope clause already in this file. Applied both to the entity's
  own subquery and (qualified with a `parent.` prefix) to its
  no-page-children's parent-access subquery.
- **`api_detail_route.ts`** (single-item REST PUT/DELETE) and
  **`api_bulk_route.ts`** (bulk REST PUT/DELETE) — both already fetch a
  pre-image row (`existing` / `existingMap`) for their `x-self-only`/
  permission checks; `item_context_select` (the shared select clause both
  use) is extended to include the `x-filter-values` fields so no extra
  query is needed. A filtered-out pre-image row → `404 Not Found`.
- **`actions.ts`**'s `remove{Entity}` (Server Action delete) — same
  pre-image-then-filter pattern as the REST bulk delete, ANDed on top of
  the existing role-based filter.
- **`service.ts`**'s `update{Entity}` — the single place both the REST
  route and the Server Action `upsert{Entity}` funnel through for update
  (confirmed empirically: both entry points were read directly to check
  whether they call the same service function, before deciding where to
  insert the check — see the convergence-point-first procedure this repo
  already follows for cross-cutting write guards). Re-fetches the
  pre-image row and re-verifies `x-filter-values` at the actual write —
  the same defense-in-depth `x-self-only`'s `_selfOnlyExisting` check
  already does, so a caller that reaches the service layer through any
  path other than the routes above (present or future) still can't write
  a filtered-out row. `delete{Entity}` has **no equivalent internal
  check** — mirroring the existing `x-self-only` precedent, where
  `delete{Entity}` performs a bulk `deleteMany` with no per-row
  re-verification and every caller (`api_detail_route.ts`,
  `api_bulk_route.ts`, `actions.ts`) does its own independent pre-image
  fetch-and-filter before calling it. There is no existing convergence
  point for delete to hook into; the fix therefore follows the same
  three-entry-point insertion `x-self-only` already uses, rather than
  inventing a new one.

## Pre-image semantics (the write-path invariant)

A write-path check is judged against the row's state **before** the write
— the pre-image — never the incoming request body or the post-write value.
This means a legitimate transition **out of** the filtered view succeeds,
and only a row **already outside** the view is rejected:

```
View: x-filter-values: { status: [pending] }

PUT { status: approved } -> a row currently status=pending   => succeeds (pre-image was in-scope)
PUT { status: shipped }  -> a row currently status=approved  => 404 (pre-image was already out of scope)
```

This is the same pre-image discipline already established elsewhere in the
generator for hand-written pre-edit validation, which hands the
already-fetched pre-edit row to the custom-validation hook rather than
comparing against a value the write itself is about to produce.
`x-filter-values` does not introduce a new validation mechanism; it applies
that same discipline to a schema-declared row filter.

## Integration with org isolation and `x-self-only`

An entity with `organization_id`, `x-self-only`, and `x-filter-values` all
declared gets **all three** filters, composed with **AND** (never OR):
`organization_id IN (...)`, `creator_id = userId`, and every
`x-filter-values` field's `IN (...)` condition are pushed as independent
`AND` clauses (or, in `search_helpers.ts`, `AND`-joined `Prisma.sql`
fragments). None can widen access past the others.

## Validation

Field-name validation is inline in `build_context.py` (fail-closed —
raises on an unresolved property name), mirroring `x-readonly-fields`'s own
validation. There is no separate `validate.py` rule, matching precedent:
`x-readonly-fields` itself has no `validate.py`-level check either, and
adding a second, differently-timed validation path for the same fact would
duplicate logic without a concrete need driving it.

## What `x-filter-values` does not do

- It does not restrict **create** — a new row can be created with any
  value, even one outside the view's filter (it will then simply not
  appear in, or be reachable through, that view once created — read/write
  enforcement applies from that point on). Constraining create-time values
  is a separate concern (already served by `x-write-locked-values` /
  `x-approval` set_fields where applicable), not something this key adds.
- It is not a general-purpose query filter for end users — `FILTERABLE_FIELDS`/
  `buildFilter()` (the user-facing sort/filter allowlist) is unaffected and
  operates independently; `x-filter-values` is a fixed, schema-author-set
  floor beneath it, not something a caller can adjust.
