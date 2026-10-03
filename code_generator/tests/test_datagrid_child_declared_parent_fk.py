"""
Regression tests for issue #800: the structural parent FK of an embedded
DataGrid child is named by the Prisma relation the parent declares, not
guessed from column names.

A child whose link to the parent has an unconventional name (not
`{parent}_id`) used to be treated by `get_parent_fk_props` as "the only FK
annotated with the parent as target", so an unrelated second FK to the same
model was taken for the structural link and dropped from the parent's
fetched include.
"""
import sys
import warnings
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'code_generator'))

from build_context import build_context  # noqa: E402
from build_user_schema import build_intermediate_schema  # noqa: E402
from generate_types import _extract_children  # noqa: E402
from schema_deriver import parse_prisma_schema  # noqa: E402

PRISMA_TEMPLATE = """
model widget {
  id String @id @default(cuid())
  name String
  lines line[] %(list_rel)s
  related_lines line[] %(related_rel)s
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
}

model line {
  id String @id @default(cuid())
  name String
  owner_ref_id String
  owner_ref widget @relation(%(owner_args)s)
  related_widget_id String?
  related_widget widget? @relation(%(related_args)s)
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
  @@index([owner_ref_id])
  @@index([related_widget_id])
}
"""

NAMED = dict(
    list_rel='@relation("owner")',
    related_rel='@relation("related")',
    owner_args='"owner", fields: [owner_ref_id], references: [id]',
    related_args='"related", fields: [related_widget_id], references: [id]',
)


def _intermediate(tmp_path, **prisma_args):
    path = tmp_path / 'schema.prisma'
    path.write_text(PRISMA_TEMPLATE % prisma_args)
    models = parse_prisma_schema(path)
    user_schema = {
        'definitions': {
            'widget': {
                'fields': {'name': {}},
                'properties': {
                    'lines': {'type': 'array', 'items': {'$ref': '#/definitions/line'}},
                },
            },
            'line': {
                'fields': {
                    'name': {},
                    'owner_ref_id': {'x-relationship': {}},
                    'related_widget_id': {'x-relationship': {}},
                },
            },
        },
    }
    return build_intermediate_schema(user_schema, models)


def _widget_include(schema: dict) -> str:
    entity = {
        'parent': 'widget', 'model': 'widget', 'definition_key': 'widget',
        'children': _extract_children(schema['definitions']['widget'], schema),
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': False, 'test': False, 'fields': None,
        },
    }
    return build_context(entity, schema)['include_props_detail']


def test_parent_fk_is_named_by_the_prisma_relation(tmp_path):
    schema = _intermediate(tmp_path, **NAMED)
    props = schema['definitions']['widget']['properties']
    assert props['lines']['x-parent-fk'] == ['owner_ref_id']


def test_unrelated_second_fk_to_the_parent_model_is_fetched(tmp_path):
    include = _widget_include(_intermediate(tmp_path, **NAMED))
    assert 'related_widget' in include, f'include was: {include}'
    assert 'owner_ref' not in include, f'include was: {include}'


def test_unnamed_single_back_reference_is_paired(tmp_path):
    schema = _intermediate(
        tmp_path,
        list_rel='',
        related_rel='@relation("related")',
        owner_args='fields: [owner_ref_id], references: [id]',
        related_args='"related", fields: [related_widget_id], references: [id]',
    )
    props = schema['definitions']['widget']['properties']
    assert props['lines']['x-parent-fk'] == ['owner_ref_id']
    include = _widget_include(schema)
    assert 'related_widget' in include and 'owner_ref' not in include


def test_unpairable_relation_is_reported_not_guessed(tmp_path):
    """Two unnamed back-references: Prisma itself rejects this shape, but the
    deriver must not pick one silently if it ever sees it."""
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        schema = _intermediate(
            tmp_path,
            list_rel='',
            related_rel='',
            owner_args='fields: [owner_ref_id], references: [id]',
            related_args='fields: [related_widget_id], references: [id]',
        )
    props = schema['definitions']['widget']['properties']
    assert 'x-parent-fk' not in props['lines']
    assert any('structural parent FK' in str(w.message) for w in caught)


# --- grid columns and the parent form --------------------------------------

def _named_contexts(tmp_path):
    from generators import column_def_context, form_upsert_context

    schema = _intermediate(tmp_path, **NAMED)
    entity = {
        'parent': 'widget', 'model': 'widget', 'definition_key': 'widget',
        'children': _extract_children(schema['definitions']['widget'], schema),
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': False, 'test': False, 'fields': None,
        },
    }
    ctx = build_context(entity, schema)
    return ctx, column_def_context(ctx, schema), form_upsert_context(ctx, schema)


def test_structural_fk_is_not_a_grid_column(tmp_path):
    _, cols, _ = _named_contexts(tmp_path)
    fn_code = cols['column_children'][0]['fn_code']
    assert "field: 'owner_ref_id'" not in fn_code, fn_code
    assert 'ownerRefIdConfig' not in fn_code, fn_code


def test_unrelated_second_fk_is_a_grid_column_with_fetched_data(tmp_path):
    ctx, cols, _ = _named_contexts(tmp_path)
    fn_code = cols['column_children'][0]['fn_code']
    assert "field: 'related_widget_id'" in fn_code, fn_code
    assert 'related_widget' in ctx['include_props_detail']


def test_form_treats_only_the_structural_fk_as_the_parent_link(tmp_path):
    ctx, _, form = _named_contexts(tmp_path)
    setup = form['child_grid_setup']
    assert 'relatedWidgetIdConfig' in setup, setup
    assert 'ownerRefIdConfig' not in setup, setup
    # The unrelated FK is written from the grid row; the structural FK is not.
    assert 'related_widget_id: f.related_widget_id' in ctx['child_nested_create']
    assert 'owner_ref_id' not in ctx['child_nested_create']
    # A new row is linked to the parent through the structural FK.
    assert 'owner_ref_id: src.id' in setup, setup
