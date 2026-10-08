"""
x-exclusive-parents: rows of an exclusive child that the generated helpers create
as a side effect of another entity's helper set exactly one owner column.

Two paths write such rows through Prisma, bypassing the save-time validator:
a dependency row (populate<Entity>Dependencies) and the child row added to an
existing parent (populate<Parent><Child>Data). Both keep only one owner column.
Entities without the declaration keep every FK, as before.
"""
import re
import sys
from pathlib import Path

import pytest
from jinja2 import Environment, FileSystemLoader

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from generate_types import _extract_children  # noqa: E402
from generators_test import helper_context  # noqa: E402
from helpers.naming import to_camel_case, to_pascal_case  # noqa: E402
from build_user_schema import build_intermediate_schema  # noqa: E402
from schema_deriver import parse_prisma_schema  # noqa: E402
from test_x_exclusive_parents import PRISMA, _user_schema  # noqa: E402,F401

CONFIG = {
    'list': True, 'view': True, 'new': True, 'edit': True,
    'delete': True, 'api': False, 'test': True, 'fields': None,
}

# `reading` requires a placement, so the placement becomes a dependency row of its helper.
PRISMA_WITH_READING = PRISMA.replace(
    '  @@index([placed_alpha_id])\n}',
    '  readings reading[]\n  @@index([placed_alpha_id])\n}',
) + """
model reading {
  id String @id @default(cuid())
  name String
  placement_id String
  placement placement @relation(fields: [placement_id], references: [id])
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
  @@index([placement_id])
}
"""


@pytest.fixture(scope='module')
def models(tmp_path_factory):
    path = tmp_path_factory.mktemp('prisma_reading') / 'schema.prisma'
    path.write_text(PRISMA_WITH_READING)
    return parse_prisma_schema(path)


def _schema(models, exclusive=('alpha', 'beta')) -> dict:
    user = _user_schema(exclusive)
    user['definitions']['reading'] = {
        'x-display': {'table': [{'name': {'primary': True}}]},
        'fields': {'name': {}, 'placement_id': {'x-relationship': {}}},
    }
    return build_intermediate_schema(user, models)


def _render(schema: dict, entity: str) -> str:
    env = Environment(
        loader=FileSystemLoader(str(Path(__file__).resolve().parents[1] / 'templates')),
        trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    children = _extract_children(schema['definitions'][entity], schema)
    ctx = helper_context(entity, children, schema, entity, entity, CONFIG)
    return env.get_template('test_helper.ts.jinja2').render(**ctx)


def _create_data(text: str, create: str) -> str:
    start = text.index(create)
    return text[start:text.index('\n    });', start)]


def test_dependency_row_writes_one_owner(models):
    text = _render(_schema(models), 'reading')
    data = _create_data(text, 'prisma.placement.create(')
    assert re.search(r'\balpha_id:', data), data
    assert not re.search(r'\bbeta_id:', data), data


def test_dependency_row_follows_declaration_order(models):
    text = _render(_schema(models, ('beta', 'alpha')), 'reading')
    data = _create_data(text, 'prisma.placement.create(')
    assert re.search(r'\bbeta_id:', data) and not re.search(r'\balpha_id:', data), data


def test_dependency_row_without_the_key_writes_every_owner(models):
    text = _render(_schema(models, None), 'reading')
    data = _create_data(text, 'prisma.placement.create(')
    assert re.search(r'\balpha_id:', data) and re.search(r'\bbeta_id:', data), data


def test_other_required_fk_of_the_dependency_is_kept(models):
    text = _render(_schema(models), 'reading')
    assert re.search(r'\bplaced_alpha_id:', _create_data(text, 'prisma.placement.create('))


def test_child_of_parent_row_writes_only_the_parents_column(models):
    schema = _schema(models)
    for parent, own, other in (('alpha', 'alpha_id', 'beta_id'), ('beta', 'beta_id', 'alpha_id')):
        text = _render(schema, parent)
        if 'populate' + parent.capitalize() + 'PlacementData(' not in text:
            pytest.skip(f'{parent} embeds no datagrid child in this fixture')
        data = _create_data(text, 'export async function populate' + parent.capitalize() + 'PlacementData(')
        assert re.search(rf'\b{own}: parentId', data), data
        assert not re.search(rf'\b{other}:', data), data
