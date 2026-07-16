"""
Regression test for the Phase 3 (cmd_312) "richer Ship skeleton" enhancement to
service_after_approve_stub.ts.jinja2.

OD-3 (Option B, config-driven — not fully declarative): an approval-driven entity
that is `x-splittable` with a `ledgerDomain` but has no `x-ledger-source` of its
own (e.g. purchase_per_item) is the "Ship" side of a ledger_transaction
reservation. Its once-stub should name the real ledger/transactionable/pool
entities and outline the netting steps as comments, instead of a bare TODO.

Entities without this shape (e.g. leave_request) must keep getting the plain
empty stub — this pins that against regression.
"""
from pathlib import Path
from jinja2 import Environment, FileSystemLoader

from helpers.naming import to_pascal_case, to_camel_case


def _make_env() -> Environment:
    templates_dir = Path(__file__).parent.parent / 'templates'
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
    return _ENV.get_template('service_after_approve_stub.ts.jinja2').render(**ctx)


class TestShipSkeletonRicherStub:
    """is_ship_skeleton=True (purchase_per_item-shaped entity)."""

    def _rendered(self) -> str:
        return _render_stub({
            'snake_name': 'purchase_per_item',
            'pascal_name': 'PurchasePerItem',
            'is_ship_skeleton': True,
            'ledger_entity': 'inventory_transaction',
            'transactionable_entity': 'inventory_transactionable',
            'pool_entity': 'inventory',
            'bridge_fk_field': 'inventory_transactionable_id',
        })

    def test_resolved_entity_names_present(self):
        rendered = self._rendered()
        assert 'inventory_transaction' in rendered
        assert 'inventory_transactionable' in rendered
        assert 'tx.inventory' in rendered or 'Pool={{ pool_entity }}'.replace(
            '{{ pool_entity }}', 'inventory') in rendered

    def test_bridge_fk_field_present(self):
        assert 'inventory_transactionable_id' in self._rendered()

    def test_netting_structure_comment_present(self):
        rendered = self._rendered()
        assert 'Net reserved_delta' in rendered
        assert "event_type: 'ship'" in rendered

    def test_no_bare_todo_only(self):
        """Richer skeleton replaces the bare one-line TODO with a guided outline."""
        rendered = self._rendered()
        assert 'TODO: implement post-approval effects here' not in rendered
        assert 'TODO: implement post-approval Ship effects here' in rendered

    def test_still_exports_after_approve(self):
        rendered = self._rendered()
        assert 'export async function afterApprove(' in rendered


class TestPlainStubUnaffected:
    """is_ship_skeleton absent/False (e.g. leave_request) — must keep the plain stub."""

    def _rendered(self) -> str:
        return _render_stub({
            'snake_name': 'leave_request',
            'pascal_name': 'LeaveRequest',
            'is_ship_skeleton': False,
        })

    def test_plain_todo_present(self):
        rendered = self._rendered()
        assert 'TODO: implement post-approval effects here' in rendered

    def test_no_ledger_vocabulary_leaks_in(self):
        rendered = self._rendered()
        assert 'inventory_transaction' not in rendered
        assert 'Net reserved_delta' not in rendered
        assert 'Ship skeleton' not in rendered
