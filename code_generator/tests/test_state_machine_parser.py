"""
Unit tests for state_machine_parser.py (Issue #696, Stage 1 PR2a).

The three fixtures below are verbatim copies of the three real,
hand-written diagrams found in inventory-app's own consumer schema
(goods_receipt_status.mmd, goods_receipt_line_status.mmd,
shipment_line_status.mmd — read-only reference, not modified by this
task). They are embedded as strings rather than read from the consumer
repo so this test has no cross-repo file dependency.

Run:
    cd code_generator && python -m pytest tests/test_state_machine_parser.py -v
"""
from helpers.state_machine_parser import (
    ParseError,
    StateMachineDiagram,
    parse_state_machine_diagram,
)

# ---------------------------------------------------------------------------
# Real consumer diagram fixtures
# ---------------------------------------------------------------------------

GOODS_RECEIPT_STATUS = """\
stateDiagram-v2
    [*] --> draft
    draft --> confirmed
    draft --> cancelled
    confirmed --> [*]
    cancelled --> [*]
"""

GOODS_RECEIPT_LINE_STATUS = """\
stateDiagram-v2
    [*] --> pending
    pending --> split
    pending --> rejected
    split --> [*]
    rejected --> [*]
"""

SHIPMENT_LINE_STATUS = """\
%% shipment_line.status (2 states, forward-only). Documents the existing
%% hand-written guard in lib/shipment_line/state_machine.ts
%% (assertLegalTransition / STATUS_ORDER) -- not read by any generator
%% code yet (Stage 1 PR1 only parses the x-state-machines pointer map
%% itself, not a pointed-to file's contents; PR2 is the Mermaid parser).
stateDiagram-v2
    [*] --> picked
    picked --> packed
    packed --> [*]
"""

UNRECOGNIZED_CONSTRUCT = """\
stateDiagram-v2
    [*] --> draft
    state draft {
        [*] --> awaiting_review
    }
"""


def test_goods_receipt_status():
    result = parse_state_machine_diagram(GOODS_RECEIPT_STATUS)
    assert isinstance(result, StateMachineDiagram)
    assert result.states == {'draft', 'confirmed', 'cancelled'}
    assert result.edges == [('draft', 'confirmed'), ('draft', 'cancelled')]
    assert result.initial_states == {'draft'}
    assert result.terminal_states == {'confirmed', 'cancelled'}


def test_goods_receipt_line_status():
    result = parse_state_machine_diagram(GOODS_RECEIPT_LINE_STATUS)
    assert isinstance(result, StateMachineDiagram)
    assert result.states == {'pending', 'split', 'rejected'}
    assert result.edges == [('pending', 'split'), ('pending', 'rejected')]
    assert result.initial_states == {'pending'}
    assert result.terminal_states == {'split', 'rejected'}


def test_shipment_line_status_with_comments():
    result = parse_state_machine_diagram(SHIPMENT_LINE_STATUS)
    assert isinstance(result, StateMachineDiagram)
    assert result.states == {'picked', 'packed'}
    assert result.edges == [('picked', 'packed')]
    assert result.initial_states == {'picked'}
    assert result.terminal_states == {'packed'}


def test_unrecognized_construct_is_parse_error():
    result = parse_state_machine_diagram(UNRECOGNIZED_CONSTRUCT)
    assert isinstance(result, ParseError)


def test_missing_header_is_parse_error():
    result = parse_state_machine_diagram('draft --> confirmed\n')
    assert isinstance(result, ParseError)


def test_header_is_case_and_whitespace_tolerant():
    result = parse_state_machine_diagram('  STATEDIAGRAM-V2  \ndraft --> confirmed\n')
    assert isinstance(result, StateMachineDiagram)
    assert result.edges == [('draft', 'confirmed')]


def test_duplicate_edges_are_preserved_not_deduplicated():
    text = """\
stateDiagram-v2
    draft --> confirmed
    draft --> confirmed
"""
    result = parse_state_machine_diagram(text)
    assert isinstance(result, StateMachineDiagram)
    assert result.edges == [('draft', 'confirmed'), ('draft', 'confirmed')]


def test_labeled_edge_is_parse_error():
    text = """\
stateDiagram-v2
    draft --> confirmed : qty >= 0
"""
    result = parse_state_machine_diagram(text)
    assert isinstance(result, ParseError)
