"""Regression test for cmd_607: api_bulk_route.ts.jinja2's PUT/DELETE handlers
declared `const richPerms = await requireApiPermission(...)` unconditionally,
but only *read* richPerms in the non-self-only branch (general/creator/assignee
checks) — x-self-only entities gate purely on `existing.creator_id === actorId`
and never reference richPerms, leaving it a dead binding
(`@typescript-eslint/no-unused-vars`, TS6133) in every self-only entity's
generated bulk route (e.g. `setting`, discovered via a real generate-code +
lint run — see docs/knowledge/cmd607-generator-lint-debt-fix.md).

The permission call itself must still run (it's the actual authorization
gate, throwing on denial) — only the *binding* of its result is conditional.
"""
import pytest
from jinja2 import Environment, FileSystemLoader

from build_context import build_context

import pathlib
TEMPLATES_DIR = pathlib.Path(__file__).resolve().parents[1] / 'templates'


def _id_prop() -> dict:
    return {"type": "string", "pattern": "^c[a-z0-9]{24,}$"}


def _base_thing(self_only: bool) -> dict:
    base: dict = {
        "type": "object",
        "required": ["id", "name"],
        "properties": {"id": _id_prop(), "name": {"type": "string"}},
    }
    if self_only:
        base["x-self-only"] = True
    return base


def _detail_thing() -> dict:
    return {
        "x-generate": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": False,
        },
        "allOf": [{"$ref": "#/definitions/thing"}],
    }


def _entity() -> dict:
    return {
        "parent": "thing",
        "model": "thing",
        "definition_key": "thing_detail",
        "children": [],
        "generate_config": {
            "list": True, "view": True, "new": True, "edit": True,
            "delete": True, "api": True, "test": False, "fields": None,
        },
    }


def _schema(self_only: bool) -> dict:
    return {"definitions": {"thing": _base_thing(self_only), "thing_detail": _detail_thing()}}


def _render(schema: dict) -> str:
    from helpers.naming import to_pascal_case, to_camel_case
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        trim_blocks=True, lstrip_blocks=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    ctx = build_context(_entity(), schema)
    return env.get_template('api_bulk_route.ts.jinja2').render(**ctx)


def test_self_only_bulk_route_does_not_bind_unused_richperms():
    out = _render(_schema(self_only=True))
    assert 'const richPerms' not in out
    # The permission check must still run unconditionally as a side effect.
    assert "await requireApiPermission(actorId, 'thing', 'update');" in out
    assert "await requireApiPermission(actorId, 'thing', 'delete');" in out
    # Ownership-only gate is unaffected.
    assert 'const canUpdate = existing.creator_id === actorId;' in out
    assert 'const canDelete = existing.creator_id === actorId;' in out
    # richPerms.* is never referenced.
    assert 'richPerms.' not in out


def test_non_self_only_bulk_route_still_binds_and_uses_richperms():
    out = _render(_schema(self_only=False))
    assert "const richPerms = await requireApiPermission(actorId, 'thing', 'update');" in out
    assert "const richPerms = await requireApiPermission(actorId, 'thing', 'delete');" in out
    assert 'richPerms.general.update' in out
    assert 'richPerms.general.delete' in out
