# List Page Filter: Real Per-Column-Type Controls and Operators

## What this covers

A generated list page's column filter presents the actual control that
fits the column's real type — a value dropdown for enum, a date/datetime
picker, a checkbox for boolean, a number box for number/decimal — and
honors the specific operator the user picks (`is`/`not`/`isAnyOf`/`after`/
`before`/`>`/`>=`/...), instead of a plain text box that only ever supports
one fixed clause shape per column kind. See
`docs/knowledge/list-filter-sort-column-type-dispatch.md` for the
per-column clause-shape kind (`FIELD_KINDS`) and relation-labelField
filtering this builds on.

## Client side: `GridColDef.type` / `valueOptions`

`page_list_context()`'s `xdisplay_table` loop (`generators.py`) emits, per
displayed column, whichever of these fits the column's real kind:

- Native/numeric enum: `type: 'singleSelect'` and `valueOptions: [{ value,
  label }, ...]`, built directly from the same `entries` list already
  computed for the cell's own display formatting (`{var_name}Labels`) —
  the filter dropdown's labels are guaranteed to match the cell's
  displayed label, since both read the same source.
- Boolean: `type: 'boolean'`.
- Date-only (`format: date`): `type: 'date'`. Date-time
  (`format: date-time`) and time-only (`format: time`, Prisma `DateTime
  @db.Timetz`): `type: 'dateTime'` — MUI's DataGrid has no dedicated
  time-only `GridColDef` type, so a time column reuses `dateTime` (the
  same fallback already used elsewhere in this generator for the
  independent/embedded DataGrid-child context). The date component the
  picker attaches is a non-issue at the server side: see the operator
  table below.
- Number/Decimal: `type: 'number'`.
- FK relation display column (simple labelField): left unset, deliberately
  out of scope — a relation's value space is the target table's rows, a
  materially different (async-autocomplete) feature, not a natural
  extension of this one.

`DataGridClient.tsx`'s `DisplayFieldConfig<T>` interface carries `type`/
`valueOptions` through to the underlying `GridColDef`. Two MUI defaults
had to be explicitly neutralized once a real `type` was wired:

- **`type: 'boolean'`'s cell renders from `params.value` directly** (not
  `formattedValue`), so the column's `valueGetter` must pass the raw
  boolean through unchanged for that kind — the generic fallback that
  stringifies every other kind's value would make every row's icon render
  "true" (a non-empty string is truthy) regardless of the real value.
- **`type: 'singleSelect'`/`'date'`/`'dateTime'`'s own default
  `valueFormatter`** assumes it's looking at the *raw* underlying value
  (an enum's raw literal to map to a label; a real `Date` instance) — but
  this component's own `valueGetter`/upstream `formatting_entries`
  mechanism already pre-formats the cell to its final display value (a
  translated enum label string; a formatted date string) before this
  component ever sees it. Left alone, MUI's default `valueFormatter`
  either throws (`'date'`/`'dateTime'`: "only accepts Date objects") or
  silently renders blank text (`'singleSelect'`: its value-to-label
  lookup never matches an already-translated string). An identity
  `valueFormatter` (`(value) => value ?? ''`) is set for these three kinds
  to keep exactly what this component's own value pipeline already
  computed.

`ResponsiveListClient.tsx`/`CardListClient.tsx` also declare `type`/
`valueOptions` on their own local `DisplayFieldConfig<T>` copies purely so
the shared object literal `page_list.tsx.jinja2` emits type-checks
regardless of which `list_component` an entity is configured to use;
`CardListClient` never reads them (no MUI filter panel in the card
layout).

## Server side: `buildFilter`'s per-kind operator table

`DataGridClient.tsx`'s `reload()` forwards the MUI filter panel's real
`GridFilterItem.operator` (previously discarded) as
`{ [field]: { operator, value } }`. `FilterMap`'s value type widens to
`FilterValue | { operator: string; value: FilterValue | FilterValue[] }`
(`lib/_pagination.ts`) — `value` is an array only for `isAnyOf`. This is
the backward-compatibility hinge: `parsePageOpts()` (REST route handlers)
still produces bare scalars from `?f.field=value` query params — no
URL-param format change — and `buildFilter` normalizes both shapes
through the same `normalizeFilterEntry()` before dispatching.

`buildFilter`'s per-kind operator table (an unrecognized/absent operator
always falls back to that kind's own pre-#756 default clause — never a
new crash source):

