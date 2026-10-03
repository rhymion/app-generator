"""
Regression tests for issue #800: an embedded DataGrid child's second FK to
the parent's own model must stay in the parent's fetched detail include.

`build_context.py` used to drop every child relation whose target equals the
parent model (`r['target'] != model`), which removed not only the structural
parent link but also any unrelated second FK pointing at the same model. The
generated grid column then rendered empty because the relation was never
fetched. Only the structural parent FK (`get_parent_fk_props`) is excluded.
"""
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'code_generator'))

from build_context import build_context  # noqa: E402


def _schema() -> dict:
    return {
        'definitions': {
            'parent_entity': {
                'type': 'object',
                'required': ['id', 'name'],
                'properties': {'id': {'type': 'string'}, 'name': {'type': 'string'}},
            },
            'child_entity': {
                'type': 'object',
                'required': ['id', 'parent_entity_id'],
                'properties': {
                    'id': {'type': 'string'},
                    'parent_entity_id': {
                        'type': 'string',
                        'x-relationship': {'type': 'many-to-one', 'target': 'parent_entity'},
                    },
                    'related_parent_entity_id': {
                        'type': ['string', 'null'],
                        'x-relationship': {
                            'type': 'many-to-one', 'target': 'parent_entity', 'labelField': 'name',
                        },
                    },
                },
            },
        },
    }


def _include_detail() -> str:
    entity = {
        'parent': 'parent_entity',
        'model': 'parent_entity',
        'definition_key': 'parent_entity',
        'children': [{
            'name': 'child_entity', 'property_name': 'child_entities',
            'output_type': None, 'file_type': None, 'relationship': None,
        }],
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': True, 'test': True, 'fields': None,
        },
    }
    return build_context(entity, _schema())['include_props_detail']


def test_non_parent_fk_to_same_model_is_fetched():
    detail = _include_detail()
    assert 'related_parent_entity' in detail, (
        "a child's non-structural FK to the parent's model must be included.\n"
        f"include_props_detail was: {detail}"
    )


def test_structural_parent_fk_is_not_fetched():
    detail = _include_detail()
    assert not re.search(r'(?<!\w)parent_entity\s*:', detail), (
        "the structural parent FK must stay excluded (circular include).\n"
        f"include_props_detail was: {detail}"
    )
