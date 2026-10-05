"""
x-exclusive-parents save-time validation: a child that declares the key must
hold exactly one of the listed parents' structural FK columns after every save.

The check is generated, not a schema rule: it lives in lib/<child>/
exclusive_parents.ts and is called from the child's own service validation and
from the parent service's nested child writes. A child that does not declare
the key gets none of it.
"""
import json
import sys
from pathlib import Path

import pytest
from jinja2 import Environment, FileSystemLoader

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from build_context import build_context  # noqa: E402
from generate_types import _extract_children  # noqa: E402
from helpers.naming import to_camel_case, to_pascal_case  # noqa: E402
from validation_context import build_validation_context  # noqa: E402

from test_x_exclusive_parents import _schema, models  # noqa: E402,F401


def _env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    env.filters['tojson'] = json.dumps
    return env


def _entity(schema: dict, name: str) -> dict:
    return {
        'parent': name, 'model': name, 'definition_key': name,
        'children': _extract_children(schema['definitions'][name], schema),
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': False, 'test': False, 'fields': None,
        },
    }


def _service_validation(schema: dict, name: str) -> str:
    ctx = build_context(_entity(schema, name), schema)
    return _env().get_template('service_validation.ts.jinja2').render({**ctx, **build_validation_context(ctx)})


def test_context_lists_the_full_listed_column_set_of_the_child(models):
    ctx = build_context(_entity(_schema(models), 'placement'), _schema(models))
    assert ctx['exclusive_parent_columns'] == ['alpha_id', 'beta_id']


def test_context_has_no_columns_for_a_child_without_the_key(models):
    schema = _schema(models, exclusive=None)
    assert build_context(_entity(schema, 'placement'), schema)['exclusive_parent_columns'] == []


def test_context_has_no_columns_for_a_parent(models):
    schema = _schema(models)
    assert build_context(_entity(schema, 'alpha'), schema)['exclusive_parent_columns'] == []


def test_child_validation_calls_the_helper_with_the_merged_row(models):
    out = _service_validation(_schema(models), 'placement')
    assert "from '@/lib/placement/exclusive_parents'" in out
    assert 'validateExclusiveParents(' in out
    # Partial updates: an omitted column keeps the existing row's value.
    assert 'data[column] !== undefined ? data[column] : prevRow?.[column]' in out


def test_child_without_the_key_gets_no_validation_text(models):
    out = _service_validation(_schema(models, exclusive=None), 'placement')
    assert 'exclusive' not in out.lower()
    assert 'validateExclusiveParents' not in out


def test_helper_template_lists_every_column_and_both_reasons():
    out = _env().get_template('exclusive_parents.ts.jinja2').render(
        {'child': 'placement', 'columns': ['alpha_id', 'beta_id']})
    assert "'alpha_id'," in out and "'beta_id'," in out
    assert "'missing'" in out and "'invalid'" in out
    assert 'EXCLUSIVE_PARENT_COLUMNS[0]' in out


# --- displayed wording --------------------------------------------------------

def _error_fields(schema: dict, name: str) -> dict:
    from generators import form_upsert_context
    ctx = build_context(_entity(schema, name), schema)
    return form_upsert_context(ctx, schema)['exclusive_parent_error_fields']


def test_child_form_names_every_listed_column(models):
    assert _error_fields(_schema(models), 'placement') == {'alpha_id': 'alpha_id, beta_id'}


def test_parent_form_names_every_listed_column_of_its_embedded_child(models):
    assert _error_fields(_schema(models), 'alpha') == {'alpha_id': 'alpha_id, beta_id'}


def test_form_without_the_key_has_no_special_wording(models):
    assert _error_fields(_schema(models, exclusive=None), 'placement') == {}
