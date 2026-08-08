# `_create_feasible` ignored internal bridge FKs, wrongly gating off CSV CREATE (cmd_609)

## Symptom

An entity with a required FK to an internal bridge model (e.g. `approvable_id`,
`x-relationship.type: one-to-one_bridge`) had `import_can_create` computed as
`False`, even though the bridge row is created and wired by the service layer
at CREATE time and was never meant to come from a CSV row. Combined with
`x-generate.edit: false` (which makes `import_can_update` structurally
`False` too), `api_import_route.ts.jinja2:24`'s
`{% if not import_can_create and not import_can_update %}` collapsed the
*entire* generated `app/api/<entity>/import/route.ts` to the
`ENTITY_IMPORT_NOT_SUPPORTED` 400 stub — not just CREATE, the whole route.
Any entity with an approval/comment/attachment-style bridge FK that also
disallows edit hits this (the concrete trigger was `goods_receipt_line`,
cmd_610's pending "no update" ruling for that entity).

## Root cause

`build_context.py`'s `_create_feasible` gap-check (used to compute
`import_can_create`) only ever excluded seven hardcoded system/auto column
names (`_SYSTEM_AND_AUTO_IDS`) from the "required fields with no CSV source"
set. It never called `get_internal_bridge_fk_prop_names()` — the shared
helper `validate.py:326` and `generators_test.py:3551` already use for the
same class of field. A required bridge FK is correctly excluded from
`export_scalar_fields` (it must never appear as a CSV column), but
subtracting `export_scalar_fields` from the required-fields set only removes
names that *are* in it — it does nothing for a name that's required but
absent from every set being subtracted. The field silently stayed a
"gap", `_create_feasible` came out `False`, so did `import_can_create`.

A prior fix pass (cmd_421) added a test for exactly this scenario
(`TestRequiredInternalBridgeFkImportFeasibility`) but asserted the *buggy*
value (`import_can_create is False`) as correct, under the mistaken belief
that `get_internal_bridge_fk_prop_names()` was already unioned into
`_create_feasible`'s own gap-check (it was only unioned into the export
exclusion set, a different computation). The bug shipped for two cmd cycles
disguised as a passing, "structural verification" test.

## Fix

`_create_feasible` now also subtracts
`get_internal_bridge_fk_prop_names(model_def, schema)` from the required-gap
set — the same shared helper `validate.py` and `generators_test.py` already
call, not a hand-maintained parallel name list (that pattern has already
caused one prior miss; see `validate.py:323-325`'s own comment).

This only excludes FKs pointing at true internal bridge models (zero
`x-generate` surface anywhere across the target's variants — see
`get_internal_bridge_fk_prop_names()`'s docstring in
`code_generator/helpers/schema_helpers.py`). An ordinary required FK to a
real, generated entity (e.g. `approval_flow.approver_role_id`) is untouched
by this change — it is not a bridge FK, so it isn't in the new exclusion
set, and remains subject to the existing dotted-import-key /
screen-editable-FK resolvability logic (`import_fk_specs`,
`_import_resolvable_cols`) exactly as before.

## Verification

- Isolated `build_context()` harness reproduction (no real entity in this
  repo's own `json_schema.yaml` combines a required bridge FK with
  `edit: false` — `goods_receipt_line` lives in a consumer schema): before
  the fix, `import_can_create=False`, `import_can_update=False` (edit:false)
  → route collapses to the 400 stub. After the fix, `import_can_create=True`
  → route stays live.
- `TestRequiredInternalBridgeFkImportFeasibility` in
  `code_generator/tests/test_build_context.py` updated: the cmd_421 test's
  assertion flipped from `False` to `True` (with the corrected rationale
  documented inline), plus a new test asserting the compound
  edit:false-plus-bridge-FK case no longer collapses the route.
- Both new/updated assertions fail against the pre-fix code (deviation
  injection, cmd_476 convention) and pass against the fix.
- Both-directions check: a genuinely unfillable required FK (no bridge
  target, no dotted import key, no screen-editable resolution path) is
  untouched — `TestDP1cVisibleSourceOnlyCreateFeasibility` and the rest of
  `test_build_context.py`'s existing feasibility tests still pass unchanged.
- Full `code_generator` pytest suite: 1131 passed, 0 skipped (post
  `generate-code`; this repo's own schema has no entity that combines a
  required bridge FK with `edit:false`, so no real generated route changes
  shape here — the fix's effect is only observable via the isolated harness
  and will show up for real in a consumer schema like proj_c/proj_g's
  `goods_receipt_line`).
