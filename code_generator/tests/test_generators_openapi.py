"""
Tests for generators_openapi.py (cmd_1198): list query parameters,
readOnly marking, bulk requestBody, per-operation 4xx responses, and the
CSV export/import paths. Exercises build_entity_openapi()/
assemble_openapi_document() directly against a hand-built ctx dict rather
than routing through build_context() -- these two functions' contract IS
the ctx dict shape, so a unit test at that boundary is both faithful and
independent of build_context()'s own (separately tested) derivation
logic. Does not depend on generated output (Test Rules #1: generator
tests must not require a prior generate-code run).
"""
from generators_openapi import build_entity_openapi, assemble_openapi_document


def _base_ctx(**overrides) -> dict:
    """A minimal, fully-enabled entity ctx: list/create/view/update/delete/
    export all on, one plain string field ('name') plus the base 'id'."""
    ctx = {
        'parent': 'widget',
        'parent_pascal': 'Widget',
        'model_def': {
            'properties': {
                'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                'name': {'type': 'string'},
            },
            'required': ['id', 'name'],
        },
        'filtered_props': {
            'name': {'type': 'string'},
        },
        'can_api': True,
        'can_list': True,
        'can_create': True,
        'can_view': True,
        'can_update': True,
        'can_delete': True,
        'can_export': True,
        'import_eligible': False,
        'parent_rels': [],
        'children_raw': [],
        'is_approvable': False,
        'approval_config': None,
        'write_locked_values': None,
        'readonly_fields': [],
        'readonly_fields_create_reject': [],
        'readonly_fields_api': [],
        'reservation_config': None,
        'sort_filter_fields': ['id', 'name', 'created_at', 'updated_at', 'creator_id'],
        'sort_filter_field_kinds': {'id': 'string', 'name': 'string', 'created_at': 'date', 'updated_at': 'date', 'creator_id': 'string'},
        'sort_filter_relation_fields': [],
    }
    ctx.update(overrides)
    return ctx


def test_api_false_returns_empty():
    ctx = _base_ctx(can_api=False)
    assert build_entity_openapi(ctx) == {}


# ---------------------------------------------------------------------------
# Gap 2: readOnly marking
# ---------------------------------------------------------------------------

def test_readonly_marks_baseline_system_field_but_not_ordinary_field():
    spec = build_entity_openapi(_base_ctx())
    record = spec['schemas']['Widget']
    assert record['properties']['id']['readOnly'] is True
    assert 'readOnly' not in record['properties']['name']


def test_readonly_marks_custom_readonly_fields_ctx_key():
    ctx = _base_ctx(readonly_fields=['name'])
    spec = build_entity_openapi(ctx)
    record = spec['schemas']['Widget']
    assert record['properties']['name']['readOnly'] is True


def test_readonly_not_leaked_into_create_request_schema():
    spec = build_entity_openapi(_base_ctx())
    create = spec['schemas']['WidgetCreateRequest']
    assert 'id' not in create['properties']  # unchanged pre-existing behavior
    assert 'readOnly' not in create['properties']['name']


# ---------------------------------------------------------------------------
# Gap 1: list query parameters
# ---------------------------------------------------------------------------

def test_list_get_has_page_pagesize_sort_and_filter_params():
    spec = build_entity_openapi(_base_ctx())
    params = spec['paths']['/api/widget']['get']['parameters']
    names = [p['name'] for p in params]
    assert names[0] == 'page'
    assert names[1] == 'pageSize'
    assert 'sort' in names
    assert 'f.name' in names
    assert 'f.id' in names
    assert 'f.created_at' in names

    page = next(p for p in params if p['name'] == 'page')
    assert page['schema'] == {'type': 'integer', 'minimum': 0, 'default': 0}
    page_size = next(p for p in params if p['name'] == 'pageSize')
    assert page_size['schema']['maximum'] == 200
    assert page_size['schema']['default'] == 50


def test_filter_param_reuses_real_field_schema_and_strips_readonly():
    ctx = _base_ctx()
    spec = build_entity_openapi(ctx)
    params = spec['paths']['/api/widget']['get']['parameters']
    f_id = next(p for p in params if p['name'] == 'f.id')
    # Same pattern as the record schema's 'id' field, but no readOnly leak
    # (readOnly is a record/response concept, meaningless on a query param).
    assert f_id['schema']['pattern'] == '^c[a-z0-9]{24,}$'
    assert 'readOnly' not in f_id['schema']


