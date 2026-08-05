# CSV Import: Non-Key FK Write Path + UPDATE Never Wrote Any FK (cmd_530)

## The bug (customer-reported)

A CSV-import UPDATE (and, for some schemas, CREATE) silently dropped an FK column instead of
writing it — the route answered `200 succeeded` while the value never reached the database.
Reported against `approval_flow`: `Requestor Role` was never written back through CSV import,
on either a brand-new row or an existing row whose `requestor_role` was empty.

## Two compounding root causes

**筋1 — `import_update_fields` structurally excludes every FK column, key or not**
(`code_generator/build_context.py`, `export_scalar_fields` / `import_update_fields`):
`export_scalar_fields` excludes anything in `_fk_prop_names` (dotted or not). Since
`import_update_fields` is derived from it, **no FK column was ever written on UPDATE** — even a
*declared* dotted `x-import-key` FK (e.g. `permission.role_id`, key = `role.name`) was only ever
written via the `keyWhere` merge into CREATE data, never rewritten on UPDATE. In practice this
was often invisible (a round-trip re-import doesn't change the key, so not rewriting it looked
correct) — until a real UPDATE needed a key FK's value confirmed/reasserted.

**筋2 — only FK columns declared in `x-import-key` had any import path at all**
(`build_context.py`, `import_key_specs`; `api_import_route.ts.jinja2`, `FIELD_SPECS`/`keyWhere`):
An FK relation that is screen-editable (`x-generate.edit: true`, visible in `x-display`) but
**not** listed in `x-import-key` was excluded from `export_scalar_fields` (FK) *and* absent from
`import_key_specs` (not a key) — zero write path on CREATE or UPDATE. This is the customer's
exact bug: `approval_flow.requestor_role` is editable on screen, not part of the natural key.

Together: 筋1 explains why even a *declared* key FK was never rewritten on UPDATE; 筋2 explains
why a *non-key* screen-editable FK had no import path at all, in either direction.

## The fix — generalize "importable FK" beyond `x-import-key`

`build_context.py` now builds `import_fk_specs`: every FK relation in `x_relationships_list`
(the export-side flatten list) that is **screen-editable** (in `filtered_props`, not in
`readonly_fields`) **and** has a **simple (non-composite) labelField** — resolved via the same
lookup-by-label mechanism as a dotted `x-import-key` entry, marked `is_key` for entries that
duplicate an existing `import_key_specs` dotted key (their resolution code is not re-emitted).

`api_import_route.ts.jinja2`:
- Non-key entries get a **new** resolution block (mirrors the existing dotted-key block) that
  writes into a `fkData` object instead of `keyWhere` (non-key FKs never participate in row
  matching).
- `fkData` is merged into CREATE data alongside `keyWhere`.
- **Every** `import_fk_specs` entry (key or not) is now written into `updateData` — this is what
  closes 筋1: a key FK's value is a no-op on UPDATE when unchanged (the row only reaches UPDATE
  because `keyWhere` already matched), and a non-key FK's value is the actual fix for 筋2.

`any_dotted_fk_needs_org_filter` (cmd_521) and `_create_feasible`'s resolvable-column set are
both recomputed from `import_fk_specs` (the superset), so a non-key FK into an org-scoped lookup
entity gets the same org-filtered lookup cmd_521 gives key FKs, and a *required* non-key FK
(e.g. `approval_flow.approver_role_id`, un-keyed after the pre-existing `x-import-key:
[entity_name]` schema) now counts toward CREATE feasibility — proj_b's own `approval_flow` went
from `import_can_create: false` (every row hit `ENTITY_IMPORT_CREATE_NOT_SUPPORTED`) to `true`.

## Excluded on purpose: read-only FKs (composite/dotted labelFields — see cmd_548)

A `x-readonly` FK stays export-only: visible in export, but there's no reason to make it writable
via import just because it's writable via export. It is collected into
`import_unimportable_columns` (see below) instead of silently disappearing.

