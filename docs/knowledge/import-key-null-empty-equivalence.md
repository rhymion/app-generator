# CSV-import key matching: NULL and empty string must be equivalent

## Symptom

Issue #525: re-importing the same CSV file against an entity whose
`x-import-key` includes an optional (nullable) plain scalar column
(e.g. a `label` column) produces duplicate rows instead of finding the
existing one.

## Root cause

`code_generator/build_context.py`'s `import_key_specs` builder computed
`fk_nullable` correctly for **dotted** (FK) key entries but hardcoded
`false` for non-dotted (plain scalar) key entries — even though
`import_field_specs` already computes the correct nullability for the
very same column. As a result, `api_import_route.ts.jinja2`'s non-dotted
branch always wrote the raw (possibly empty-string) CSV value straight
into the matching `keyWhere`, with no null-normalization.

The defect is invisible at write time: every other write path in this
generator (`service.ts`, `build_context.py`'s form-data readers, the
dotted-FK branch) already normalizes an empty nullable string to `null`
before persisting. So a duplicate row created by this defect still ends
up stored as `NULL`, which is why an affected user observes what looks
like "a NULL row duplicating a NULL row" — the actual mismatch happens
one step earlier, at the moment the `findMany()` match query runs
against an incoming `''` versus a stored `NULL`.

## Fix

1. `build_context.py`: the non-dotted key branch's `fk_nullable` is now
   computed from the column's own schema type
   (`_is_nullable(model_def['properties'][col])`), matching
   `import_field_specs`'s existing computation for the same column.
2. `api_import_route.ts.jinja2`: an empty cell on a nullable non-dotted
   key column now (a) normalizes to `null` for the CREATE-data value
   (`keyWhere`), and (b) contributes an `OR: [{ col: null }, { col: '' }]`
   condition to a dedicated `keyMatchConds` array used to build the
   match query — so a pre-fix row persisted as `''` is still found, not
   just a `NULL` one.

`keyMatchConds` is combined into the match query via a top-level `AND`
key, deliberately never via a top-level `OR` key: the org-filter
branches in the same template already use `OR` for their own
`organization_id` condition, and an entity can be both org-filtered
(with an optional org relationship) *and* have a nullable non-dotted
key column at the same time (`inventory_reservation` is exactly this
shape). Spreading the key-equivalence `OR` directly onto the where
object would have let the org-filter branch's own `OR` silently
overwrite it (or vice versa, depending on spread order) — same object
key, last write wins. Keeping the two concerns on different top-level
keys (`AND` for key matching, `OR` for org filtering) avoids the
collision entirely, in either branch order, for any future third
top-level condition too.

## Scope

Import-path key matching only, optional (nullable) key columns only.
Dotted (FK) keys, required keys, and non-import write paths are
unchanged.

## See also

- `code_generator/tests/test_build_context.py`'s
  `TestImportKeySpecsNonDottedNullable`
- `code_generator/tests/test_import_template_branches.py`'s
  issue-#525 section
