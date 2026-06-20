"""
Regression test for service_after_create_stub.ts.jinja2.

Pins the contract that:
- Entities with an `approvable` one-to-one_bridge OTO get approval-flow
  logic (create approval_requests, update approvable.creator_id).
- Entities WITHOUT an approvable OTO get the empty no-op stub.

This is a regression for the bug in cmd_199a where the template was
accidentally replaced with an unconditional empty stub.
"""
from pathlib import Path
from jinja2 import Environment, FileSystemLoader

from build_context import build_context


# ---------------------------------------------------------------------------
# Jinja2 env (mirrors _make_env() in generate.py)
# ---------------------------------------------------------------------------

def _make_env() -> Environment:
    templates_dir = Path(__file__).parent.parent / 'templates'
    from helpers.naming import to_pascal_case, to_camel_case
    env = Environment(
        loader=FileSystemLoader(templates_dir),
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    return env


_ENV = _make_env()


def _render_stub(ctx: dict) -> str:
    return _ENV.get_template('service_after_create_stub.ts.jinja2').render(**ctx)


# ---------------------------------------------------------------------------
# Schema fixtures (reuse shape from test_auto_create_oto.py)
# ---------------------------------------------------------------------------

def _entity(model: str) -> dict:
    return {
        'parent': model,
        'model': model,
        'definition_key': f'{model}_detail',
        'children': [],
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': True, 'test': True, 'fields': None,
        },
    }


def _approvable_schema() -> dict:
    """leave_request-style: entity has approvable_id one-to-one_bridge → approvable."""
    return {
        'definitions': {
            'approval_flow': {
                'type': 'object',
                'required': ['id', 'entity_name'],
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'entity_name': {'type': 'string'},
                },
            },
            'approval_flow_detail': {
                'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True,
                               'delete': True, 'api': True, 'test': True},
                'allOf': [{'$ref': '#/definitions/approval_flow'}],
            },
            'approval_request': {
                'type': 'object',
                'required': ['id', 'approvable_id', 'approval_flow_id'],
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'approvable_id': {
                        'type': 'string',
                        'x-relationship': {'type': 'many-to-one', 'target': 'approvable', 'labelField': 'id'},
                    },
                    'approval_flow_id': {
                        'type': 'string',
                        'x-relationship': {'type': 'many-to-one', 'target': 'approval_flow', 'labelField': 'entity_name'},
                    },
                    'status': {'type': 'integer', 'enum': [0, 1, 2]},
                },
            },
            'approvable': {
                'type': 'object',
                'required': ['id'],
                'properties': {'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}},
            },
            'approvable_detail': {
                'x-generate': {'list': False, 'view': False, 'new': False, 'edit': False,
                               'delete': False, 'api': False, 'test': False},
                'allOf': [
                    {'$ref': '#/definitions/approvable'},
                    {'type': 'object', 'required': ['approval_requests'], 'properties': {
                        'approval_requests': {
                            'type': 'array',
                            'x-outputType': 'list',
                            'items': {'$ref': '#/definitions/approval_request'},
                        },
                    }},
                ],
            },
            'leave_request': {
                'type': 'object',
                'required': ['id', 'approvable_id'],
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'approvable_id': {
                        'type': 'string',
                        'x-relationship': {'type': 'one-to-one_bridge', 'target': 'approvable', 'labelField': 'id'},
                    },
                },
            },
            'leave_request_detail': {
                'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True,
                               'delete': True, 'api': True, 'test': True},
                'allOf': [
                    {'$ref': '#/definitions/leave_request'},
                    {'type': 'object', 'properties': {
                        'approvable': {'$ref': '#/definitions/approvable'},
                    }},
                ],
            },
        }
    }


def _non_approvable_schema() -> dict:
    """Plain entity with no approvable OTO → should get empty stub."""
    return {
        'definitions': {
            'organization': {
                'type': 'object',
                'required': ['id', 'name'],
                'properties': {
                    'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                    'name': {'type': 'string', 'minLength': 1},
                },
            },
            'organization_detail': {
                'x-generate': {'list': True, 'view': True, 'new': True, 'edit': True,
                               'delete': True, 'api': True, 'test': True},
                'allOf': [{'$ref': '#/definitions/organization'}],
            },
        }
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestServiceAfterCreateStubApprovable:
    """Entities with approvable OTO → approval-flow logic must be generated."""

    def _rendered(self) -> str:
        ctx = build_context(_entity('leave_request'), _approvable_schema())
        return _render_stub(ctx)

    def test_approval_request_create_present(self):
        """approval_request.create must be emitted to wire the approval flow."""
        assert 'approval_request.create' in self._rendered()

    def test_approval_flow_findmany_present(self):
        """Template fetches approval flows for this entity type."""
        assert 'approval_flow.findMany' in self._rendered()

    def test_entity_name_interpolated(self):
        """entity_name filter uses the model name, not a hardcoded literal."""
        rendered = self._rendered()
        assert "entity_name: 'leave_request'" in rendered

    def test_approvable_update_present(self):
        """approvable.update(creator_id) must be emitted after creating requests."""
        assert 'approvable.update' in self._rendered()

    def test_not_empty_stub(self):
        """Must NOT produce the no-op empty stub when approvable OTO is present."""
        rendered = self._rendered()
        # The empty stub has `_tx`, `_created`, `_data` (all underscored).
        assert '_tx' not in rendered
        assert '_created' not in rendered


class TestServiceAfterCreateStubNonApprovable:
    """Entities without approvable OTO → must get the empty no-op stub."""

    def _rendered(self) -> str:
        ctx = build_context(_entity('organization'), _non_approvable_schema())
        return _render_stub(ctx)

    def test_empty_stub_generated(self):
        """Non-approvable entity must export an empty afterCreate."""
        rendered = self._rendered()
        assert 'export async function afterCreate' in rendered
        assert '_tx' in rendered
        assert '_created' in rendered

    def test_no_approval_flow_logic(self):
        """No approval_flow or approval_request references in empty stub."""
        rendered = self._rendered()
        assert 'approval_flow' not in rendered
        assert 'approval_request' not in rendered
