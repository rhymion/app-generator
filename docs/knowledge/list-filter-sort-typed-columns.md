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
  (`format: date-time`): `type: 'dateTime'`.
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
| date | `is` (default) / `not` / `after` / `onOrAfter` / `before` / `onOrBefore` | `equals` / `not:{equals}` / `gt` / `gte` / `lt` / `lte`, Invalid-Date-guarded |
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

## `list_filter_gate`: the dogfood coverage vehicle

This repo's own `json_schema.yaml` had zero enum/boolean/date-only/
date-time/decimal columns anywhere in any `can_list` entity's
`x-display.table` (confirmed by a full schema walk) — no real entity's
list page could exercise any of the above through a live Cypress UI
interaction. `list_filter_gate` is a small, deliberately standalone
entity (no relation to/from any other entity) added purely to carry one
column per kind (`status_type`: native enum; `is_enabled`: boolean;
`valid_from`: date-only; `started_at`: date-time; `priority`: plain
number; `weight`: Decimal), backing the permanent Cypress coverage in
`cypress/e2e/list_filter_sort_typed_columns.cy.ts`.

It carries `x-generate.test: false` (self-seeded through its still-
generated `/api/list_filter_gate` endpoint via
`cypress/support/list_filter_gate_seed.ts`, mirroring `approval_flow`'s
own established pattern) rather than opting into a full generated CRUD
Cypress spec set. One consequence: `grantAllEntityPermissions()`
(`cypress/support/db-helpers.ts`)'s own `ALL_ENTITIES` array is
template-rendered from `db_helpers_context()`'s `test_entity_names` —
only entities with `x-generate.test: true`, or reached via another
entity's `x-relationship` labelField hop, are ever in it (this is *not* a
hand-preserved section across regeneration, despite the file's own
top-of-file comment implying otherwise for `grantAllEntityPermissions` —
the whole function, `ALL_ENTITIES` included, is fully re-rendered from
the `test_db_helpers.ts.jinja2` template every `generate-code` run). A
standalone `test: false` entity like `list_filter_gate` therefore falls
outside it. The fix is a new `db:grantEntityPermission` Cypress task
(`cypress.config.ts`, itself never regenerated) that grants one
additional entity's permission to the already-created Administrator
role — called after `db:grantAllPermissions` in this spec's `beforeEach`.

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
