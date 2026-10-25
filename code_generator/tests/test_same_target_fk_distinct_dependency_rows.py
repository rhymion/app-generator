"""
Two foreign keys of one entity that point at the same target (a main and a
"source" placement) used to share one find-or-create key, so the generated
dependency helper resolved both to the SAME row, and the source-side rows made
for an edit sat under a different parent than the record they were attached to.

  - the dependency rows get distinct keys (the first FK the highest, later ones
    lower), so "source strictly before main" can hold;
  - the spec's expected labels follow the key the helper used;
  - a source-side FK that is optional and hangs under the parent the primary FK
    gets afresh per iteration is created under that same parent, and the created
    rows are returned on the record for the edit step to select.

Entities without a same-target FK pair render exactly as before.
"""
import re
import sys
from pathlib import Path

import pytest
from jinja2 import Environment, FileSystemLoader

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from build_user_schema import build_intermediate_schema  # noqa: E402
from generate_types import _extract_children  # noqa: E402
from generators_test import _vary_sibling_key, helper_context, set_prisma_uniques, spec_context  # noqa: E402
from helpers.naming import to_camel_case, to_pascal_case  # noqa: E402
from schema_deriver import collect_unique_columns, parse_prisma_schema  # noqa: E402

PRISMA = """
model case_version {
  id String @id @default(cuid())
  title String
  placements placement[]
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
}

model placement {
  id String @id @default(cuid())
  step_no Int
  case_version_id String
  case_version case_version @relation(fields: [case_version_id], references: [id])
  arguments argument[] @relation("MainPlacement")
  source_arguments argument[] @relation("SourcePlacement")
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
  @@unique([case_version_id, step_no])
  @@index([case_version_id])
}

model argument {
  id String @id @default(cuid())
  placement_id String
  placement placement @relation("MainPlacement", fields: [placement_id], references: [id])
  source_placement_id String?
  source_placement placement? @relation("SourcePlacement", fields: [source_placement_id], references: [id])
  note String?
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
  @@index([placement_id])
  @@index([source_placement_id])
}
"""

PLACEMENT_LABEL = ['case_version.title', 'step_no']

CONFIG = {
    'list': True, 'view': True, 'new': True, 'edit': True,
    'delete': True, 'api': False, 'test': True, 'fields': None,
}


def _user_schema(with_pair: bool = True) -> dict:
    argument_props = {
        'placement_id': {'x-relationship': {'labelField': PLACEMENT_LABEL}},
        'note': {},
    }
    table = [{'placement': {'primary': True}}]
    if with_pair:
        argument_props['source_placement_id'] = {'x-relationship': {'labelField': PLACEMENT_LABEL}}
        table.append({'source_placement': {}})
    return {
        'definitions': {
            'case_version': {
                'x-display': {'table': [{'title': {'primary': True}}]},
                'properties': {'title': {}},
            },
            'placement': {
                'x-display': {'table': [{'step_no': {'primary': True}}, {'case_version': {}}]},
                'properties': {'case_version_id': {'x-relationship': {'labelField': 'title'}}, 'step_no': {}},
            },
            'argument': {
                'x-display': {'table': table},
                'properties': argument_props,
            },
        },
    }


@pytest.fixture
def models(tmp_path):
    """Parsed Prisma models; their unique constraints are registered the way generate.py does,
    and cleared afterwards so the rest of the suite keeps the no-Prisma-facts fallback."""
    path = tmp_path / 'schema.prisma'
    path.write_text(PRISMA)
    parsed = parse_prisma_schema(path)
    set_prisma_uniques(collect_unique_columns(parsed))
    yield parsed
    set_prisma_uniques({})


def _schema(models, with_pair: bool = True) -> dict:
    return build_intermediate_schema(_user_schema(with_pair), models)


def _env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(str(Path(__file__).resolve().parents[1] / 'templates')),
        trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    return env


def _args(schema: dict, entity: str):
    children = _extract_children(schema['definitions'][entity], schema)
    return entity, children, schema, entity, entity, CONFIG


def _helper(schema: dict) -> str:
    parent, children, sch, model, key, cfg = _args(schema, 'argument')
    return _env().get_template('test_helper.ts.jinja2').render(**helper_context(parent, children, sch, model, key, cfg))


