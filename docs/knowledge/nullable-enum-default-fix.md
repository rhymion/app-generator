# Nullable Enum Fields No Longer Fabricate a Default

## The problem it solves

An optional (nullable -- excluded from `required:`) enum field with **no**
`default:` declared in the schema was silently pre-filled with its first
declared enum member on the "new" form, both for a top-level create page
(`build_context.py:_default_value()`) and for a DataGrid-child new-row
seed (`generators.py:_new_prop_val()`).

Concretely, an entity declared like this:

```yaml
sales_order_line:
  fields:
    cancellation_reason:
      enum:
        - out_of_stock
        - customer_request
        - payment_failed
```

(no `default:`, not listed in `required:`) generated a `page.tsx` whose
"new" form's initial state was:

```typescript
cancellation_reason: 'out_of_stock' as const,
```

A user who never touched the field -- because the order was **not**
cancelled -- still submitted `'out_of_stock'`. That is not a display-only
artifact: the value flows straight through to `create()`, so it lands in
the database on rows where no cancellation ever happened. An enum field
meant to record *why* something happened silently claims a reason on rows
where nothing happened at all.

## Root cause: two functions, two independent gaps

`build_context.py:_default_value()` (top-level `page_new.tsx` initial
state) had three branches for enum-typed strings:

1. `_prisma_native_enum_type` and `'default' in defn` -> seed the schema
   default. Correct, unaffected by this fix.
2. `_prisma_native_enum_type` and an enum list, **no nullability check** ->
   always seed `enum[0]`. This is the bug for nativeEnum fields.
3. plain (non-nativeEnum) string-enum and an enum list, **no nullability
   check either** -> always seed `default:` if present, else `enum[0]`.
   Same bug, different field flavor.

`generators.py:_new_prop_val()` (DataGrid-child new-row seed) already had
a nullability check for branch 2 (nativeEnum) -- added by an earlier pilot
for fields like `dashboard_widget.stack_mode`/`group_by_bucket` -- but not
for branch 3 (plain string-enum). So the same fabricated-default bug
existed on the DataGrid-child path too, just narrower in scope (only
non-nativeEnum enum fields) than on the top-level path.

Both gaps trace to the same design mistake: `enum[0]` was chosen as a
uniform fallback so a **required** field with no default still typechecks
(nativeEnum) or passes client-side "forced required" validation
(plain string-enum, the client-side `is_forced_required_field` check).
Neither justification applies to a *nullable* field -- a required field
truly cannot be left empty, but an optional one can, and doing so is what
"no default" should mean.

## The fix

Both functions now check `is_null`/`nullable` **before** falling back to
`enum[0]`:

- nativeEnum, nullable, no default -> `null` (matches what
  `generators.py`'s DataGrid-child path already did for this case;
  `build_context.py`'s top-level path was the one missing it).
- plain string-enum, nullable, no default -> `''` (a plain string-enum
  field's TS type is `string`, not a literal union, so `''` typechecks
  without issue and never trips the forced-required check that only
  fires on non-nullable fields).
- Both field flavors, required (non-nullable), no default -> unchanged,
  still `enum[0]` (a required field genuinely needs some value to submit
  on an untouched create).
- Either flavor with an explicit `default:` -> unchanged, still seeds the
  declared default.

No new `x-*` schema key was introduced -- the fix reuses the same
nullability signal (`_is_nullable(defn)` / the `nullable`/`is_null` locals
already computed at the top of each function) both functions already read
for other field types.

## Verification

- **Golden-diff**: regenerating this repo's own dogfood schema
  (`code_generator/json_schema.yaml`) with the fix applied produces
  byte-identical output to `develop` across all 240 generated files -- no
  existing entity's declared-default field, required field, or the
  DataGrid-child-only nullable nativeEnum fields already in this schema
  (`dashboard_widget.stack_mode`/`group_by_bucket`) changed at all.
- **Empirical before/after**: this repo's own dogfood schema has no
  existing *top-level* nullable-enum-no-default field to observe a diff
  on (the only two such fields, `dashboard_widget.stack_mode`/
  `group_by_bucket`, are DataGrid-child-only). A temporary scratch field
  pair (one nativeEnum, one plain string-enum) was added to a top-level
  entity (`organization`) and to a DataGrid-child entity
  (`dashboard_widget`), regenerated with the pre-fix and post-fix
  generator code, and reverted before committing:
  - Top-level, before: `'reason_a' as const` / `'reason_a'`. After:
    `null` / `''`.
  - DataGrid-child, before: `'reason_a'` (plain string-enum branch only --
    the nativeEnum branch was already correct here). After: `''`.
- **Full generator gate**: lint, 1708 pytest (0 skipped once
  generate-code has run), 548 vitest, all 10 fixture gates, `test:e2e:build`,
  `check:generated`, 241 API + 190 UI Cypress specs, `npm audit`,
  `pip-audit`, `check:readme-sync` -- all green.

## What this does not cover

This fix closes the gap for the generator's own default-value seeding
logic. It does not (and cannot) fix rows already written with a
fabricated value by the pre-fix generator in any already-deployed
consumer -- that is a data question for whoever owns that consumer's
database, not something a generator-level fix can retroactively correct.
