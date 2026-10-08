"""
Approval section on the mobile detail screen (mobile_entities.py + templates/mobile/).

The mobile e2e fixture (fixtures/mobile_entity_e2e_gate/) is merged into a copy of the default schema
and run through the real build_user_schema.py -> generate.py pipeline. Checks that:

- an entity with an `x-approval` bridge and the approval section gets native screens, while one with
  either half alone, or with another one-to-one bridge, keeps the placeholder
- the approval lock-down flags only make an entity eligible together with the approval section
- the screen calls the shared approval module and predicates (copied byte for byte) and the approval
  REST routes, and evaluates no role, order or ownership rule of its own
- a value only the approval workflow may write is not offered by the form
- the capabilities route lists the rows the caller may act on
- an approval entity with `x-splittable` and a `quantityField` gets the split section, which calls the
  split REST route; a splittable entity without the approval section keeps the placeholder

Run:
    cd code_generator && python3 -m pytest tests/test_mobile_approval.py -v
"""
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

from build_user_schema import build_user_schema
from generate import generate
from mobile_entities import mobile_ineligible_reason

REPO = Path(__file__).resolve().parents[2]
FIXTURE = REPO / 'code_generator' / 'tests' / 'fixtures' / 'mobile_entity_e2e_gate'
COMPOSE = REPO / 'scripts' / 'compose_child_datagrid_e2e_fixture.py'


