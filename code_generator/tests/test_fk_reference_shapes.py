"""Shapes of the foreign-key references the security matrix's `fk_shape` axis is built from."""
import generate
from helpers.schema_helpers import fk_reference_shapes


def _schema():
    def fk(kind, target):
        return {'x-relationship': {'type': kind, 'target': target}}

    return {'definitions': {
        'organization': {'properties': {}},
        'account': {'properties': {'organization_id': {}}},
        'plain': {'properties': {}},
        '__ticket': {
            'required': ['account_id'],
            'properties': {
                'organization_id': fk('many-to-one', 'organization'),
                'account_id': fk('many-to-one', 'account'),
                'backup_id': fk('many-to-one', 'account'),
                'plain_id': fk('many-to-one', 'plain'),
                'creator_id': fk('many-to-one', 'account'),
            },
        },
        '__profile': {'required': ['account_id'], 'properties': {'account_id': fk('one-to-one', 'account')}},
        'line': {'properties': {
            'ticket_id': fk('many-to-one', 'account'),
            'account_id': fk('many-to-one', 'account'),
        }},
    }}


def test_shapes_name_the_kind_and_whether_the_reference_is_required():
    assert fk_reference_shapes('ticket', _schema()) == {
        'account_id': 'many_to_one_required', 'backup_id': 'many_to_one_optional'}
    assert fk_reference_shapes('profile', _schema()) == {'account_id': 'one_to_one_required'}


def test_organization_user_creator_and_unscoped_targets_are_not_references():
    assert 'organization_id' not in fk_reference_shapes('ticket', _schema())
    assert 'plain_id' not in fk_reference_shapes('ticket', _schema())
    assert 'creator_id' not in fk_reference_shapes('ticket', _schema())


def test_flags_are_all_false_without_an_organization_column():
    flags = generate._security_fk_shape_flags('ticket', {}, _schema(), False)
    assert flags and not any(flags.values())


def test_inline_child_flags_skip_the_key_back_to_the_parent():
    entity = {'children': [{'name': 'line', 'output_type': None}]}
    flags = generate._security_fk_shape_flags('ticket', entity, _schema(), True)
    assert flags['fk_many_to_one_required'] and flags['fk_many_to_one_optional']
    # `ticket_id` is the ownership link, so only `account_id` of the child counts, and it is optional there.
    assert flags['fk_inline_optional'] and not flags['fk_inline_required']


def test_a_to_many_child_is_not_an_inline_shape():
    entity = {'children': [{'name': 'line', 'relationship': {'type': 'many-to-many'}}]}
    flags = generate._security_fk_shape_flags('ticket', entity, _schema(), True)
    assert not flags['fk_inline_required'] and not flags['fk_inline_optional']
