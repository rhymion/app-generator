"""
Regression tests for permission-cache invalidation wiring in the generated
service layer.

The permission cache (lib/authz.ts) keeps what a user may do for up to 30
seconds. The generated service functions of the entities that change those
answers -- role, permission and user (role membership) -- must drop the cache
after their write commits, so the change applies on the instance that handled
the write at once. Every other entity must not touch the cache.
"""
from pathlib import Path
import re

import pytest
from jinja2 import Environment, FileSystemLoader

from build_context import build_context, PERMISSION_CACHE_MODELS
from generators import service_context

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = REPO_ROOT / 'code_generator' / 'templates'

CALL = 'await invalidatePermissionCache();'


def _schema(model: str) -> dict:
    return {
        "definitions": {
            model: {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                    "id": {"type": "string", "pattern": "^c[a-z0-9]{24,}$"},
                    "name": {"type": "string"},
                },
            },
            f"{model}_detail": {
                "x-generate": {"list": True, "view": True, "new": True, "edit": True,
                               "delete": True, "api": True, "test": False},
                "allOf": [{"$ref": f"#/definitions/{model}"}],
            },
        }
    }


def _render(model: str) -> str:
    from helpers.naming import to_pascal_case, to_camel_case
    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)),
                      trim_blocks=True, lstrip_blocks=True)
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    entity = {
        "parent": model, "model": model, "definition_key": f"{model}_detail",
        "children": [],
        "generate_config": {"list": True, "view": True, "new": True, "edit": True,
                            "delete": True, "api": True, "test": False, "fields": None},
    }
    schema = _schema(model)
    ctx = build_context(entity, schema)
    svc = service_context(ctx, schema)
    return env.get_template('service.ts.jinja2').render(**{**ctx, **svc})


def test_permission_models_are_role_permission_user():
    assert PERMISSION_CACHE_MODELS == {'role', 'permission', 'user'}


@pytest.mark.parametrize('model', sorted(PERMISSION_CACHE_MODELS))
def test_service_clears_permission_cache_after_each_write_commits(model):
    out = _render(model)
    assert "import { invalidatePermissionCache } from '@/lib/authz';" in out
    # One call each in add, update and delete.
    assert out.count(CALL) == 3
    lines = [ln.strip() for ln in out.splitlines()]
    for i, ln in enumerate(lines):
        if ln != CALL:
            continue
        # The call follows the transaction (and its catch block), never sits in it.
        prev = [p for p in lines[:i] if p and not p.startswith('//')][-1]
        assert prev in ('}', '});'), f'call at line {i} follows {prev!r}'
    for fn in ('add', 'update', 'delete'):
        body = re.search(rf'export async function {fn}\w+\(.*?\n}}\n', out, re.S).group(0)
        assert body.count(CALL) == 1, f'{fn} function must clear the cache once'


def test_other_entities_do_not_touch_the_permission_cache():
    out = _render('thing')
    assert 'invalidatePermissionCache' not in out
    assert "from '@/lib/authz'" not in out or 'invalidatePermissionCache' not in out
