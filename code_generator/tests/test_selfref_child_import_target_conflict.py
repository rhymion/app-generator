"""
Regression test for subtask_1047e (cmd_1047 follow-up, "Bug B").

Background
----------
`build_entity_context()` (context.py) computes two things independently,
without either referencing the other:

  1. `import_targets` — external types.ts must `import type {X} from
     '@/lib/X/types'`. Built (in part) from `child_rels_early`, which
     collects every many-to-one relation of every non-list child.
  2. Per-child `declare_type` — whether a child's own type is declared
     LOCALLY inline in this file (True) or imported from its own module
     (False / independent).

A self-referencing child (a many-to-one relation whose own target is
itself, e.g. an x-splittable "line" entity's `parent_<line>_id` FK back to
its own type) is BOTH: its own target name ends up in `import_targets` via
(1), AND it is not independent, so `declare_type=True` via (2). The
generated `types.ts` then contains both
`import type { ChildLine } from '@/lib/child_line/types'` AND
`export type ChildLine = {...}` in the same file — `TS2440: Import
declaration conflicts with local declaration`. Confirmed live on proj_g's
`goods_receipt_line` (self-referencing FK from x-splittable), subtask_1047d.

The fix excludes any child name that will be declared locally (mirroring
the same is_independent check the children loop applies) from
`import_targets`, both when it is first built and when a locally-declared
child's own relation targets get appended to it afterward.
"""
from dataclasses import asdict

from context import build_entity_context


def _id_prop() -> dict:
    return {"type": "string", "pattern": "^c[a-z0-9]{24,}$"}


def _entity(model: str, children: list) -> dict:
    return {
        "parent": model,
        "model": model,
        "definition_key": model,
        "children": children,
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": True, "fields": None,
        },
    }


def _child_entry(name: str, prop: str) -> dict:
    """A non-list (embedded grid) child -- output_type left unset, matching
    the shape produced once x-outputType: list is removed from a line
    entity (the exact trigger condition on proj_g)."""
    return {
        "name": name,
        "property_name": prop,
        "output_type": None,
        "file_type": None,
        "relationship": None,
    }


def _schema() -> dict:
    """
    `parent_doc.lines` embeds `doc_line`, a non-list child that carries a
    self-referencing many-to-one relation (`parent_line_id` -> itself) --
    the x-splittable "parent/child line" pattern goods_receipt_line uses.
    """
    return {
        "definitions": {
            "parent_doc": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {"id": _id_prop(), "name": {"type": "string"}},
            },
            "doc_line": {
                "type": "object",
                "required": ["id", "parent_doc_id"],
                "properties": {
                    "id": _id_prop(),
                    # Structural parent FK (convention field).
                    "parent_doc_id": _id_prop(),
                    "quantity": {"type": "number"},
                    # Self-referencing FK: target == this child's own name.
                    "parent_line_id": {
                        "type": ["string", "null"],
                        "pattern": "^c[a-z0-9]{24,}$",
                        "x-relationship": {
                            "type": "many-to-one",
                            "target": "doc_line",
                            "labelField": "quantity",
                        },
                    },
                },
            },
        }
    }


def _ctx() -> dict:
    entity = _entity("parent_doc", children=[_child_entry("doc_line", "lines")])
    return asdict(build_entity_context(entity, _schema()))


def test_selfref_child_not_in_import_targets():
    """A self-referencing non-list child's own name must never appear in
    import_targets -- it is declared locally, not imported."""
    ctx = _ctx()
    assert "doc_line" not in ctx["import_targets"]


def test_selfref_child_is_declared_locally():
    """The self-referencing child must be locally declared (declare_type=True),
    consistent with import_targets excluding it."""
    ctx = _ctx()
    children_by_name = {c["name"]: c for c in ctx["children"]}
    assert children_by_name["doc_line"]["declare_type"] is True


def test_no_import_and_local_declare_conflict_for_any_child():
    """General invariant this fix restores: no child that will be locally
    declared may also appear in import_targets (the exact TS2440 shape)."""
    ctx = _ctx()
    locally_declared = {c["name"] for c in ctx["children"] if c["declare_type"]}
    assert not (locally_declared & set(ctx["import_targets"]))


def test_selfref_child_not_in_all_option_targets():
    """Sibling of the import_targets fix: a self-referencing child's own
    name must not appear in all_option_targets either -- found via
    subtask_1047g's own empirical fixture verification, where this produced
    a dead initial{Child}s/search{Child}Options FormUpsertProps pair nothing
    in the generated component ever uses (child_rel_targets shares the same
    child_rels_early root cause as import_targets, just a different
    downstream consumer)."""
    ctx = _ctx()
    assert "doc_line" not in ctx["all_option_targets"]
