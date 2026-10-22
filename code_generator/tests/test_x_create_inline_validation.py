"""
x-create-inline schema validation (Issue #846).

A many-to-one FK field that declares `x-create-inline: true` also offers
"Create new": the target's own generated form opens in a dialog. The dialog
reuses the target's form and save action, so the declaration is only accepted
for targets whose own create path is safe to run from inside another form, and
only one level deep. Every unsupported shape is a schema validation error (fail
closed), never silently ignored.
"""
import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from helpers.schema_helpers import (  # noqa: E402
    get_inline_create_fields, get_inline_create_targets, get_parent_relationships,
)
from validate import SchemaValidationError, validate_schema  # noqa: E402

ALL_PAGES = {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True}


def _schema(**target_overrides) -> dict:
    """`ticket` declares x-create-inline on `project_id`, which targets `project`.

    `target_overrides` are merged over the target entity definition (entity-level keys).
    """
    schema = {
        'definitions': {
            'ticket': {
                'x-generate': dict(ALL_PAGES),
                'required': ['title', 'project_id'],
                'properties': {
                    'id': {'type': 'string'},
                    'title': {'type': 'string'},
                    'project_id': {
                        'type': 'string',
                        'x-relationship': {'type': 'many-to-one', 'target': 'project'},
                        'x-create-inline': True,
                    },
                },
            },
            'project': {
                'x-generate': dict(ALL_PAGES),
                'required': ['name'],
                'properties': {
                    'id': {'type': 'string'},
                    'name': {'type': 'string'},
                },
            },
        },
    }
    schema['definitions']['project'].update(copy.deepcopy(target_overrides))
    return schema


def _errors(schema: dict) -> str:
    with pytest.raises(SchemaValidationError) as exc:
        validate_schema(schema)
    return str(exc.value)


def test_supported_target_is_accepted():
    validate_schema(_schema())


def test_declaration_is_read_into_the_relationship_and_the_target_set():
    schema = _schema()
    assert get_inline_create_fields(schema) == [
        {'entity': 'ticket', 'prop_name': 'project_id', 'target': 'project', 'rel_type': 'many-to-one'},
    ]
    assert get_inline_create_targets(schema) == {'project'}
    rel = get_parent_relationships(schema['definitions']['ticket'], schema)[0]
    assert rel['create_inline'] is True


def test_field_without_the_key_is_not_inline_creatable():
    schema = _schema()
    del schema['definitions']['ticket']['properties']['project_id']['x-create-inline']
    validate_schema(schema)
    assert get_inline_create_targets(schema) == set()
    assert get_parent_relationships(schema['definitions']['ticket'], schema)[0]['create_inline'] is False


def test_false_is_accepted_and_declares_nothing():
    schema = _schema()
    schema['definitions']['ticket']['properties']['project_id']['x-create-inline'] = False
    validate_schema(schema)
    assert get_inline_create_targets(schema) == set()


def test_non_boolean_value_is_rejected():
    schema = _schema()
    schema['definitions']['ticket']['properties']['project_id']['x-create-inline'] = 'yes'
    out = _errors(schema)
    assert "Definition 'ticket', property 'project_id': x-create-inline must be true or false" in out


# --- exclusions: each one is a validate error, shown by its own named example ---


def test_x_approval_target_is_rejected():
    out = _errors(_schema(**{'x-approval': {'submit_on': {'status': 'submitted'}}}))
    assert "x-create-inline points at 'project', which declares x-approval" in out


def test_x_payment_target_is_rejected():
    out = _errors(_schema(**{'x-payment': True}))
    assert "x-create-inline points at 'project', which declares x-payment" in out


def test_one_to_one_bridge_field_is_rejected():
    schema = _schema()
    schema['definitions']['ticket']['properties']['project_id']['x-relationship']['type'] = 'one-to-one_bridge'
    out = _errors(schema)
    assert 'only supported on a many-to-one foreign-key field' in out
    assert 'this field is a one-to-one bridge' in out


def test_one_to_one_bridge_entity_target_is_rejected():
    """An internal bridge entity (approvable/commentable/attachable style) has no generated
    pages at all, so there is no form to open."""
    schema = _schema()
    schema['definitions']['project'].pop('x-generate')
    out = _errors(schema)
    assert "x-create-inline points at 'project', which has no generated pages" in out


def test_x_self_only_target_is_rejected():
    out = _errors(_schema(**{'x-self-only': True}))
    assert "x-create-inline points at 'project', which declares x-self-only" in out


def test_x_self_only_dict_form_target_is_rejected():
    out = _errors(_schema(**{'x-self-only': {'admin_bypass': True}}))
    assert "which declares x-self-only" in out


def test_target_with_no_create_form_is_rejected():
    schema = _schema()
    schema['definitions']['project']['x-generate']['new'] = False
    out = _errors(schema)
    assert "x-create-inline points at 'project', which has no create form" in out


def test_x_internal_target_is_rejected():
    out = _errors(_schema(**{'x-internal': {'api': 'custom', 'page': False, 'embed': False}}))
    assert "x-create-inline points at 'project', which is x-internal" in out


def test_nesting_depth_above_one_is_rejected():
    """The target's own form would open a further dialog."""
    schema = _schema()
    schema['definitions']['project']['properties']['owner_id'] = {
        'type': 'string',
        'x-relationship': {'type': 'many-to-one', 'target': 'ticket'},
        'x-create-inline': True,
    }
    out = _errors(schema)
    assert "x-create-inline points at 'project', which itself declares x-create-inline on ['owner_id']" in out
    assert 'nesting depth is 1' in out


def test_one_to_one_selector_field_is_rejected():
    schema = _schema()
    schema['definitions']['ticket']['properties']['project_id']['x-relationship']['type'] = 'one-to-one'
    assert 'this field is a one-to-one selector' in _errors(schema)


def test_field_without_a_relationship_is_rejected():
    schema = _schema()
    del schema['definitions']['ticket']['properties']['project_id']['x-relationship']
    assert 'only supported on a many-to-one foreign-key field' in _errors(schema)
