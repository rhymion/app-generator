"""A grid child drawn by a hand-written component (`x-custom-component`, target upsert) is not driven by
the generated UI tests: `get_child_render_type()` gives it its own render type, so it joins neither the
datagrid nor the read-only datagrid sections of the generated spec."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from generate_types import _extract_children
from generators_test import get_child_render_type


def _schema(xc):
    widgets = {"type": "array", "items": {"$ref": "#/definitions/widget"}}
    if xc is not None:
        widgets["x-custom-component"] = xc
    return {
        "definitions": {
            "__board": {"type": "object", "properties": {"id": {"type": "string"}}},
            "board": {"allOf": [{"$ref": "#/definitions/__board"}, {"type": "object", "properties": {"widgets": widgets}}]},
            "widget": {"type": "object", "properties": {"id": {"type": "string"}, "board_id": {"type": "string"}}},
        }
    }


def _child(xc):
    schema = _schema(xc)
    (child,) = _extract_children(schema["definitions"]["board"], schema)
    return child, schema


def test_upsert_target_gets_its_own_render_type():
    child, schema = _child({"target": ["upsert"]})
    assert get_child_render_type(child, schema, "board") == "custom-component"


def test_view_only_target_keeps_the_grid():
    child, schema = _child({"target": ["view"]})
    assert get_child_render_type(child, schema, "board") == "datagrid"


def test_no_key_keeps_the_grid():
    child, schema = _child(None)
    assert get_child_render_type(child, schema, "board") == "datagrid"
