# CSV Import: Composite/Dotted labelField FK via Full-Label-Text Matching (cmd_548)

## The gap this closes

`csv-import-non-key-fk-write-path.md` (cmd_530) generalized CSV-import FK resolution to every
screen-editable FK relation, but explicitly excluded any relation whose `labelField` is a list
(composite, e.g. `[product.name, location.name]`) or a dotted path — there was no single scalar
field to resolve a CSV cell back to, so the column stayed export-only and landed in
`import_unimportable_columns`. Real-world case: proj_c's `inventory_movement.from_inventory_id`,
whose target's `labelField` is `[product.name, location.name, lot_number, expiration_date]`.

Naive literal parsing of the rendered label text (splitting on `join_separator`, default a single
space) is infeasible in general: the separator is not guaranteed absent from the values
themselves (`"Widget Pro Warehouse A LOT001"` cannot be reliably split back into its component
fields).

## The fix — match the whole rendered label, not its parts

Instead of parsing, resolve by **exact full-label-text match** against a pre-built map:

`build_context.py`'s `x_relationships_list` construction now also computes, for every
composite/dotted relation, an `import_label_expr` — the SAME `build_label_expression()` call used
to build the export-side `label_expr`, with only the root variable changed from `row.<relation>`
(nested under the exporting row) to `c` (a top-level candidate row from
`prisma.<target>.findMany()`). Same `label_field`/`target`/`schema`/`join_separator` inputs in
both calls — export and import can never render the label text differently for the same
underlying values, since both are one call away from identical inputs (this directly answers the
"could import silently drift from export" concern: **use the same helper for both**, don't
hand-write two versions of the join logic).

`import_fk_specs` gains `is_composite: True` entries for these relations (previously skipped).
`api_import_route.ts.jinja2` renders, per composite spec:

- **Once per import, before the per-row loop**: if the CSV header includes this column, run
  `prisma.<lookup_entity>.findMany({ include: <prisma_include> })` (org-filtered when
  `lookup_entity_filter_by_org`), compute each candidate's label via `import_label_expr`, and
  build a `Map<label, id[]>`. Skipped entirely when the header lacks the column — no cost for an
  import that never touches this FK.
- **Per row**: `Map.get(trimmed CSV value)` — O(1), zero additional DB queries regardless of CSV
  row count. 0 matches → `NOT_FOUND`; 2+ matches → `MULTI_MATCH` (row-level, not batch-level: only
  the ambiguous row is rejected, other rows in the same CSV still resolve and import normally).
  Both error messages carry the column name, the CSV value, and (for `MULTI_MATCH`) the match
  count, plus actionable next-step guidance (use the `<fk>_id` column to disambiguate by ID).

Normalization: only leading/trailing whitespace is trimmed on both sides (map-build and per-row
CSV value) — no case-folding or width normalization, so "what you see on screen is exactly what
you type into the CSV" holds without a second, silently-different comparison rule.

## Org isolation

The candidate-row query is filtered by `organization_id: { in: _importOrgIds }` whenever the
composite relation's target entity is org-scoped (`lookup_entity_filter_by_org`, the same
discriminant cmd_521/cmd_530 already use for the simple dotted-FK case) — a cross-org row's label
must never resolve an FK for an importer outside that organization. A composite target with no
`organization_id` (system-global, e.g. a shared taxonomy table) is correctly left unfiltered, same
as the existing simple-dotted-FK behavior.

proj_b's own dogfood schema (`code_generator/json_schema.yaml`) has no org-scoped entity at all
(single-tenant-by-design internal app — see `should_filter_by_org`'s exclusion list), so this
generator repo's own mandatory e2e gate cannot exercise the org-filtered branch end-to-end (same
structural gap `test:mention-gate`'s fixture exists to work around for its own dark branch — see
`docs/knowledge/mention-system.md`). Org-filter correctness for the composite map is covered by
`code_generator/tests/test_build_context.py::TestCompositeLabelFieldImportOrgFilter` (both the
org-scoped-target and system-global-target cases), and was additionally verified live against a
temporary, uncommitted schema fixture (an extra nullable `organization.primary_role_id` FK to
`role`, composite labelField `[name, description]`) — reverted before this change was finalized.

## Verification

Empirical scenario coverage (round trip / empty→value UPDATE / new-row CREATE, plus a deliberate
duplicate-label deviation-injection case) was run against a real isolated worktree DB using that
same temporary schema fixture. All scenarios passed, including: the duplicate-label row
(`MULTI_MATCH`, exact column/value/count in the message) rejected while a different, unambiguous
row in the same CSV batch resolved and matched correctly, and the pre-loop map query provably not
required (`headerFields.includes(...)` guard) when the CSV never references the column.

## Permanent regression coverage

`code_generator/tests/test_build_context.py::TestCompositeLabelFieldImportOrgFilter` —
`is_composite` flag, `import_label_expr` rooted at the candidate var (not `row.<relation>`),
`prisma_include` carries the nested relations the label needs, org-filter applied/not-applied
correctly, and the column is removed from `import_unimportable_columns`.

`code_generator/tests/test_build_context.py::TestImportFkSpecsScreenEditableGeneralization` —
updated: a composite-labelField FK is now importable (previously asserted excluded — see the
cmd_530 supersession note in `csv-import-non-key-fk-write-path.md`).

`code_generator/tests/test_import_template_branches.py` — map built once outside the per-row
loop; map-build skipped when the header lacks the column; candidate query org-filtered/not
per-spec; map built from `import_label_expr` (never the export-rooted `label_expr`);
`NOT_FOUND`/`MULTI_MATCH` messages carry column + value (+ count); nullable-empty short-circuits
without touching the map; write path shape matches the existing non-key FK convention (`fkData`
on CREATE, `updateData` on UPDATE).
