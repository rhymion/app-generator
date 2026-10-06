"""
A child whose primary FK targets an entity with a numeric (integer) field that
is part of the target's display label.

The label text a generated spec expects for such a row and the value the
populate helper seeds into that column used to come from two different rules:
the spec expected `unique_index * 100` while the dependency helper seeded the
schema `minimum` flat, so a column with `minimum: 1` rendered `... 1` where the
spec asserted `... 100`. Both now derive from `_numeric_unique_seed` /
`_numeric_unique_expr`, which this test pins together.
"""
import pytest

from generate import _make_env
from generators_test import (
    _numeric_unique_expr,
    _numeric_unique_seed,
    _seed_relation_label_value,
    helper_context,
)

GENERATE_CONFIG = {
    "list": True, "view": True, "new": True, "edit": True,
    "delete": True, "api": False, "test": True, "fields": None,
}


def _schema(prop: dict) -> dict:
    return {
        "definitions": {
            "clinic": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {"id": {"type": "string"}, "name": {"type": "string"}},
            },
            "placement": {
                "type": "object",
                "required": ["id", "slot_no", "clinic_id"],
                "properties": {
                    "id": {"type": "string"},
                    "slot_no": prop,
                    "clinic_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "clinic", "labelField": "name"},
                    },
                },
                "x-display": {"table": [{"slot_no": {"primary": True}}]},
            },
            "checkup": {
                "type": "object",
                "required": ["id", "placement_id"],
                "properties": {
                    "id": {"type": "string"},
                    "placement_id": {
                        "type": "string",
                        "x-relationship": {"type": "many-to-one", "target": "placement", "labelField": "slot_no"},
                    },
                },
                "x-display": {"table": [{"placement": {"primary": True}}]},
            },
            "checkup_detail": {"allOf": [{"$ref": "#/definitions/checkup"}]},
        },
    }


@pytest.mark.parametrize(
    "prop, expected_value, expected_expr",
    [
        ({"type": "integer", "minimum": 1}, 100, "Math.max(1, i * 100)"),
        ({"type": "integer", "minimum": 500}, 500, "Math.max(500, i * 100)"),
        ({"type": "integer", "minimum": 1, "maximum": 50}, 50, "Math.min(50, Math.max(1, i * 100))"),
        ({"type": "integer"}, 100, "i * 100"),
    ],
)
def test_expected_label_and_seeded_value_come_from_one_rule(prop, expected_value, expected_expr):
    schema = _schema(prop)

    # What the spec expects the primary FK label to show for the first row.
    label = _seed_relation_label_value("placement", "slot_no", False, schema, unique_index=1)
    assert label == str(expected_value)
    assert _numeric_unique_seed(prop, 1) == expected_value

    # What the helper seeds into that column (emitted TypeScript expression).
    assert _numeric_unique_expr(prop, "i") == expected_expr
    ctx = helper_context("checkup", [], schema, "checkup", "checkup_detail", GENERATE_CONFIG)
    out = _make_env().get_template("test_helper.ts.jinja2").render(**ctx)
    assert f"slot_no: {expected_expr}," in out


def test_dependency_rows_without_a_row_index_keep_the_minimum():
    # The shared dependency rows (the `A`-suffixed ones) are not indexed and
    # keep seeding the schema minimum, with the matching label.
    prop = {"type": "integer", "minimum": 1}
    schema = _schema(prop)
    assert _seed_relation_label_value("placement", "slot_no", False, schema) == "1"