@pytest.fixture(scope='module')
def out(tmp_path_factory):
    app = tmp_path_factory.mktemp('mobile_approval')
    (app / 'code_generator').mkdir()
    (app / 'prisma').mkdir()
    shutil.copy(REPO / 'code_generator' / 'json_schema.yaml', app / 'code_generator')
    shutil.copy(REPO / 'code_generator' / 'json_schema_internal.yaml', app / 'code_generator')
    shutil.copy(REPO / 'prisma' / 'schema.prisma', app / 'prisma')
    shutil.copytree(REPO / 'messages', app / 'messages')
    result = subprocess.run([sys.executable, str(COMPOSE), str(FIXTURE), str(app)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    intermediate = app / 'generated_json_schema.yaml'
    build_user_schema(app / 'code_generator' / 'json_schema.yaml', app / 'prisma' / 'schema.prisma', intermediate)
    generate(str(intermediate), str(app))
    return app


def _read(out: Path, rel: str) -> str:
    return (out / rel).read_text()


# --- eligibility ---------------------------------------------------------------------------

def _ctx(**overrides):
    base = {'can_api': True, 'can_list': True, 'field_categories': {'text': ['name']}}
    base.update(overrides)
    return base


BRIDGE = [{'prop_name': 'approvable_id', 'target': 'approvable'}]
SECTION = [{'name': 'ApprovalSection'}]


def test_approval_bridge_with_its_section_is_eligible():
    assert mobile_ineligible_reason(_ctx(one_to_one_rels=BRIDGE, entity_view_components=SECTION)) is None


def test_approval_lockdown_flags_are_allowed_with_the_section():
    ctx = _ctx(one_to_one_rels=BRIDGE, entity_view_components=SECTION, has_edit_guard=True,
               has_delete_guard=True, write_locked_values={'status': ['approved']})
    assert mobile_ineligible_reason(ctx) is None


@pytest.mark.parametrize('key,value', [
    ('has_edit_guard', True),
    ('has_delete_guard', True),
    ('write_locked_values', {'status': ['x']}),
])
def test_lockdown_flags_without_an_approval_keep_the_placeholder(key, value):
    assert mobile_ineligible_reason(_ctx(**{key: value})) is not None


def test_bridge_without_the_section_and_section_without_the_bridge_are_ineligible():
    assert mobile_ineligible_reason(_ctx(one_to_one_rels=BRIDGE)) is not None
    assert mobile_ineligible_reason(_ctx(entity_view_components=SECTION)) is not None


def test_another_one_to_one_bridge_or_component_keeps_the_placeholder():
    other = [{'prop_name': 'x_id', 'target': 'other'}]
    assert mobile_ineligible_reason(_ctx(one_to_one_rels=BRIDGE + other, entity_view_components=SECTION)) is not None
    assert mobile_ineligible_reason(
        _ctx(one_to_one_rels=BRIDGE, entity_view_components=SECTION + [{'name': 'Chart'}])) is not None


# --- generated screens -----------------------------------------------------------------------

def test_approval_entity_gets_screens_and_the_shared_approval_module(out):
    for rel in (
        'mobile/components/mobile_request/FormView.tsx',
        'mobile/components/mobile_request/FormUpsert.tsx',
        'mobile/lib/mobile_request/mobile_client.ts',
        'mobile/lib/mobile_request/use_entity_approval_actions.ts',
        'mobile/lib/approval_request/submit_predicate.ts',
        'mobile/components/native/ApprovalSection.tsx',
    ):
        assert (out / rel).exists(), rel


def test_shared_approval_module_and_predicates_are_the_web_ones(out):
    assert _read(out, 'mobile/lib/mobile_request/use_entity_approval_actions.ts') == \
        _read(out, 'lib/mobile_request/use_entity_approval_actions.ts')
    assert _read(out, 'mobile/lib/approval_request/submit_predicate.ts') == \
        (REPO / 'lib' / 'approval_request' / 'submit_predicate.ts').read_text()


def test_view_mounts_the_approval_section_with_the_shared_withdraw_declaration(out):
    view = _read(out, 'mobile/components/mobile_request/FormView.tsx')
    assert "from '@/lib/mobile_request/use_entity_approval_actions'" in view
    assert 'HAS_ON_WITHDRAWN' in view
    assert '<ApprovalSection' in view
    assert 'getMobileRequestApprovalState' in view


def test_entity_without_approval_does_not_mount_the_section(out):
    view = _read(out, 'mobile/components/mobile_note/FormView.tsx')
    assert 'ApprovalSection' not in view
    assert not (out / 'mobile/lib/mobile_note/use_entity_approval_actions.ts').exists()


def test_section_calls_the_approval_routes_and_holds_no_rule_of_its_own(out):
    section = _read(out, 'mobile/components/native/ApprovalSection.tsx')
    http = _read(out, 'mobile/lib/entity-http.ts')
    assert '/api/approval_request/${requestId}/${action}' in http
    assert 'postApprovalAction' in section
    assert 'actionable_request_ids' in section
    assert 'current_round_request_ids' in section
    # the role / order / ownership rules stay on the server
    for forbidden in ('approver_role_id', 'currentUserRoleIds', 'canActOnApprovalRequest', 'creator_id', 'preceded_by'):
        assert forbidden not in section


def test_row_locked_by_the_server_is_neither_editable_nor_deletable(out):
    http = _read(out, 'mobile/lib/entity-http.ts')
    assert '!row.write_locks?.edit_locked' in http
    assert '!row.write_locks?.delete_locked' in http


def test_only_the_approval_entity_reads_the_approval_state(out):
    assert 'getMobileNoteApprovalState' not in _read(out, 'mobile/lib/mobile_note/mobile_client.ts')
    assert 'getMobileRequestApprovalState' in _read(out, 'mobile/lib/mobile_request/mobile_client.ts')


def test_form_does_not_offer_values_only_the_approval_may_write(out):
    client = _read(out, 'mobile/lib/mobile_request/mobile_client.ts')
    assert '"draft"' in client and '"submitted"' in client
    assert '"approved"' not in client
    assert '"rejected"' not in client


def test_messages_the_section_reads_are_bundled(out):
    messages = _read(out, 'mobile/lib/messages.ts')
    assert '"ApprovalRequestStatus"' in messages
    assert '"approvalRequests"' in messages


def test_capabilities_route_lists_the_rows_the_caller_may_act_on(out):
    route = _read(out, 'app/api/mobile_request/[id]/capabilities/route.ts')
    assert 'current_round_request_ids: _latestRoundRequests.map((r) => r.id)' in route
    assert 'actionable_request_ids: _actionableRequestIds' in route
    # the same order check every approve / reject route performs decides each row
    assert 'assertApprovalOrder(_req.id)' in route


# --- split action ---------------------------------------------------------------------------

def test_splittable_entity_without_the_approval_section_keeps_the_placeholder():
    assert mobile_ineligible_reason(_ctx(is_splittable=True)) is not None


def test_splittable_approval_entity_is_eligible():
    ctx = _ctx(one_to_one_rels=BRIDGE, entity_view_components=SECTION, is_splittable=True)
    assert mobile_ineligible_reason(ctx) is None


def test_split_entity_gets_the_section_and_the_split_client(out):
    for rel in (
        'mobile/components/native/SplitSection.tsx',
        'mobile/components/mobile_shipment/FormView.tsx',
        'mobile/lib/mobile_shipment/mobile_client.ts',
    ):
        assert (out / rel).exists(), rel
    view = _read(out, 'mobile/components/mobile_shipment/FormView.tsx')
    assert '<SplitSection' in view
    assert 'MOBILE_SHIPMENT_SPLIT' in view
    assert 'splitMobileShipment' in view


def test_split_config_names_the_quantity_and_the_part_fields(out):
    client = _read(out, 'mobile/lib/mobile_shipment/mobile_client.ts')
    assert 'export const MOBILE_SHIPMENT_SPLIT: SplitConfig' in client
    assert '"quantityField": "quantity"' in client
    # the part field is the foreign key the entity's own form draws as a picker
    split = client[client.index('MOBILE_SHIPMENT_SPLIT'):]
    assert '"key": "mobile_group_id"' in split
    assert '"kind": "relation"' in split
    assert '"target": "mobile_group"' in split
    assert "postSplit('mobile_shipment', id, parts)" in client


def test_split_calls_the_route_the_web_section_calls(out):
    http = _read(out, 'mobile/lib/entity-http.ts')
    assert '`/api/${entity}/${id}/actions/split`' in http
    web = _read(out, 'components/mobile_shipment/SplitActionSection.tsx')
    assert '/api/mobile_shipment/${id}/actions/split' in web
    assert (out / 'app/api/mobile_shipment/[id]/actions/split/route.ts').exists()


def test_split_section_applies_the_web_total_rule_and_holds_no_rule_of_its_own(out):
    section = _read(out, 'mobile/components/native/SplitSection.tsx')
    # Split is available only when the parts add up to the record's quantity, and with two parts at least
    assert 'remaining !== 0' in section
    assert 'parts.length <= 2' in section
    for forbidden in ('approvable', 'approval_request', 'creator_id', 'canActOnApprovalRequest'):
        assert forbidden not in section


def test_only_split_entities_get_the_split_client(out):
    assert 'SPLIT' not in _read(out, 'mobile/lib/mobile_request/mobile_client.ts')
    assert 'SplitSection' not in _read(out, 'mobile/components/mobile_request/FormView.tsx')
    assert 'SplitSection' not in _read(out, 'mobile/components/mobile_note/FormView.tsx')



def test_approval_and_split_routes_accept_the_mobile_access_token(out):
    routes = [
        (REPO / 'app' / 'api' / 'approval_request' / '[id]' / action / 'route.ts').read_text()
        for action in ('approve', 'reject', 'withdraw')
    ]
    routes.append(_read(out, 'app/api/mobile_shipment/[id]/actions/split/route.ts'))
    for route in routes:
        assert 'requireCaller(' in route
        assert 'requireDualAuth' not in route
