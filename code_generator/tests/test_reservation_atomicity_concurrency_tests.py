"""Pin the generated reservation spec's atomic-rollback and double-booking cases.

The generated API spec for an item-reservation entity must keep (5) a multi-line
request whose later line fails and leaves nothing behind, and (6) two
simultaneous requests for stock that fits only one of them. The cases are
declared only where the request is allocated at create time (a lines entity with
its own submit_on defers the claim to submit time).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from generate import _make_env

TEMPLATES = Path(__file__).parent.parent / 'templates'


def _spec_ctx(alloc_entity='order_allocation', submit_on=False) -> dict:
    return {
        'entity': 'purchase_order', 'pascal': 'PurchaseOrder', 'alloc_entity': alloc_entity,
        'pool_res_field': 'reserved_quantity', 'pool_qty_field': 'quantity',
        'pool_entity': 'inventory', 'pool_field': 'inventory_id',
        'parent_str_field': 'title', 'parent_fk_field': 'customer_id',
        'lines_prop': 'lines', 'criteria_item_field': 'product_id',
        'req_qty_field': 'quantity', 'criteria_pool_field': 'category',
        'orderby_desc': 'created_at',
        'reservation_lines_has_submit_on': submit_on,
    }


def _render_spec(**kw) -> str:
    return _make_env().get_template('test_reservation_spec.cy.ts.jinja2').render(**_spec_ctx(**kw))


def test_rollback_case_rejects_whole_request_and_restores_pool():
    out = _render_spec()
    assert "it('(5): atomic rollback" in out
    assert "expect(res.status).to.eq(409);" in out.split("(5): atomic rollback", 1)[1]
    assert "expect(inv.reserved_quantity).to.eq(0);" in out.split("(5): atomic rollback", 1)[1].split("(6)", 1)[0]


def test_concurrent_case_fires_both_requests_at_once_and_expects_one_winner():
    out = _render_spec()
    body = out.split("(6): concurrent requests", 1)[1]
    assert "Promise.all([post('a'), post('b')])" in body
    assert "deep.eq([201, 409])" in body
    assert "to.be.at.most(inv.quantity)" in body


def test_cases_not_generated_when_claim_is_deferred_to_submit_time():
    out = _render_spec(submit_on=True)
    assert "(5): atomic rollback" not in out
    assert "(6): concurrent requests" not in out


def test_cases_not_generated_without_allocation_entity():
    out = _render_spec(alloc_entity=None)
    assert "(5): atomic rollback" not in out
    assert "(6): concurrent requests" not in out


def test_scarce_seed_registered_and_defined():
    helper = (TEMPLATES / 'test_reservation_helper.ts.jinja2').read_text()
    registry = (TEMPLATES / 'test_tasks_registry.ts.jinja2').read_text()
    assert "seedReservation{{ pascal }}Scarce" in helper
    assert "'db:seedReservation{{ entity.pascal }}Scarce'" in registry
