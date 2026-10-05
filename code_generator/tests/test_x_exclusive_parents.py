"""
x-exclusive-parents: a child owned by exactly one of several parents (one
nullable structural FK filled per row) does not show the other listed parents'
FK columns in the grid embedded on a listed parent's screen.

The key is opt-in. A child that does not declare it keeps every column, and
the context it produces carries no `exclusive_parent_fks` entry at all.
"""
import copy
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'code_generator'))

from build_context import build_context  # noqa: E402
from build_user_schema import build_intermediate_schema  # noqa: E402
from generate_types import _extract_children  # noqa: E402
from schema_deriver import parse_prisma_schema  # noqa: E402
from validate import SchemaValidationError, validate_schema  # noqa: E402

PRISMA = """
model alpha {
  id String @id @default(cuid())
  name String
  placements placement[] @relation("AlphaPlacements")
  placed_in placement[] @relation("PlacedAlpha")
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
}

model beta {
  id String @id @default(cuid())
  name String
  placements placement[] @relation("BetaPlacements")
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
}

model placement {
  id String @id @default(cuid())
  name String
  alpha_id String?
  alpha alpha? @relation("AlphaPlacements", fields: [alpha_id], references: [id])
  beta_id String?
  beta beta? @relation("BetaPlacements", fields: [beta_id], references: [id])
  placed_alpha_id String
  placed_alpha alpha @relation("PlacedAlpha", fields: [placed_alpha_id], references: [id])
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
  @@index([alpha_id])
  @@index([beta_id])
  @@index([placed_alpha_id])
}
"""


def _user_schema(exclusive=('alpha', 'beta')) -> dict:
    placement = {
        'fields': {
            'name': {},
            'alpha_id': {'x-relationship': {}},
            'beta_id': {'x-relationship': {}},
            'placed_alpha_id': {'x-relationship': {}},
        },
    }
    if exclusive is not None:
        placement['x-exclusive-parents'] = list(exclusive)
    return {
        'definitions': {
            'alpha': {
                'fields': {'name': {}},
                'properties': {'placements': {'type': 'array', 'items': {'$ref': '#/definitions/placement'}}},
            },
            'beta': {
                'fields': {'name': {}},
                'properties': {'placements': {'type': 'array', 'items': {'$ref': '#/definitions/placement'}}},
            },
            'placement': placement,
        },
    }


@pytest.fixture(scope='module')
def models(tmp_path_factory):
    path = tmp_path_factory.mktemp('prisma') / 'schema.prisma'
    path.write_text(PRISMA)
    return parse_prisma_schema(path)


def _schema(models, exclusive=('alpha', 'beta')) -> dict:
    return build_intermediate_schema(_user_schema(exclusive), models)


def _contexts(schema: dict, parent: str):
    from generators import column_def_context, form_upsert_context
    entity = {
        'parent': parent, 'model': parent, 'definition_key': parent,
        'children': _extract_children(schema['definitions'][parent], schema),
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': False, 'test': False, 'fields': None,
        },
    }
    ctx = build_context(entity, schema)
    return ctx, column_def_context(ctx, schema), form_upsert_context(ctx, schema)


def _columns(schema: dict, parent: str) -> str:
    return _contexts(schema, parent)[1]['column_children'][0]['fn_code']


# --- column set per parent screen ------------------------------------------

def test_key_is_copied_to_the_raw_entity(models):
    schema = _schema(models)
    assert schema['definitions']['placement']['x-exclusive-parents'] == ['alpha', 'beta']


def test_alpha_screen_hides_the_beta_fk_and_keeps_the_non_parent_fk(models):
    fn_code = _columns(_schema(models), 'alpha')
    assert "field: 'beta_id'" not in fn_code, fn_code
    assert "field: 'alpha_id'" not in fn_code, fn_code
    assert "field: 'placed_alpha_id'" in fn_code, fn_code
    assert "field: 'name'" in fn_code, fn_code


def test_beta_screen_hides_the_alpha_fk_and_keeps_the_non_parent_fk(models):
    fn_code = _columns(_schema(models), 'beta')
    assert "field: 'alpha_id'" not in fn_code, fn_code
    assert "field: 'beta_id'" not in fn_code, fn_code
    assert "field: 'placed_alpha_id'" in fn_code, fn_code


def test_hidden_fk_takes_no_config_argument_in_columns_or_form(models):
    schema = _schema(models)
    ctx, cols, form = _contexts(schema, 'alpha')
    assert 'betaIdConfig' not in cols['column_children'][0]['fn_code']
    assert 'betaIdConfig' not in form['child_grid_setup']
    assert 'placedAlphaIdConfig' in form['child_grid_setup']


