# Clearing an optional-but-non-nullable Decimal/date field crashed the write

**Symptom**: a Decimal or date/date-time/time column that is *not* in the
JSON schema's `required:` list but *is* DB-level `NOT NULL` (always the case
for a non-required, non-nullable field — see "why this shape always has a
default" below) crashed on save when the user cleared it:

```
Invalid value for argument 'paid_amount': Failed to parse empty string.
Expected decimal String.
```

for Decimal, or an uncaught `Invalid Date` reaching Prisma's `DateTime`
argument validation for date/date-time/time. Discovered on `invoice.paid_amount`
against a real consumer schema, but the same shape recurred for
`policy_coverage.lifetime_paid_amount`, `policy_party.benefit_share_pct`, and
(the date variant) a `coverage_master` child's `effective_from`.

**This was a product-code defect, not a test defect.** Clearing an optional
numeric or date field is an ordinary user action; the generated UI must
accept it.

## Root cause

`code_generator/build_context.py`'s `_build_form_data_gets()` builds the
`const <field> = data.get('<prop>') as <type>...` line every `actions.ts`
uses to pull a submitted form value out of `FormData`. Before this fix, the
non-nullable branches for both Decimal and date fields did a bare cast with
no empty-string handling:

```ts
// Decimal (old):
const paidAmount = data.get('paid_amount') as string;
// Date (old):
const dateStr = data.get('field') as string;
const date = new Date(dateStr);
```

An untouched-then-cleared field submits `''` via `FormData`. For Decimal,
`''` reaches `tx.model.update({ paid_amount: '' })` and Prisma's Decimal
parser rejects it outright. For a date, `new Date('')` is `Invalid Date`,
which Prisma also rejects when serializing the `DateTime` argument.

## Why this shape (non-nullable + not required) always has a default

`derive_raw_entity`'s only path into the JSON schema's `required:` list is
`not pf.nullable and not pf.has_default` — so a field that's DB-level
`NOT NULL` but excluded from `required:` necessarily carries a Prisma
`@default(...)` (static, or dynamic like `now()`). That default is what
makes "cleared" a legal state to fall back to instead of a hard rejection.

## The fix (single location, `_build_form_data_gets`)

Both branches now check whether the field is genuinely required
(`prop in required_props`, threaded in as a new parameter) before deciding
what an empty submission means:

- **Nullable** field: `'' → null` (unchanged, already correct).
- **Non-nullable + required, no default**: left as the original bare cast.
  `''` (or `new Date('')`) already fails `isMissingValue()` in
  `service_validation.ts` cleanly — `REQUIRED_FIELDS` rejects it with an
  `AppError('VALIDATION', ...)` before Prisma ever sees it. **Do not**
  convert this branch to `null`/a fallback: the service function's
  parameter type is the schema's declared type (`string` for a
  non-nullable Decimal, `Date` for a non-nullable date) — producing
  `string | null` / `Date | null` here breaks `tsc` at the call site
  (caught by `test:decimal-gate`'s required-column branch: TS2345 assigning
  `string | null` to a `string` parameter — a real regression introduced
  and caught while fixing this defect, see the file's own history).
- **Non-nullable + NOT required (has a default)**: `''` falls back to the
  schema's declared `default:` value when present, else `'0'` for Decimal /
  `new Date()` for date — never `null`, for the same non-nullable-parameter
  reason above.

## Why existing tests never caught this

`generators_test.py`'s UI populate helper (`prisma_value`/`cypress_create_value`)
always generates a *valid* Decimal/date value for every Decimal/date field —
there was never a generated test that submitted `''` down this specific path.
The "removes optional data and child items" test class is the one that
legitimately clears an optional field — and it only exercises this crash
when the entity under test happens to have a non-nullable-but-optional
Decimal or date column. This repo's own `json_schema.yaml` has none (zero
Decimal fields at all, and no such date field either), so
`test:e2e:build` (the mandatory-gate build step) never compiles or runs this
path — only a consumer schema with the right shape surfaces it. See
`decimal-client-server-boundary-gate-limitation.md` for the same
"this repo's schema has no Decimal field" blind spot in a different context;
`test:decimal-gate`'s fixture covers the Decimal *type-checking* surface but
not this runtime empty-string path.

## Related, separate fix: DataGrid child rows had no validation at all

The date variant's flagship failure (a DataGrid child row's date field) does
**not** go through `_build_form_data_gets()` — DataGrid child rows are
JSON-parsed client values passed straight through `_build_child_data()`'s
`field_map_create` (`f.{prop}`, no coercion) into the nested Prisma
`create`/`update`. Worse: `service.ts.jinja2`'s
`validateOnAdd`/`validateOnUpdate` calls only ever validate the **parent's**
own fields (`validation_data_obj`) — no generated code validates a child
row's required fields at all. Clearing a required child field previously
reached Prisma raw and threw an uncaught `PrismaClientValidationError`/
`PrismaClientKnownRequestError`, which Cypress treats as a test failure
regardless of the intended assertion (an uncaught page exception fails the
test outright). Fixed by wrapping those two error types as a clean
`AppError('VALIDATION', ...)` in the shared `add{Parent}`/`update{Parent}`
catch block (`service.ts.jinja2`) — this is a broader net than just the date
case: it also covers any other unvalidated child-row defect reaching Prisma
raw, not only Invalid Date.