def _dependency_keys(text: str) -> dict:
    """{dependency var: step_no literal of its find-or-create where}"""
    return {
        m.group(1): int(m.group(2))
        for m in re.finditer(r"_depWhere\('placement\.(\w+)', 'placement', \{[^}]*step_no: (\d+)", text)
    }


def test_sibling_dependency_rows_get_distinct_keys(models):
    keys = _dependency_keys(_helper(_schema(models)))
    assert keys['placement'] > keys['sourcePlacement'], keys


def test_single_fk_dependency_key_is_unchanged(models):
    keys = _dependency_keys(_helper(_schema(models, with_pair=False)))
    assert keys == {'placement': 0}


def test_source_row_is_created_under_the_iterations_parent(models):
    text = _helper(_schema(models))
    data = text[text.index('export async function populateArgumentData'):text.index('export async function populateArgumentFullData')]
    create = data[data.index('prisma.placement.create({\n      data: _dep(\'placement.sourcePlacement\''):]
    create = create[:create.index('});')]
    assert re.search(r'case_version_id: caseVersionFresh\.id', create), create
    assert re.search(r'step_no: 0\b', create), create
    assert 'sourceDeps: { sourcePlacement: sourcePlacementFresh }' in data


def test_full_data_attaches_the_iterations_source_row(models):
    text = _helper(_schema(models))
    full = text[text.index('export async function populateArgumentFullData'):]
    assert 'source_placement_id: sourcePlacementFresh.id' in full
    assert 'source_placement_id: deps.sourcePlacement.id' not in full


def test_helper_without_a_pair_returns_plain_records(models):
    text = _helper(_schema(models, with_pair=False))
    assert 'sourceDeps' not in text
    assert 'Fresh = {' not in text


def _spec(schema: dict) -> str:
    ctx = spec_context(*_args(schema, 'argument'))
    return _env().get_template('test_spec.cy.ts.jinja2').render(**ctx)


def test_spec_expects_the_label_of_the_row_the_helper_made(models):
    text = _spec(_schema(models))
    assert "cy.checkField('Placement', 'Test Title A 1');" in text
    assert "cy.checkField('Source Placement', 'Test Title A 0');" in text


def test_edit_step_selects_the_row_created_for_the_record(models):
    text = _spec(_schema(models))
    assert 'records[0].sourceDeps.sourcePlacement.name' in text
    assert 'deps.sourcePlacement' in text  # the create step still selects the shared dependency row


def test_spec_without_a_pair_is_unchanged(models):
    text = _spec(_schema(models, with_pair=False))
    assert 'sourceDeps' not in text
    assert "cy.checkField('Placement', 'Test Title A 0');" in text


class TestVarySiblingKey:
    @staticmethod
    def _fields():
        return [{'prop_name': 'step_no', 'prisma_val': '1', 'prisma_val_second': '1'}]

    def test_integer_keys_descend_in_foreign_key_order(self):
        cols = self._fields()
        assert [_vary_sibling_key(self._fields(), cols, i, 3)[0][0]['prisma_val'] for i in range(3)] == ['3', '2', '1']

    def test_string_keys_get_a_numbered_suffix_after_the_first(self):
        fields = [{'prop_name': 'code', 'prisma_val': "'Test Code A'", 'prisma_val_second': "'Test Code B'"}]
        out = [_vary_sibling_key(fields, fields, i, 2)[0][0]['prisma_val'] for i in range(2)]
        assert out == ["'Test Code A'", "'Test Code A 2'"]

    def test_name_keys_are_left_alone(self):
        fields = [{'prop_name': 'name', 'prisma_val': "'Test X A'", 'prisma_val_second': "'Test X B'"}]
        assert _vary_sibling_key(fields, fields, 1, 2) == (fields, False)

    def test_fk_column_keys_are_left_alone(self):
        fields = [{'prop_name': 'step_no', 'prisma_val': '1', 'prisma_val_second': '1'}]
        assert _vary_sibling_key(fields, [{'prop_name': 'parent_id', 'dep_var_name': 'parent'}], 1, 2) == (fields, False)
