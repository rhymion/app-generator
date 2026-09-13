"""
Regression test for cmd_1047i (addendum): embedded DataGrid column order.

Background
----------
Per the 2026-09-13 ruling folded into cmd_1047 AC21: if a fix is made,
align the DataGrid's displayed column order with the child's own
`x-display.form` declaration -- but what gets shown must stay exactly as
before (e.g. parent info still excluded).

`column_def_context()` (generators.py) previously iterated
`child_props.items()` in raw schema declaration order with no awareness of
`x-display.form` at all. The fix reorders that iteration using the child's
own `x-display.form` (when declared) as a pure ORDER source, appending any
field not named in it afterward in original schema order -- mirroring
build_context.py's `export_scalar_fields` order source (~L1912).

The trap this test exists to catch: `form_view_context`/`spec_context`'s own
`_ordered_fields = [f for f in _x_display_form if f in jsx_by_field]`
pattern ALSO narrows the rendered SET to x-display.form's membership (a
field present but not named in x-display.form is dropped entirely) --
intentional there, but wrong for this DataGrid column loop, which must
change ONLY the order:

  (1) a field NOT named in x-display.form that is otherwise shown must
      keep being shown.
  (2) a field named in x-display.form that is NOT otherwise shown (e.g.
      parent info) must not newly appear.
"""
import re

from build_context import build_context
from generators import column_def_context


def _base_props(extra: dict | None = None) -> dict:
    props = {
        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
    }
    props.update(extra or {})
    return props


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
    return {
        "name": name,
        "property_name": prop,
        "output_type": None,
        "file_type": None,
        "relationship": None,
    }


def _schema(with_x_display: bool) -> dict:
    """
    `doc_line` (embedded non-list grid child of `doc`) declares scalar
    columns in schema order alpha, beta, gamma, delta. `x-display.form`
    (when present) names only [delta, beta, missing_parent_field] --
    deliberately: reordering two of the four real columns, omitting two
    real columns (alpha, gamma -- point (1)), and naming one field that is
    not a property of doc_line at all (point (2), standing in for "parent
    info").
    """
    doc_line_def = {
        "type": "object",
        "required": ["id", "doc_id"],
        "properties": {
            **_base_props(),
            "doc_id": {"type": "string"},
            "alpha": {"type": "string"},
            "beta": {"type": "string"},
            "gamma": {"type": "string"},
            "delta": {"type": "string"},
        },
    }
    if with_x_display:
        doc_line_def["x-display"] = {"form": ["delta", "beta", "missing_parent_field"]}
    return {
        "definitions": {
            "doc": {
                "type": "object",
                "required": ["id"],
                "properties": _base_props(),
            },
            "doc_line": doc_line_def,
        }
    }


def _fn_code(with_x_display: bool) -> str:
    entity = _entity("doc", children=[_child_entry("doc_line", "lines")])
    schema = _schema(with_x_display)
    built = build_context(entity, schema)
    ctx = column_def_context(built, schema)
    return ctx["column_children"][0]["fn_code"]


def _field_order(fn_code: str) -> list[str]:
    return re.findall(r"field: '(\w+)'", fn_code)


def test_no_x_display_form_keeps_plain_schema_order():
    """Baseline (existing behavior, unaffected): with no x-display.form,
    columns render in raw schema property order."""
    fields = _field_order(_fn_code(with_x_display=False))
    assert fields == ["alpha", "beta", "gamma", "delta"]


def test_x_display_form_reorders_named_fields_first():
    """delta/beta (named in x-display.form, in that order) come first,
    ahead of alpha/gamma (not named)."""
    fields = _field_order(_fn_code(with_x_display=True))
    assert fields[:2] == ["delta", "beta"]


def test_unnamed_field_still_shown():
    """Point (1): alpha and gamma are not named in x-display.form but were
    shown before -- they must still be shown."""
    fields = _field_order(_fn_code(with_x_display=True))
    assert "alpha" in fields
    assert "gamma" in fields


def test_unnamed_fields_appended_after_named_ones_in_original_order():
    """The remaining (unnamed) fields keep their original relative schema
    order, appended after the x-display.form-named ones."""
    fields = _field_order(_fn_code(with_x_display=True))
    assert fields == ["delta", "beta", "alpha", "gamma"]


def test_x_display_form_entry_with_no_matching_property_never_shown():
    """Point (2): x-display.form naming a field this child has no property
    for (standing in for parent info) must never cause it to be shown --
    the set of shown columns is unchanged, only their order."""
    fields = _field_order(_fn_code(with_x_display=True))
    assert "missing_parent_field" not in fields


def test_shown_column_set_identical_with_and_without_x_display_form():
    """The exclusion/inclusion decision (what's shown) must be identical
    regardless of x-display.form -- only ordering may differ."""
    without = set(_field_order(_fn_code(with_x_display=False)))
    with_ = set(_field_order(_fn_code(with_x_display=True)))
    assert without == with_