A relation whose `labelField` is a list or a dotted path (e.g. a composite display column) was
**also** excluded here at the time this task shipped — there was no single lookup field to
resolve a CSV cell back to. This is **no longer true**: cmd_548 made composite/dotted labelFields
import-resolvable via full-label-text matching against a pre-built map. See
`docs/knowledge/csv-import-composite-labelfield.md`.

## Fail-loud companion: `UNIMPORTABLE_COLUMN`

Independent of root cause, a route that answers `200 succeeded` while quietly discarding a
column it can't write is a trap for the next schema author. `import_unimportable_columns` lists
every exported FK display column that has **no** entry in `import_fk_specs` (read-only; composite
labelField no longer lands here as of cmd_548). The generated route checks the CSV header against
this list **before** processing any row — same convention as the existing `MISSING_COLUMN` check
(`row: 0`, blocks the whole request) — and returns a new `UNIMPORTABLE_COLUMN` error instead of a
false "succeeded".

## Known gap NOT fixed by this task: KEY-field null→value creates a phantom duplicate row

Discovered during verification, empirically confirmed, deliberately left unfixed — this is a
*different*, deeper limitation than 筋1/筋2, orthogonal to "does a resolved value get written":

If a field is part of `x-import-key` (the natural key used to *match* the existing row) and its
CSV value changes — including going from empty to a value — the `keyWhere` lookup for the
**old** value no longer matches the existing row. `matches.length === 0`, so the importer routes
into **CREATE** instead of UPDATE, producing a phantom duplicate row with the new key value while
the original row is left untouched. Reproduced with `permission.role` (`x-import-key: [name,
role.name]`, `role_id` nullable): setting a previously-null `role_name` via CSV import creates a
*second* `permission` row instead of updating the first.

This is not specific to FK keys — any changed `x-import-key` column exhibits the same "rename
creates a new identity" behavior under natural-key matching; 筋1 (this task's fix) makes the
*value* reach `updateData` once a row is matched, but cannot make a changed key value match the
row it used to identify. Fixing this would mean either (a) excluding null-valued key columns from
the match `where` and falling back to a secondary match strategy, or (b) treating a key-column
change as an explicit "rename" operation — both non-trivial design decisions out of scope here.
Empirically demonstrated (not just asserted) in the verification spec described below; flagged
for a follow-up cmd.

## Verification

Empirical scenario coverage (round trip / empty→value UPDATE / new-row CREATE) against the
current generator tip, for both a KEY dotted-FK entity (`permission.role`) and a non-key
dotted-FK entity (`approval_flow.requestor_role`, mirroring the customer's live schema shape:
`approver_role` = key, `requestor_role` = non-key) — done via a scratch, gitignored Cypress spec
(`cypress/e2e/api/_repro_530.cy.ts`, matches the `cypress/e2e/api/*.cy.ts` gitignore pattern, not
committed) run against a real isolated worktree DB. All 6 scenarios passed, including the
documented KEY-field gap above (asserted as a known limitation, not a false "fixed").

## Permanent regression coverage

`code_generator/tests/test_build_context.py::TestImportFkSpecsScreenEditableGeneralization` —
non-key FK becomes importable, key FK marked `is_key`, readonly FK excluded and lands in
`import_unimportable_columns` (composite-labelField FK is importable as of cmd_548 — see
`docs/knowledge/csv-import-composite-labelfield.md`), required non-key FK makes CREATE feasible.

`code_generator/tests/test_build_context.py::TestImportKeySpecsLookupEntityFilterByOrg
::test_any_dotted_fk_needs_org_filter_true_for_non_key_fk_too` — org-filter detection (cmd_521)
extended correctly to non-key FKs.

`code_generator/tests/test_import_template_branches.py` — non-key FK resolved once and written
to both CREATE and UPDATE; key FK now also written to UPDATE (not just merged via `keyWhere` into
CREATE); `UNIMPORTABLE_COLUMN` rejects a present-but-unwritable header column; the common case
(no unimportable columns) still renders a valid empty array.
