"""app-generator #848: the Cypress helper grantAllEntityPermissions must grant what the real
seeded Administrator holds (SEED_ENTITY_GRANTS, which respects x-generate), not full CRUD on
every entity, so a spec cannot pass on a right that no real role has."""
from pathlib import Path

import jinja2

from generators_test import db_helpers_context

_TEMPLATES = Path(__file__).resolve().parent.parent / 'templates'


def _render_helper() -> str:
    env = jinja2.Environment(loader=jinja2.FileSystemLoader(str(_TEMPLATES)), trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True)
    ctx = db_helpers_context({'definitions': {}}, test_entity_names=['widget', 'category'])
    return env.get_template('test_db_helpers.ts.jinja2').render(**ctx)


def _grant_fn_body(rendered: str) -> str:
    start = rendered.index('export async function grantAllEntityPermissions')
    return rendered[start:rendered.index('\n}\n', start)]


def test_helper_imports_generated_seed_entity_grants() -> None:
    rendered = _render_helper()
    assert "import { SEED_ENTITY_GRANTS } from '../../scripts/generated/seed-entities';" in rendered


def test_grant_all_entity_permissions_takes_flags_from_seed_entity_grants() -> None:
    body = _grant_fn_body(_render_helper())
    assert 'SEED_ENTITY_GRANTS[entity]' in body
    for op in ('create', 'read', 'update', 'delete', 'import'):
        assert f'{op}: grant.{op},' in body, f'{op} must come from the seeded grant'


def test_grant_all_entity_permissions_does_not_hardcode_full_crud_per_permission_row() -> None:
    body = _grant_fn_body(_render_helper())
    data_block = body[body.index('prisma.permission.create'):]
    assert 'create: true' not in data_block
    assert 'update: true' not in data_block
    assert 'delete: true' not in data_block
