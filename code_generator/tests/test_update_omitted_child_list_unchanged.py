"""
Issue #777: an update that omits a relation/child-list field must leave the
existing relation unchanged, not clear it.

update{Parent} treats every child argument as the complete new state (`set`
for a connect-style relation, delete-missing/update/create for an owned child
list). The REST PUT/bulk-update routes used to pass `<field> ?? []`, so a body
without the field (e.g. only renaming a role) silently removed every related
row. The routes now fall back to the row's current value, and the OpenAPI
request schemas document these fields.
"""
from build_context import _child_current_value_fallback, build_context
from generate import _make_env, _render
from generators_openapi import build_entity_openapi

from test_import_embedded_child_convergence import (  # noqa: F401 -- _sm_tmp_cwd is an autouse fixture
    _goods_receipt_entity, _goods_receipt_schema, _sm_tmp_cwd,
)


_CONNECT_CHILD = {'property_name': 'users', 'child_var': 'users', 'use_connect': True}
_OWNED_CHILD = {
    'property_name': 'lines', 'child_var': 'lines', 'use_connect': False,
    'props_with_id': ['id', 'product_id', 'quantity'],
}


class TestChildCurrentValueFallback:
    def test_connect_child_falls_back_to_current_ids(self):
        expr = _child_current_value_fallback(_CONNECT_CHILD, 'role', 'id', 'users_ids')
        assert expr.startswith('(users_ids ?? ')
        assert "prisma.role.findUnique({ where: { id: id }, select: { users: { select: { id: true } } } })" in expr
        assert '?.users.map((r) => r.id) ?? []' in expr

    def test_owned_child_falls_back_to_current_rows(self):
        expr = _child_current_value_fallback(_OWNED_CHILD, 'purchase_order', 'id', 'lines')
        assert expr.startswith('(lines ?? ')
        assert 'select: { lines: { select: { id: true, product_id: true, quantity: true } } }' in expr
        # Decimal/DateTime values arrive in the same string forms the edit form submits.
        assert expr.count('JSON.parse(JSON.stringify(') == 1

    def test_no_supplied_expr_always_uses_current_value(self):
        expr = _child_current_value_fallback(_CONNECT_CHILD, 'role', 'action.id', None)
        assert '??' in expr  # only the "no row" fallback, never a supplied value
        assert not expr.startswith('(users_ids')
        assert 'where: { id: action.id }' in expr


def _render_route(template: str) -> str:
    ctx = build_context(_goods_receipt_entity(), _goods_receipt_schema())
    return _render(_make_env(), template, ctx)


class TestRoutesKeepOmittedChildList:
    def test_put_route_update_call_does_not_default_to_empty_list(self):
        rendered = _render_route('api_detail_route.ts.jinja2')
        call = next(line for line in rendered.splitlines() if 'await updateGoodsReceipt(' in line)
        assert ', lines ?? []' not in call
        assert '(lines ?? (JSON.parse(JSON.stringify((await prisma.goods_receipt.findUnique({ where: { id: id }' in call

    def test_bulk_route_update_call_does_not_default_to_empty_list(self):
        rendered = _render_route('api_bulk_route.ts.jinja2')
        call = next(line for line in rendered.splitlines() if 'await updateGoodsReceipt(' in line)
        assert ', lines ?? []' not in call
        assert '(lines ?? (JSON.parse(JSON.stringify((await prisma.goods_receipt.findUnique({ where: { id: id }' in call

    def test_create_calls_still_default_to_empty_list(self):
        for template in ('api_route.ts.jinja2', 'api_bulk_route.ts.jinja2'):
            rendered = _render_route(template)
            call = next(line for line in rendered.splitlines() if 'await addGoodsReceipt(' in line)
            assert 'lines ?? []' in call, template


class TestOpenApiDocumentsChildListFields:
    def _spec(self):
        ctx = build_context(_goods_receipt_entity(), _goods_receipt_schema())
        return build_entity_openapi(ctx)

    def test_owned_child_list_in_create_and_bulk_update_schemas(self):
        spec = self._spec()
        for name in ('GoodsReceiptCreateRequest', 'GoodsReceiptBulkUpdateItem'):
            field = spec['schemas'][name]['properties']['lines']
            assert field['type'] == 'array'
            assert field['items']['type'] == 'object'
            assert 'id' in field['items']['properties']
            assert 'omit this field to leave it unchanged' in field['description']
            assert 'lines' not in spec['schemas'][name].get('required', [])

    def test_connect_child_documented_as_id_list(self):
        ctx = build_context(_goods_receipt_entity(), _goods_receipt_schema())
        ctx['api_write_children'] = [{'body_key': 'users_ids', 'use_connect': True, 'item_props': {}}]
        spec = build_entity_openapi(ctx)
        field = spec['schemas']['GoodsReceiptCreateRequest']['properties']['users_ids']
        assert field['type'] == 'array'
        assert field['items'] == {'type': 'string'}
