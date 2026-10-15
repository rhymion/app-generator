"""An optional FK that closes a cycle through a required FK must not become a dependency.

An identity entity (`step`) can carry a nullable `current_version_id` to its
version entity (`step_version`), while the version requires the identity
(`step_id`). Pre-creating `step_version` as a dependency of `step` cannot work:
the version needs a `step` row that does not exist yet, so the generated helper
called `step_version.create()` without its required parent FK.
"""
from generators_test import resolve_dependencies


def _entity(required, relationships):
    properties = {'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}, 'name': {'type': 'string'}}
    for prop_name, (target, _) in relationships.items():
        properties[prop_name] = {
            'type': 'string',
            'x-relationship': {'type': 'many-to-one', 'target': target, 'labelField': 'name'},
        }
    return {'type': 'object', 'required': ['id', 'name', *required], 'properties': properties}


def _schema(current_version_required=False):
    return {
        'definitions': {
            'step': _entity(
                ['current_version_id'] if current_version_required else [],
                {'current_version_id': ('step_version', False)},
            ),
            'step_version': _entity(['step_id'], {'step_id': ('step', True)}),
        },
    }


def test_optional_fk_to_version_is_not_a_dependency_of_the_identity():
    assert resolve_dependencies('step', _schema()) == []


def test_version_still_depends_on_its_identity():
    deps = resolve_dependencies('step_version', _schema())
    assert [d['target'] for d in deps] == ['step']
    assert deps[0]['fk_deps'] == []


def test_required_fk_is_unchanged():
    deps = resolve_dependencies('step', _schema(current_version_required=True))
    assert [d['target'] for d in deps] == ['step_version']