def test_context_records_the_hidden_columns(models):
    schema = _schema(models)
    assert _contexts(schema, 'alpha')[0]['children_data'][0]['exclusive_parent_fks'] == ['beta_id']
    assert _contexts(schema, 'beta')[0]['children_data'][0]['exclusive_parent_fks'] == ['alpha_id']


def test_write_payload_still_carries_the_hidden_fk_on_create_only(models):
    """The hidden FK stays in the row type and in the create payload; a row added
    from the parent screen never sets it, so it stays NULL. The update of an
    existing row does not write it (the exactly-one-owner check judges it)."""
    ctx, _, form = _contexts(_schema(models), 'alpha')
    assert 'beta_id: f.beta_id' in ctx['child_nested_create']
    update = ctx['child_nested_update']
    assert 'beta_id: f.beta_id' in update[update.index('create:'):]
    assert 'beta_id' not in update[update.index('update:'):update.index('create:')]
    assert 'alpha_id: src.id' in form['child_grid_setup']


# --- opt-in: no key, no change ---------------------------------------------

def test_without_the_key_every_non_parent_column_is_shown(models):
    schema = _schema(models, exclusive=None)
    assert "field: 'beta_id'" in _columns(schema, 'alpha')
    assert "field: 'alpha_id'" in _columns(schema, 'beta')


def test_without_the_key_the_child_context_has_no_exclusive_entry(models):
    schema = _schema(models, exclusive=None)
    for parent in ('alpha', 'beta'):
        for child in _contexts(schema, parent)[0]['children_data']:
            assert 'exclusive_parent_fks' not in child


def test_unlisted_parent_is_unaffected(models):
    """A parent absent from the list keeps its columns; the key only applies
    on the screens of the parents it names."""
    schema = _schema(models)
    schema['definitions']['placement']['x-exclusive-parents'] = ['beta', 'gamma']
    schema['definitions']['gamma'] = copy.deepcopy(schema['definitions']['beta'])
    ctx = _contexts(schema, 'alpha')[0]
    assert 'exclusive_parent_fks' not in ctx['children_data'][0]


# --- validation -------------------------------------------------------------

def _errors(models, mutate) -> str:
    schema = _schema(models)
    mutate(schema['definitions'])
    with pytest.raises(SchemaValidationError) as exc:
        validate_schema(schema)
    return str(exc.value)


def _set(value):
    return lambda defs: defs['placement'].__setitem__('x-exclusive-parents', value)


def test_valid_declaration_passes(models):
    validate_schema(_schema(models))


def test_v1_value_must_be_a_list_of_names(models):
    assert 'must be a list of parent entity names' in _errors(models, _set('alpha'))
    assert 'must be a list of parent entity names' in _errors(models, _set(['alpha', 3]))


def test_v2_unknown_entity(models):
    assert "unknown entity 'nope'" in _errors(models, _set(['alpha', 'nope']))


def test_v3_fewer_than_two_names(models):
    assert 'at least 2' in _errors(models, _set(['alpha']))
    assert 'at least 2' in _errors(models, _set([]))


def test_v4_duplicates(models):
    assert 'duplicate' in _errors(models, _set(['alpha', 'alpha', 'beta']))


def test_v5_listed_entity_without_the_child_as_a_one_to_many_child(models):
    def mutate(defs):
        defs['placement']['x-exclusive-parents'] = ['alpha', 'placement_holder']
        defs['placement_holder'] = {'type': 'object', 'properties': {'id': {'type': 'string'}}}
    assert "'placement_holder' does not have 'placement' as a one-to-many child" in _errors(models, mutate)


def test_v6_structural_fk_must_exist_on_the_child(models):
    def mutate(defs):
        del defs['placement']['properties']['beta_id']
    assert "'beta_id'" in _errors(models, mutate) and 'do not exist' in _errors(models, mutate)


def test_v7_required_other_parent_fk_is_rejected(models):
    def mutate(defs):
        defs['placement']['properties']['beta_id']['type'] = 'string'
    assert 'is required' in _errors(models, mutate)


def test_v8_child_must_not_list_itself(models):
    assert 'must not list the child itself' in _errors(models, _set(['alpha', 'placement']))


def test_v9_list_children_are_rejected(models):
    def mutate(defs):
        defs['beta']['properties']['placements']['x-outputType'] = 'list'
    assert 'list/comments or many-to-many' in _errors(models, mutate)