| kind | operators | Prisma clause |
|---|---|---|
| enum | `is` (default) / `not` / `isAnyOf` | `equals` / `not:{equals}` / `in:[...]`, value(s) validated against `ENUM_MEMBERS` first |
| boolean | `is` (default; the only one MUI's boolean filter offers) | coerced `equals` |
| date / date-time / time | `is` (default) / `not` / `after` / `onOrAfter` / `before` / `onOrBefore` | `equals` / `not:{equals}` / `gt` / `gte` / `lt` / `lte`, Invalid-Date-guarded |
| number | `=` (default) / `!=` / `>` / `>=` / `<` / `<=` | same shapes, NaN-guarded |
| decimal | `=` (default) / `!=` / `>` / `>=` / `<` / `<=` | same shapes; a JS-number-typed value is re-quantized via `DECIMAL_SCALES` first (see below) |
| string | `contains` (default) / `equals` / `startsWith` / `endsWith` / `isAnyOf` | direct mapping, case-insensitive |
| relation (FK labelField) | ignored, as before | always the existing nested `contains` |

Two new generate-time metadata consts, alongside the existing
`FIELD_KINDS`/`RELATION_FILTER_FIELDS` (`getters.ts.jinja2`,
`build_context.py`):

- `ENUM_MEMBERS: Record<string, string[]>` — the enum-kind column's valid
  raw-literal members, from the same source `page_list_context()` reads
  for its `entries`. `buildFilter` validates an incoming `is`/`isAnyOf`
  value against this before building the clause — a value that isn't a
  real member (including the column's own translated display label,
  which is what a user actually sees and would naturally type) drops the
  clause instead of reaching Prisma. Defense-in-depth: normal UI use
  can't send an invalid value once the `singleSelect` dropdown is wired,
  but a direct/malformed API call still could.
- `DECIMAL_SCALES: Record<string, number>` — the decimal-kind column's
  `x-decimal-scale`. See the next section for why this exists.

## The precision bug this closed (found only via real Cypress UI testing)

A `type: 'number'` filter's value input is a native
`<input type="number">`. The browser (and MUI's numeric filter operator)
resolve a typed value like `'99.99'` to a JS number — an IEEE-754 double
that cannot represent `99.99` exactly (`99.98999999999999488...`). That
imprecise number is what reaches `buildFilter`, not the string the user
typed. Against a column whose *stored* value is an exact Decimal
(`99.99`), an exact-match clause built from the imprecise number silently
matches zero rows.

This was not caught by design review — it only surfaced running the
actual Cypress spec against the real UI (per this repo's own test-rules
requirement to verify filter behavior through real interaction, not a
curl/unit substitute). The fix: `buildFilter`'s `'decimal'` branch
re-quantizes a JS-number-typed value with `.toFixed(DECIMAL_SCALES[field])`
before it reaches the Prisma clause, recovering the precision the
browser's number input lost. A value that arrived as a string (a REST
caller via `parsePageOpts`, or any path that never went through that
native number input) is left untouched — round-tripping an
already-precise string through `Number()` would reintroduce the exact
loss this exists to avoid.

A malformed value (neither a JS number nor a numeric string — e.g. a
garbage REST query param) is guarded separately: `buildFilter`'s
`'decimal'` branch drops the clause (`Number.isNaN(Number(v))`) rather
than handing an unparseable string to Prisma's Decimal filter, which
throws. Found via the generated filter/sort wiring-check spec (see below)
run against a real consumer schema (`purchase_order_line.unit_price`) —
every other kind (`number`/`date`/`enum`) already guarded this way,
`decimal` alone didn't. See issue #766.

## `format: time`'s date-part is discarded server-side, not normalized

A `type: 'dateTime'` filter's picker lets the user choose both a date and
a time-of-day, but a time-only column has no meaningful date to associate
with the value the user actually cares about. This turned out not to need
any special-casing: empirically verified via a direct query against a
real `@db.Timetz` column, Postgres casts *any* timestamp-shaped comparison
value to `timetz` before comparing — the date component is discarded on
both sides of the comparison regardless of what arbitrary date happens to
be attached to it (the picker's default, or the `1970-01-01` epoch date
the Postgres driver itself assigns when reading a stored `timetz` value
back into a JS `Date`). `buildFilter`'s `'date'` clause shape — which
`format: time` columns dispatch through unchanged, see the kind table
above — therefore needs no time-specific branch, no date-part
normalization, and no new clause shape: the exact same `equals`/`gt`/
`gte`/`lt`/`lte` construction used for `date`/`date-time` columns is
already correct for `time` columns as-is.

## No dogfood fixture entity for this feature's live-UI coverage

This repo's own `json_schema.yaml` must never declare a test-only fixture
entity of its own (see `test_no_test_only_entities_in_own_schema.py`) — a
visible test-fixture entity belongs in a consumer repo's own schema (e.g.
app-template's testbed), never here. An earlier version of this feature's
rollout added a standalone `list_filter_gate` entity directly to this
repo's schema for exactly this purpose; it was removed once that
placement was identified as inconsistent with the guard above.

Four layers now provide durable coverage, none requiring a permanent
schema entity anywhere except the last (a `tsc`-only fixture, never a live
schema entity — see below):

- **Template-level regression tests** (`code_generator/tests/
  test_list_filter_typed_columns.py`): assert `_column_filter_kind`'s
  clause-shape dispatch and `page_list_context()`'s emitted
  `GridColDef.type`/`format`/`valueOptions` strings directly, for every
  column kind including `time`, entirely through synthetic schema
  fragments — no live entity, database, or browser involved. This is
  permanent, runs on every `npm run test:pytest` invocation, and is what
  actually caught a real regression class in the past (the enum/boolean/
  date crashes this whole feature exists to fix were all reproducible as
  generated-code-string assertions once the bug was known).
- **`buildFilter`/`buildOrderBy` unit tests** (`lib/_pagination.test.ts`,
  `npm run test:vitest`): exercise every `ColumnFilterKind` × its real
  operator table (see the table above) directly against the shared,
  schema-independent runtime functions — no entity, schema, or database
  involved. `#753`/`#755`/`#756`'s crashes and the decimal precision fix
  were all reproducible by reverting the relevant branch and re-running
  this file (18/47 assertions fail, restoring the fix makes all 47 pass
  again) — this is what a schema-level fixture cannot reach, since
  `buildFilter`/`buildOrderBy` are hand-maintained shared `lib/` code, not
  generator output. Runs on every consumer repo's own
  `npm --prefix app-generator run test:vitest` too, since the file lives
  in the shared submodule.
- **Generated filter/sort wiring-check spec**
  (`cypress/e2e/api/_filter_sort_matrix_gen.cy.ts`, one file, not
  per-entity): for each `ColumnFilterKind` present among a schema's own
  (`api: true`, `test: true`, `list: true`) entities, one representative
  entity/column is auto-selected (first found in schema/entity iteration
  order — see `select_filter_sort_representatives()`,
  `code_generator/build_context.py`) and exercised via a plain REST `GET`
  query against that consumer repo's own real data (`npm run
  test:e2e:cy:api`). This can only ever reach each kind's *default*
  clause — a REST caller via `parsePageOpts()` never sends a MUI filter
  operator (see `FilterEntry`'s doc comment above) — so it proves
  `FIELD_KINDS` → `buildFilter`/`buildOrderBy`'s dispatch is wired
  end-to-end for that kind using each repo's own real entities, not the
  operator matrix (the vitest layer's job). A kind absent from a given
  schema is stated explicitly in the generated file's own header comment
  ("NOT COVERED"), never silently omitted.
- **`filter_sort_gate` fixture** (`test:filter-sort-gate`, `tsc`-only, no
  Cypress, same discipline as `mention_gate`/`decimal_gate`): a single
  fixture entity carrying every `ColumnFilterKind` at once, type-checking
  `getters.ts`'s `FIELD_KINDS`/`ENUM_MEMBERS`/`DECIMAL_SCALES` const
  declarations (and `FormUpsert.tsx`/`form_validation.ts`/
  `service_validation.ts`) with every kind coexisting on one entity — the
  one shape this repo's own `test:e2e:build` never compiles (this repo's
  own schema has zero enum/boolean/decimal/date-kind columns among its
  own `api`+`test`+`list` entities), and that no other layer above checks
  (they each cover one kind in isolation, or use a synthetic in-memory
  context rather than the real generation pipeline).

A real browser's own value coercion (the decimal `IEEE-754` round-trip bug
below is the standing example) is reachable by none of the four layers
above — none of them drives an actual `<input>` through a real browser.
That gap is closed by **one-off real-UI verification against an existing
consumer entity in a throwaway isolated worktree**, the same precedent
already documented for the post-approval lockdown feature (see
`docs/knowledge/appendix/approval-flow.md`'s Naming note): verify against
a real entity a consumer repo already has, in a scratch worktree that is
never committed, rather than adding a permanent fixture anywhere.
`format: time` itself was verified this way against app-template's
existing `shift_template` entity (`start_time`/`end_time` columns,
already real production fields), which also incidentally carries an
`enum` column (`day_of_week`) in the same list view — covering both
kinds' live-UI behavior without adding anything to any schema. A
permanent, hand-written Cypress UI spec for this same class of bug
(`boolean`/`Decimal` filtering through a real browser input, against a
minimal testbed-only fixture entity in a consumer repo's own schema) is
tracked separately, not by this document's own coverage above.

## What is explicitly out of scope

- FK relation display columns: no `valueOptions`/operator wiring, as
  documented in `list-filter-sort-column-type-dispatch.md`.
- Composite/dotted labelField relation columns: out of scope, unaffected
  by this change (see the same doc).
- `isEmpty`/`isNotEmpty` operators (offered by several MUI filter
  operator sets) are not specially handled — they typically arrive with
  no `value` at all, so `buildFilter`'s empty-value guard drops the
  clause silently rather than applying an "is empty" semantic. Not a
  crash, just an unimplemented operator.
- String kind's `doesNotContain`/`doesNotEqual` operators (present in
  this MUI version's default string operator set but not part of #756's
  design) fall through to the `contains` default rather than their
  negated semantics — inverted-but-not-crashing, same fail-closed
  posture as every other unrecognized operator in the table above.
