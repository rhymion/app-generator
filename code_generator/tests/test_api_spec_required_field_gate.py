"""
Regression test for #1031: the generated API spec's 5.1 and 8.2 examples
omit one required field and expect a 4xx / a failed bulk row. An entity with
no required field has nothing to omit, so both examples must not be emitted.
"""
from generate import _make_env
from generators_test import api_spec_context

_CASES = (
    "5.1 fails when a required field is missing",
    "8.2 bulk creates — partial failure when a required field is missing",
)


def _render(required: list[str]) -> tuple[dict, str]:
    schema = {
        "definitions": {
            "clinic": {
                "type": "object",
                "required": required,
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "note": {"type": "string"},
                },
                "x-display": {"table": [{"name": {"primary": True}}]},
            },
            "clinic_detail": {"allOf": [{"$ref": "#/definitions/clinic"}]},
        },
    }
    cfg = {
        "list": True, "view": True, "new": True, "edit": True,
        "delete": True, "api": True, "test": True, "fields": None,
    }
    ctx = api_spec_context("clinic", [], schema, "clinic", "clinic_detail", cfg)
    return ctx, _make_env().get_template("test_api_spec.cy.ts.jinja2").render(**ctx)


def test_entity_with_required_field_keeps_both_validation_examples():
    ctx, out = _render(["id", "name"])
    assert ctx["has_required_field_to_omit"] is True
    for title in _CASES:
        assert title in out


def test_entity_without_required_field_emits_neither_validation_example():
    ctx, out = _render(["id"])
    assert ctx["has_required_field_to_omit"] is False
    for title in _CASES:
        assert title not in out
    # The rest of the bulk section is still generated.
    assert "describe('POST " in out
    assert "/bulk" in out
