"""
Regression test for #1044: the generated API spec's per-entity search example
asserts that a freshly created row surfaces in /api/search. The test API user
follows SEED_ENTITY_GRANTS, so an entity whose seed read grant is false (no
list and no view page) can never surface there and the example must not be
emitted. An entity that keeps either page stays searchable.
"""
import pytest

from generate import _make_env
from generators_test import api_spec_context

_N10 = "N10 per-entity data surfaces in global search results"


def _render(list_: bool, view: bool) -> tuple[dict, str]:
    schema = {
        "definitions": {
            "clinic": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                },
                "x-display": {"table": [{"name": {"primary": True}}]},
                "x-generate": {
                    "list": list_, "view": view, "new": True, "edit": True,
                    "delete": True, "api": True, "test": True, "search": True,
                },
            },
            "clinic_detail": {"allOf": [{"$ref": "#/definitions/clinic"}]},
        },
    }
    cfg = {
        "list": list_, "view": view, "new": True, "edit": True,
        "delete": True, "api": True, "test": True, "fields": None,
    }
    ctx = api_spec_context("clinic", [], schema, "clinic", "clinic_detail", cfg)
    return ctx, _make_env().get_template("test_api_spec.cy.ts.jinja2").render(**ctx)


@pytest.mark.parametrize("list_,view", [(True, True), (True, False), (False, True)])
def test_entity_with_read_grant_stays_searchable(list_, view):
    ctx, out = _render(list_, view)
    assert ctx["is_searchable"] is True
    assert _N10 in out


def test_entity_without_read_grant_is_not_searchable():
    ctx, out = _render(False, False)
    assert ctx["is_searchable"] is False
    assert _N10 not in out
