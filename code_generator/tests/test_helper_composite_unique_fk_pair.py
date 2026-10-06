"""
A composite @@unique made only of required FKs: the populate loop writes a
distinct FK pair on every iteration.

Without a primary display FK the loop read every FK off the single shared
dependency row, so the second create() of populate<Entity>Data(2) violated the
composite unique. One FK of the group now gets a fresh row per iteration (the
cheapest target that has no composite unique of its own). Entities with no
composite unique over FKs render the same helper as before.
"""
import re
import sys
from pathlib import Path

import pytest
from jinja2 import Environment, FileSystemLoader

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import generators_test  # noqa: E402
from generators_test import helper_context  # noqa: E402
from helpers.naming import to_camel_case, to_pascal_case  # noqa: E402
from build_user_schema import build_intermediate_schema  # noqa: E402
from schema_deriver import collect_unique_columns, parse_prisma_schema  # noqa: E402

CONFIG = {
    'list': True, 'view': True, 'new': True, 'edit': True,
    'delete': True, 'api': False, 'test': True, 'fields': None,
}

AUDIT = """  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
"""

PRISMA = f"""
model alpha {{
  id String @id @default(cuid())
  name String
  pairings pairing[]
  tripled triple[]
{AUDIT}}}

model beta {{
  id String @id @default(cuid())
  name String
  pairings pairing[]
  tripled triple[]
{AUDIT}}}

model gamma {{
  id String @id @default(cuid())
  name String
  tripled triple[]
{AUDIT}}}

model pairing {{
  id String @id @default(cuid())
  value String
  alpha_id String
  alpha alpha @relation(fields: [alpha_id], references: [id])
  beta_id String
  beta beta @relation(fields: [beta_id], references: [id])
{AUDIT}  @@unique([alpha_id, beta_id])
}}

model triple {{
  id String @id @default(cuid())
  value String
  alpha_id String
  alpha alpha @relation(fields: [alpha_id], references: [id])
  beta_id String
  beta beta @relation(fields: [beta_id], references: [id])
  gamma_id String
  gamma gamma @relation(fields: [gamma_id], references: [id])
{AUDIT}  @@unique([alpha_id, beta_id, gamma_id])
}}

model plain {{
  id String @id @default(cuid())
  value String
  alpha_id String
  alpha alpha @relation(fields: [alpha_id], references: [id])
  beta_id String
  beta beta @relation(fields: [beta_id], references: [id])
{AUDIT}}}
"""


def _user_schema() -> dict:
    def entity(*fks):
        return {'fields': {'value': {}, **{f: {'x-relationship': {}} for f in fks}}}

    return {
        'definitions': {
            'alpha': {'fields': {'name': {}}},
            'beta': {'fields': {'name': {}}},
            'gamma': {'fields': {'name': {}}},
            'pairing': entity('alpha_id', 'beta_id'),
            'triple': entity('alpha_id', 'beta_id', 'gamma_id'),
            'plain': entity('alpha_id', 'beta_id'),
        },
    }


@pytest.fixture(scope='module')
def models(tmp_path_factory):
    path = tmp_path_factory.mktemp('prisma') / 'schema.prisma'
    path.write_text(PRISMA)
    return parse_prisma_schema(path)


@pytest.fixture()
def schema(models):
    previous = generators_test._prisma_uniques
    generators_test.set_prisma_uniques(collect_unique_columns(models))
    try:
        yield build_intermediate_schema(_user_schema(), models)
    finally:
        generators_test.set_prisma_uniques(previous)


def _helper(schema: dict, entity: str) -> str:
    env = Environment(
        loader=FileSystemLoader(str(Path(__file__).resolve().parents[1] / 'templates')),
        trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    ctx = helper_context(entity, [], schema, entity, entity, CONFIG)
    return env.get_template('test_helper.ts.jinja2').render(**ctx)


def _populate_data(text: str, entity: str) -> str:
    name = f'populate{to_pascal_case(entity)}Data'
    start = text.index(f'export async function {name}(')
    return text[start:text.index('\nexport ', start + 1)]


def _loop_body(body: str) -> str:
    return body[body.index('for (let i = 1'):]


def test_pair_writes_a_fresh_row_for_one_fk_per_iteration(schema):
    loop = _loop_body(_populate_data(_helper(schema, 'pairing'), 'pairing'))
    fresh = re.findall(r'const (\w+)Item = await prisma\.(\w+)\.create', loop)
    assert len(fresh) == 1, loop
    assert fresh[0][1] in ('alpha', 'beta'), loop
    assert re.search(r'\b(alpha|beta)_id: (alpha|beta)Item\.id', loop), loop


def test_pair_keeps_the_other_fk_on_the_shared_dependency(schema):
    loop = _loop_body(_populate_data(_helper(schema, 'pairing'), 'pairing'))
    assert len(re.findall(r'\b(?:alpha|beta)_id: deps\.\w+\.id', loop)) == 1, loop


def test_pair_fresh_row_is_unique_per_call_and_iteration(schema):
    loop = _loop_body(_populate_data(_helper(schema, 'pairing'), 'pairing'))
    assert '${callIndex}_${i}' in loop, loop
    assert 'const callIndex = _PairingCallSeq++' in _helper(schema, 'pairing')


def test_triple_varies_exactly_one_fk(schema):
    loop = _loop_body(_populate_data(_helper(schema, 'triple'), 'triple'))
    assert len(re.findall(r'const \w+Item = await prisma\.\w+\.create', loop)) == 1, loop


def test_entity_without_a_composite_unique_renders_the_same_helper(schema):
    loop = _loop_body(_populate_data(_helper(schema, 'plain'), 'plain'))
    assert 'Item = await prisma.' not in loop.replace('prisma.plain.create', ''), loop
    assert len(re.findall(r'\b(?:alpha|beta)_id: deps\.\w+\.id', loop)) == 2, loop


def test_helper_is_unchanged_when_no_uniques_are_registered(models):
    previous = generators_test._prisma_uniques
    generators_test.set_prisma_uniques({})
    try:
        loop = _loop_body(_populate_data(
            _helper(build_intermediate_schema(_user_schema(), models), 'pairing'), 'pairing'))
    finally:
        generators_test.set_prisma_uniques(previous)
    assert len(re.findall(r'\b(?:alpha|beta)_id: deps\.\w+\.id', loop)) == 2, loop


def test_pair_comment_names_the_composite_unique_not_one_to_one(schema):
    text = _helper(schema, 'pairing')
    assert 'composite unique over its foreign keys' in text
    assert 'one-to-one' not in _loop_body(_populate_data(text, 'pairing'))