def test_filter_param_match_description_differs_by_kind():
    ctx = _base_ctx()
    spec = build_entity_openapi(ctx)
    params = spec['paths']['/api/widget']['get']['parameters']
    f_name = next(p for p in params if p['name'] == 'f.name')
    f_created = next(p for p in params if p['name'] == 'f.created_at')
    assert 'substring' in f_name['description']
    assert 'exact match' in f_created['description']


def test_sort_field_created_at_default_string_fallback_is_date_time():
    ctx = _base_ctx()
    spec = build_entity_openapi(ctx)
    params = spec['paths']['/api/widget']['get']['parameters']
    f_created = next(p for p in params if p['name'] == 'f.created_at')
    assert f_created['schema'] == {'type': 'string', 'format': 'date-time'}


def test_relation_filter_field_produces_its_own_parameter():
    ctx = _base_ctx(sort_filter_relation_fields=[('assignee_id', 'name')])
    spec = build_entity_openapi(ctx)
    params = spec['paths']['/api/widget']['get']['parameters']
    rel_param = next(p for p in params if p['name'] == 'f.assignee_id')
    assert rel_param['schema'] == {'type': 'string'}
    assert "related row's 'name'" in rel_param['description']
    sort_param = next(p for p in params if p['name'] == 'sort')
    assert 'assignee_id' in sort_param['description']


def test_no_sort_param_when_nothing_sortable():
    ctx = _base_ctx(sort_filter_fields=[], sort_filter_relation_fields=[])
    spec = build_entity_openapi(ctx)
    params = spec['paths']['/api/widget']['get']['parameters']
    names = [p['name'] for p in params]
    assert 'sort' not in names


# ---------------------------------------------------------------------------
# Gap 4: 4xx responses
# ---------------------------------------------------------------------------

def test_list_get_responses_include_400_401_403_429_not_404():
    spec = build_entity_openapi(_base_ctx())
    codes = set(spec['paths']['/api/widget']['get']['responses'])
    assert codes == {'200', '400', '401', '403', '429'}


def test_create_post_baseline_responses_no_400_without_readonly_reject():
    spec = build_entity_openapi(_base_ctx())
    codes = set(spec['paths']['/api/widget']['post']['responses'])
    assert codes == {'201', '401', '403', '409', '422', '429'}


def test_create_post_gets_400_when_readonly_create_reject_present():
    ctx = _base_ctx(readonly_fields_create_reject=['some_field'])
    spec = build_entity_openapi(ctx)
    codes = set(spec['paths']['/api/widget']['post']['responses'])
    assert '400' in codes


def test_view_get_responses_401_403_404_429_no_write_codes():
    spec = build_entity_openapi(_base_ctx())
    codes = set(spec['paths']['/api/widget/{id}']['get']['responses'])
    assert codes == {'200', '401', '403', '404', '429'}


def test_update_put_baseline_responses_no_400_without_readonly_api():
    spec = build_entity_openapi(_base_ctx())
    codes = set(spec['paths']['/api/widget/{id}']['put']['responses'])
    assert codes == {'200', '401', '403', '404', '409', '422', '429'}


def test_update_put_gets_400_when_readonly_api_present():
    ctx = _base_ctx(readonly_fields_api=['some_field'])
    spec = build_entity_openapi(ctx)
    codes = set(spec['paths']['/api/widget/{id}']['put']['responses'])
    assert '400' in codes


def test_delete_baseline_responses_no_409():
    spec = build_entity_openapi(_base_ctx())
    codes = set(spec['paths']['/api/widget/{id}']['delete']['responses'])
    assert codes == {'204', '401', '403', '404', '429'}


def test_delete_gets_409_only_for_count_mode_reservation():
    ctx = _base_ctx(reservation_config={'mode': 'count'})
    spec = build_entity_openapi(ctx)
    codes = set(spec['paths']['/api/widget/{id}']['delete']['responses'])
    assert '409' in codes

    ctx_other_mode = _base_ctx(reservation_config={'mode': 'slot'})
    spec_other = build_entity_openapi(ctx_other_mode)
    codes_other = set(spec_other['paths']['/api/widget/{id}']['delete']['responses'])
    assert '409' not in codes_other


def test_permission_description_names_the_right_operation():
    spec = build_entity_openapi(_base_ctx())
    list_403 = spec['paths']['/api/widget']['get']['responses']['403']['description']
    create_403 = spec['paths']['/api/widget']['post']['responses']['403']['description']
    delete_403 = spec['paths']['/api/widget/{id}']['delete']['responses']['403']['description']
    assert "'read'" in list_403
    assert "'create'" in create_403
    assert "'delete'" in delete_403


