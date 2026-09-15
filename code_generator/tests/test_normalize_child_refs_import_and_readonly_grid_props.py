"""
Regression tests for cmd_1047i (subtask_1047h QC, real-schema regressions in
PR#530/subtask_1047g's independent-readonly-grid-child feature --
confirmed as PR#530-introduced side effects, unlike the `bin` ReferenceError
fix in test_datagrid_child_selfref_shared_fk_target_var_name.py which is a
pre-existing generators_test.py defect).

Case A -- unused `normalizeChildRefs` import (service.ts)
----------------------------------------------------------
`service_context()`'s import gate for `normalizeChildRefs` checked
`has_non_comment_ch` (the UNNARROWED embedded_ch, kept unchanged for
column-hook generation) instead of whether `snapshot_child_mappings` (built
from `write_ch`, which PR#530 narrows to exclude a read-only independent
grid child) is actually non-empty. An entity whose only embedded child is
such a read-only independent grid child keeps `has_non_comment_ch=True`
while `snapshot_child_mappings` renders empty -- importing `normalizeChildRefs`
with nothing left to reference it (confirmed live: lib/{asn,goods_receipt,
shipment}/service.ts, cmd_1047h).

Case B -- unused initial{Xxx}s/search{Xxx}Options props (FormUpsert.tsx)
-------------------------------------------------------------------------
`form_upsert_context()`'s FormUpsertProps signature construction
(`_ordered_targets`/`selection_targets`) already excluded a target reachable
only through a readonly PARENT-level relation or an undisplayed
PARENT-level relation, but had no equivalent exclusion for a target
reachable only through a read-only INDEPENDENT GRID CHILD's own FK field
(e.g. goods_receipt_line's destination_bin_id -> bin) -- such a child
(cmd_1047, an independent read-only grid child) renders via FieldsViewGrid straight from `src.<prop>`,
with no per-column EntityAutocompleteCellConfig wiring, so its
initial{Xxx}s/search{Xxx}Options props go unused the same way a
readonly-only or undisplayed-only parent-level target's did (confirmed
live: components/{asn,goods_receipt,purchase_order,sales_order,shipment}/
FormUpsert.tsx, 23 no-unused-vars warnings, cmd_1047h).
"""
from build_context import build_context
from generators import service_context, form_upsert_context


def _base_props(extra: dict | None = None) -> dict:
    props = {
        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        "name": {"type": "string"},
    }
    props.update(extra or {})
    return props


def _fk_field(target: str, nullable: bool = False) -> dict:
    t = ["string", "null"] if nullable else "string"
    return {
        "type": t,
        "pattern": "^c[a-z0-9]{24,}$",
        "x-relationship": {"type": "many-to-one", "target": target, "labelField": "name"},
    }


def _entity(model: str, children: list, generate: dict | None = None) -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": model,
        "children": children,
        "generate_config": generate or {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": False, "fields": None,
        },
    }


def _child_entry(name: str, prop: str, x_generate: dict) -> dict:
    """A non-list embedded grid child with its own x-generate (making it
    'independent' -- own new/edit permitted -- the trigger condition for
    PR#530's readonly_indep_grid_ch classification)."""
    return {
        "name": name,
        "property_name": prop,
        "output_type": None,
        "file_type": None,
        "relationship": None,
        "x_generate": x_generate,
    }


def _schema() -> dict:
    """
    `doc` (parent) embeds `doc_line`, an INDEPENDENT (own x-generate.new/edit)
    non-list grid child. `doc_line` has a many-to-one FK (`bin_id` -> `bin`)
    that the parent itself has no relation to at all -- `bin` is reachable
    ONLY through doc_line's own FK field, exactly like goods_receipt_line's
    destination_bin_id -> bin on proj_g.
    """
    return {
        "definitions": {
            "bin": {
                "type": "object",
                "required": ["id", "name"],
                "properties": _base_props(),
            },
            "doc": {
                "type": "object",
                "required": ["id", "name"],
                "properties": _base_props(),
            },
            "doc_line": {
                "type": "object",
                "required": ["id", "doc_id", "bin_id"],
                "x-generate": {"new": True, "edit": True, "list": True, "view": True, "delete": True, "api": True},
                "properties": {
                    **_base_props(),
                    "doc_id": {"type": "string"},
                    "bin_id": _fk_field("bin"),
                },
            },
        }
    }


def _built():
    schema = _schema()
    entity = _entity(
        "doc",
        children=[_child_entry("doc_line", "lines", {"new": True, "edit": True})],
    )
    return build_context(entity, schema), schema


def test_normalize_child_refs_not_imported_when_only_child_is_readonly_indep_grid():
    """Case A: with the entity's only embedded child fully excluded from
    write_ch (independent, non-connect), normalizeChildRefs must not be
    imported -- nothing left references it."""
    built, schema = _built()
    ctx = service_context(built, schema)
    assert "normalizeChildRefs" not in ctx["utility_code"]


def test_bin_target_props_absent_from_form_upsert_params():
    """Case B: `bin` is reachable only through doc_line's own (now
    read-only) FK field -- initialBins/searchBinOptions must not appear in
    the FormUpsertProps destructuring."""
    built, schema = _built()
    ctx = form_upsert_context(built, schema)
    params = ctx["form_upsert_params"]
    assert "initialBins" not in params
    assert "searchBinOptions" not in params


def test_still_editable_parent_level_target_unaffected():
    """Control: a target reachable through the PARENT's own still-editable,
    displayed relation must still get its initial{Xxx}s/search{Xxx}Options
    props -- this fix must not over-exclude."""
    schema = _schema()
    schema["definitions"]["organization"] = {
        "type": "object",
        "required": ["id", "name"],
        "properties": _base_props(),
    }
    schema["definitions"]["doc"]["required"].append("organization_id")
    schema["definitions"]["doc"]["properties"]["organization_id"] = _fk_field("organization")
    entity = _entity(
        "doc",
        children=[_child_entry("doc_line", "lines", {"new": True, "edit": True})],
    )
    built = build_context(entity, schema)
    ctx = form_upsert_context(built, schema)
    params = ctx["form_upsert_params"]
    assert "initialOrganizations" in params
    assert "searchOrganizationOptions" in params
