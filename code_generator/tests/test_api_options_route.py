"""The REST picker route (`app/api/<entity>/options/route.ts`): written for every
entity with a REST surface, a thin wrapper that runs the same
`search<Entity>Options` the web forms call as the authenticated caller, and
described in the OpenAPI document. Uses the decimal_gate fixture pipeline, which
has entities with `api: true` and `api: false`."""
from pathlib import Path

import pytest

from build_user_schema import build_user_schema
from generate import generate, _make_env, _render
from generators_openapi import build_entity_openapi

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'decimal_gate'


@pytest.fixture(scope='module')
def generated(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp('options_route')
    (out / 'prisma').mkdir()
    (out / 'prisma' / 'schema.prisma').write_text((FIXTURE_DIR / 'schema.prisma').read_text())
    intermediate = out / 'generated_json_schema.yaml'
    build_user_schema(FIXTURE_DIR / 'json_schema.yaml', FIXTURE_DIR / 'schema.prisma', intermediate)
    generate(str(intermediate), str(out))
    return out


def test_route_written_for_each_api_entity(generated):
    for entity in ('decimal_gate_item', 'decimal_gate_wrapper'):
        assert (generated / 'app' / 'api' / entity / 'options' / 'route.ts').is_file()


def test_route_not_written_for_entity_without_rest_surface(generated):
    assert not (generated / 'app' / 'api' / 'user' / 'options').exists()


def test_route_calls_the_web_search_function_as_the_authenticated_caller(generated):
    route = (generated / 'app/api/decimal_gate_item/options/route.ts').read_text()
    assert "import { searchDecimalGateItemOptions } from '@/lib/decimal_gate_item/getters';" in route
    assert 'const { userId: actorId } = await requireCaller(request);' in route
    assert 'withActor(actorId, () =>' in route
    # Permission is checked before the search runs, and no query of its own is written.
    assert route.index("requireApiPermission(actorId, 'decimal_gate_item', 'read')") < route.index('withActor(')
    assert 'prisma' not in route
    assert 'findMany' not in route


def test_route_validates_its_query_parameters(generated):
    route = (generated / 'app/api/decimal_gate_item/options/route.ts').read_text()
    assert 'limit must be an integer between 1 and 200' in route
    assert 'ids exceeds maximum of' in route
    assert 'context must be a JSON object' in route
    assert 'caller is not a valid entity name' in route


def test_organization_route_uses_the_membership_scoped_search():
    env = _make_env()
    rendered = _render(env, 'api_options_route.ts.jinja2', {'parent': 'organization', 'parent_pascal': 'Organization'})
    assert "import { searchAssociatedOrganizationOptions } from '@/lib/organization/getters_associated';" in rendered
    assert 'searchOrganizationOptions' not in rendered
    # The organization picker takes no caller/context narrowing.
    assert 'callerEntity' not in rendered


def _openapi_ctx(**overrides) -> dict:
    ctx = {
        'parent': 'widget',
        'parent_pascal': 'Widget',
        'model_def': {'properties': {'id': {'type': 'string'}, 'name': {'type': 'string'}}, 'required': ['id']},
        'filtered_props': {'name': {'type': 'string'}},
        'can_api': True, 'can_list': False, 'can_create': False, 'can_view': False,
        'can_update': False, 'can_delete': False, 'can_export': False, 'import_eligible': False,
        'parent_rels': [], 'children_raw': [], 'is_approvable': False, 'approval_config': None,
        'write_locked_values': None, 'readonly_fields': [], 'readonly_fields_create_reject': [],
        'readonly_fields_api': [], 'reservation_config': None,
        'sort_filter_fields': [], 'sort_filter_field_kinds': {}, 'sort_filter_relation_fields': [],
    }
    ctx.update(overrides)
    return ctx


def test_openapi_describes_the_options_path_even_when_no_other_route_exists():
    spec = build_entity_openapi(_openapi_ctx())
    get = spec['paths']['/api/widget/options']['get']
    names = {p['name'] for p in get['parameters']}
    assert names == {'q', 'ids', 'limit', 'caller', 'context'}
    assert set(get['responses']) >= {'200', '400', '401', '403', '429'}
    assert get['responses']['200']['content']['application/json']['schema']['type'] == 'array'


def test_openapi_organization_options_has_no_caller_or_context():
    spec = build_entity_openapi(_openapi_ctx(parent='organization', parent_pascal='Organization'))
    names = {p['name'] for p in spec['paths']['/api/organization/options']['get']['parameters']}
    assert names == {'q', 'ids', 'limit'}
