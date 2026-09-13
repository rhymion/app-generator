"""
Regression test for subtask_1047e (cmd_1047 follow-up, "Bug A").

Background
----------
`form_upsert_context()` builds an `EntityAutocompleteCellConfig` for every
many-to-one relation an embedded (non-list) grid child declares, so the
child grid's autocomplete cell can resolve labels/options. Two call sites
in `generators.py` build the SAME set of configs from what is supposed to
be the SAME exclusion rule (the child's own structural parent FK, e.g.
`asn_id`):

  1. The call-site args passed into `use{Child}Columns(...)` (builds
     `rel_args_str` from `child_rels`, excluding only `parent_fk_props_child`).
  2. The `useMemo` declarations for each `{prop}Config` variable (excluding
     `parent_fk_props_cdef` — same rule as (1), applied per child).

Before this fix, (2) ALSO excluded any relation prop_name the *parent*
model itself happened to declare (`parent_rel_prop_names`, leftover from
commit b9afc7be when parent- and child-level FK pickers shared a single
variable shape). Since b9afc7be, the parent level uses a completely
different variable shape (`{prop}SearchAction`/`{prop}CurrentOption`) than
the child grid's `EntityAutocompleteCellConfig` — they are no longer
interchangeable. So whenever a non-list grid child had its own relation
whose prop_name matched a relation the parent ALSO declared (e.g. both
`asn` and `asn_line` have an `organization_id` FK), the child's own
`organizationIdConfig` declaration was silently dropped from (2) while (1)
still referenced it in the `useAsnLineColumns(true, organizationIdConfig)`
call — a `ReferenceError`/`Cannot find name 'organizationIdConfig'` at
build/type-check time (confirmed live on proj_g's asn/goods_receipt/
purchase_order/sales_order/shipment entities, subtask_1047d).

The fix aligns exclusion set (2) with (1): only the child's own structural
parent FK is excluded, never a same-named parent-level relation.
"""
from build_context import build_context
from generators import form_upsert_context


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


def _entity(model: str, children: list) -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": model,
        "children": children,
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": False, "test": False, "fields": None,
        },
    }


def _child_entry(name: str, prop: str) -> dict:
    """A non-list (embedded grid) child — output_type left unset."""
    return {
        "name": name,
        "property_name": prop,
        "output_type": None,
        "file_type": None,
        "relationship": None,
    }


def _schema() -> dict:
    """
    `asn` (parent) and `asn_line` (embedded non-list grid child) BOTH declare
    a many-to-one relation named `organization_id` -> `organization`. This is
    the exact shape that broke on proj_g's asn/goods_receipt/purchase_order/
    sales_order/shipment entities once their line children stopped being
    independent (x-outputType: list removed).
    """
    return {
        "definitions": {
            "organization": {
                "type": "object",
                "required": ["id", "name"],
                "properties": _base_props(),
            },
            "asn": {
                "type": "object",
                "required": ["id", "name", "organization_id"],
                "properties": {
                    **_base_props(),
                    "organization_id": _fk_field("organization", nullable=False),
                },
            },
            "asn_line": {
                "type": "object",
                "required": ["id", "asn_id", "organization_id"],
                "properties": {
                    **_base_props(),
                    # Structural parent FK (convention field) — excluded by
                    # get_parent_fk_props() at both call sites.
                    "asn_id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    # Same relation name the PARENT also declares — this is
                    # what the buggy `parent_rel_prop_names` exclusion caught.
                    "organization_id": _fk_field("organization", nullable=False),
                },
            },
        }
    }


def _ctx() -> dict:
    entity = _entity("asn", children=[_child_entry("asn_line", "asn_lines")])
    built = build_context(entity, _schema())
    return form_upsert_context(built, _schema())


def test_shared_relation_name_config_is_declared():
    """The child's own organizationIdConfig useMemo must be declared."""
    ctx = _ctx()
    assert "const organizationIdConfig = useMemo<EntityAutocompleteCellConfig>" in ctx["child_entity_rel_opt"]


def test_shared_relation_name_config_call_site_matches_declaration():
    """Every {prop}Config referenced by the columns-hook call site must have
    a matching useMemo declaration -- the two call sites must never diverge."""
    ctx = _ctx()
    assert "organizationIdConfig" in ctx["child_grid_setup"]
    assert "const organizationIdConfig = useMemo" in ctx["child_entity_rel_opt"]


def test_structural_parent_fk_still_excluded():
    """asn_id (the structural parent FK) must never get its own config --
    unchanged existing behavior, not part of this bug."""
    ctx = _ctx()
    assert "asnIdConfig" not in ctx["child_entity_rel_opt"]
    assert "asnIdConfig" not in ctx["child_grid_setup"]