# ---------------------------------------------------------------------------
# Gap 3: bulk requestBody + narrower bulk response surface
# ---------------------------------------------------------------------------

def test_bulk_put_requestbody_is_id_plus_create_fields():
    spec = build_entity_openapi(_base_ctx())
    bulk_put = spec['paths']['/api/widget/bulk']['put']
    body_schema = bulk_put['requestBody']['content']['application/json']['schema']
    assert body_schema == {'type': 'array', 'items': {'$ref': '#/components/schemas/WidgetBulkUpdateItem'}}
    item_schema = spec['schemas']['WidgetBulkUpdateItem']
    assert item_schema['required'] == ['id']
    assert 'id' in item_schema['properties']
    assert 'name' in item_schema['properties']  # from create_properties


def test_bulk_delete_requestbody_is_bare_id_array():
    spec = build_entity_openapi(_base_ctx())
    bulk_delete = spec['paths']['/api/widget/bulk']['delete']
    body_schema = bulk_delete['requestBody']['content']['application/json']['schema']
    assert body_schema == {
        'type': 'array',
        'items': {'type': 'object', 'properties': {'id': {'type': 'string'}}, 'required': ['id']},
    }


def test_bulk_responses_never_include_404_409_422():
    spec = build_entity_openapi(_base_ctx(reservation_config={'mode': 'count'}, readonly_fields_api=['x']))
    for op in ('post', 'put', 'delete'):
        codes = set(spec['paths']['/api/widget/bulk'][op]['responses'])
        assert codes == {'207', '401', '403', '429'}, f'{op}: per-item errors must not leak to top-level'


# ---------------------------------------------------------------------------
# Gap 5: export/import paths
# ---------------------------------------------------------------------------

def test_export_path_absent_without_can_export():
    ctx = _base_ctx(can_export=False)
    spec = build_entity_openapi(ctx)
    assert '/api/widget/export' not in spec['paths']


def test_export_path_present_and_has_no_rate_limit_or_404():
    spec = build_entity_openapi(_base_ctx())
    export_get = spec['paths']['/api/widget/export']['get']
    codes = set(export_get['responses'])
    assert codes == {'200', '401', '403'}
    assert 'session' in export_get['responses']['401']['description']  # dual-auth wording


def test_import_path_absent_by_default():
    spec = build_entity_openapi(_base_ctx())
    assert '/api/widget/import' not in spec['paths']
    assert 'ImportResult' not in spec['schemas']


def test_import_path_present_when_eligible():
    ctx = _base_ctx(import_eligible=True)
    spec = build_entity_openapi(ctx)
    import_post = spec['paths']['/api/widget/import']['post']
    body = import_post['requestBody']['content']['application/json']['schema']
    assert body['required'] == ['csv']
    assert set(body['properties']) == {'csv', 'dryRun', 'confirmToken'}
    codes = set(import_post['responses'])
    assert codes == {'200', '400', '401', '403'}
    assert spec['schemas']['ImportResult'] == {
        'type': 'object',
        'properties': {
            'summary': {
                'type': 'object',
                'properties': {
                    'total': {'type': 'integer'},
                    'succeeded': {'type': 'integer'},
                    'failed': {'type': 'integer'},
                    'dryRun': {'type': 'boolean'},
                },
                'required': ['total', 'succeeded', 'failed', 'dryRun'],
            },
            'errors': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'properties': {
                        'row': {'type': 'integer'},
                        'code': {'type': 'string'},
                        'message': {'type': 'string'},
                    },
                    'required': ['row', 'code', 'message'],
                },
            },
            'confirmToken': {'type': 'string'},
            'skippedColumns': {'type': 'array', 'items': {'type': 'string'}},
        },
        'required': ['summary', 'errors'],
    }


# ---------------------------------------------------------------------------
# assemble_openapi_document(): ImportResult only added when referenced
# ---------------------------------------------------------------------------

def test_assemble_document_merges_import_result_schema_once():
    spec_a = build_entity_openapi(_base_ctx(parent='widget', parent_pascal='Widget', import_eligible=True))
    spec_b = build_entity_openapi(_base_ctx(parent='gadget', parent_pascal='Gadget', import_eligible=True))
    doc = assemble_openapi_document([spec_a, spec_b])
    assert doc['components']['schemas']['ImportResult'] is not None
    assert '/api/widget/import' in doc['paths']
    assert '/api/gadget/import' in doc['paths']


def test_assemble_document_skips_empty_specs():
    doc = assemble_openapi_document([{}, build_entity_openapi(_base_ctx())])
    assert '/api/widget' in doc['paths']
