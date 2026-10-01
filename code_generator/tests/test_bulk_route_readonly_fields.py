"""Regression test for Issue #787: the bulk routes silently ignored read-only
fields that the single routes reject.

Single `POST` answers 400 "Field X is read-only and cannot be set" and single
`PUT` answers 400 "... cannot be changed" (when the value differs from the
stored one). `POST /bulk` and `PUT /bulk` had no such check, so a read-only
value in an item was dropped and the item reported `success: true`. The bulk
routes answer per item, so the same rule is reported as that item's failure.

The rule is driven by `readonly_fields_create_reject` / `readonly_fields_api`,
which cover every `x-readonly` / `x-readonly-fields` field, so this is not
specific to payment fields.
"""
import pathlib

from jinja2 import Environment, FileSystemLoader

from build_context import build_context

TEMPLATES_DIR = pathlib.Path(__file__).resolve().parents[1] / 'templates'


def _schema(field_level_ro=None, entity_level_ro=None) -> dict:
    props: dict = {
        "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
        "name": {"type": "string"},
        "status": {"type": "string"},
        "note": {"type": ["string", "null"]},
    }
    for fn in field_level_ro or []:
        props[fn] = {**props[fn], "x-readonly": True}
    view_def: dict = {
        "x-generate": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": False, "fields": None,
        },
        "allOf": [{"$ref": "#/definitions/item"}],
    }
    if entity_level_ro:
        view_def["x-readonly-fields"] = entity_level_ro
    return {"definitions": {
        "item": {"type": "object", "required": ["id", "name"], "properties": props},
        "item_detail": view_def,
    }}


def _render(schema: dict) -> str:
    from helpers.naming import to_pascal_case, to_camel_case
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        trim_blocks=True, lstrip_blocks=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    entity = {
        "parent": "item", "model": "item", "definition_key": "item_detail",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": False, "fields": None,
        },
    }
    ctx = build_context(entity, schema)
    return env.get_template('api_bulk_route.ts.jinja2').render(**ctx)


def _section(out: str, start: str, end: str) -> str:
    return out[out.index(start):out.index(end)]


def test_bulk_post_rejects_field_level_readonly_value_per_item():
    out = _render(_schema(field_level_ro=["status"]))
    post = _section(out, 'export async function POST', 'export async function PUT')
    assert "if (bulkItems[i].status !== undefined) {" in post
    assert "error: 'Field status is read-only and cannot be set'" in post
    # The rejection must come before the service call that would store it.
    assert post.index("Field status is read-only") < post.index("await addItem(")


def test_bulk_post_rejects_entity_level_x_readonly_fields_too():
    out = _render(_schema(entity_level_ro=["note"]))
    post = _section(out, 'export async function POST', 'export async function PUT')
    assert "Field note is read-only and cannot be set" in post


def test_bulk_put_rejects_readonly_value_that_differs_from_stored():
    out = _render(_schema(field_level_ro=["status"]))
    put = _section(out, 'export async function PUT', 'export async function DELETE')
    assert "String(bulkItems[i].status) !== String(existing.status)" in put
    assert "error: 'Field status is read-only and cannot be changed'" in put
    assert put.index("cannot be changed") < put.index("await updateItem(")
    # `existing` must actually carry the field the comparison reads.
    assert "...{ status: true }" in put


def test_bulk_routes_without_readonly_fields_are_unchanged():
    out = _render(_schema())
    assert "is read-only" not in out
    assert "select: { id: true, creator_id: true }," in out
