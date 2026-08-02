"""
Regression tests for generate-code idempotency (cmd_507).

Background
----------
generate.py used to load messages/en.json's *existing* label/namespace values
directly into the Cypress-spec label lookup (`set_messages_fields` /
`set_messages_namespaces`). That made a first run (no messages/en.json yet)
diverge from a second run (file present, written by `_update_json` from the
first run's schema-derived output) whenever the file's ordering/section shape
differed from what the collectors would recompute — and, separately, a
consumer's custom translation in messages/en.json created a genuine mismatch
between the app's rendered label (which reads the file) and the spec's
expected label (which read schema-derived humanized text, ignoring the file).

The fix: `generate()` now computes schema defaults via the same collectors
`generators_i18n.update_i18n_and_config` uses (`_collect_field_keys` /
`_collect_native_enum_namespaces` / `_collect_custom_component_sections`),
then merges any existing messages/en.json values on top — file wins — via
`_merge_file_wins_messages`, the same merge rule `_update_json` uses to write
that file in the first place. Schema defaults alone guarantee idempotency
(run 1 with no file == run 2 with the file `_update_json` wrote from run 1's
defaults); the file-wins overlay guarantees spec/app agreement when a
consumer hand-edits messages/en.json.

Tests here exercise the merge (`_merge_file_wins_messages`) and the two
enum-label lookup functions (`_enum_label` / `_reverse_enum_label`) in
isolation via dependency injection (`set_messages_fields` /
`set_messages_namespaces`) — no generate-code run, no generated artifacts.
"""
import pytest

from generators_i18n import _merge_file_wins_messages, _collect_native_enum_namespaces
from generators_test import (
    set_messages_fields,
    set_messages_namespaces,
    _enum_label,
    _reverse_enum_label,
)


@pytest.fixture(autouse=True)
def _reset_message_globals():
    """generators_test._messages_fields/_messages_ns are module globals mutated
    by set_messages_fields/set_messages_namespaces — reset before and after
    each test so state never leaks across tests in this file or others."""
    set_messages_fields({})
    set_messages_namespaces({})
    yield
    set_messages_fields({})
    set_messages_namespaces({})


def _shift_status_schema():
    """Minimal schema with one nativeEnum field (ShiftStatus)."""
    return {
        'definitions': {
            'Shift': {
                'properties': {
                    'status': {
                        '_prisma_native_enum_type': 'ShiftStatus',
                        'enum': ['scheduled', 'approved', 'cancelled'],
                    },
                },
            },
        },
    }


def test_namespace_path_with_schema_computed_ns_returns_humanized_label():
    """_enum_label returns the schema-computed humanized label when _messages_ns
    is populated purely from _collect_native_enum_namespaces (no file overlay)
    — the run-1 (no messages/en.json yet) case."""
    schema_ns = _collect_native_enum_namespaces(_shift_status_schema())
    set_messages_namespaces(schema_ns)
    field = {'prop_name': 'status', 'enum_namespace': 'ShiftStatus'}
    assert _enum_label(field, 'scheduled') == 'Scheduled'


def test_namespace_path_with_empty_ns_falls_to_raw_value():
    """A field with no enum_namespace declared never enters the namespace
    lookup at all — falls through to the Fields path / raw value, regardless
    of what _messages_ns currently holds. This is unrelated to fail-fast: the
    `if ns:` guard means an absent/falsy namespace is normal, not an error."""
    set_messages_namespaces({'ShiftStatus': {'scheduled': 'Scheduled'}})
    field = {'prop_name': 'status', 'enum_namespace': None}
    assert _enum_label(field, 'scheduled') == 'scheduled'


def test_label_same_empty_vs_schema_computed():
    """Idempotency invariant at the label level: the label _enum_label returns
    for a freshly schema-computed _messages_ns (run 1, no file) is identical
    to what it returns when re-fed that same computed dict (simulating run 2
    after _update_json wrote run 1's defaults verbatim, with no manual edits)."""
    schema_ns = _collect_native_enum_namespaces(_shift_status_schema())
    field = {'prop_name': 'status', 'enum_namespace': 'ShiftStatus'}

    set_messages_namespaces(schema_ns)
    label_run1 = _enum_label(field, 'approved')

    set_messages_namespaces({k: dict(v) for k, v in schema_ns.items()})
    label_run2 = _enum_label(field, 'approved')

    assert label_run1 == label_run2 == 'Approved'


def test_collect_native_enum_namespaces_produces_expected_labels():
    """Direct unit test of the collector generate.py now depends on for schema
    defaults: humanized labels keyed by camelCase enum member name."""
    ns = _collect_native_enum_namespaces(_shift_status_schema())
    assert ns == {
        'ShiftStatus': {
            'scheduled': 'Scheduled',
            'approved': 'Approved',
            'cancelled': 'Cancelled',
        },
    }


def test_enum_label_namespace_miss_raises_after_correction():
    """Post-(c): when _messages_ns has the namespace but the key is missing, raise ValueError.
    This pins the fail-fast behavior introduced by correction (c).
    Deviant injection: namespace section exists but with wrong key casing → key miss → fail-fast."""
    set_messages_fields({})
    set_messages_namespaces({'ShiftStatus': {'Scheduled': 'Scheduled'}})  # wrong key: 'Scheduled' not 'scheduled'
    field = {'enum_namespace': 'ShiftStatus', 'prop_name': 'shift_status'}
    with pytest.raises(ValueError, match="key 'scheduled' missing in namespace 'ShiftStatus'"):
        _enum_label(field, 'scheduled')


def test_reverse_enum_label_no_match_raises():
    """Post-(c): reverse lookup with no matching member raises ValueError."""
    field = {
        'prop_name': 'status',
        'enum_namespace': 'ShiftStatus',
        'enum_values': ['scheduled', 'approved'],
    }
    set_messages_namespaces({'ShiftStatus': {'scheduled': 'Scheduled', 'approved': 'Approved'}})
    with pytest.raises(ValueError, match="no enum member maps to label 'Cancelled'"):
        _reverse_enum_label(field, 'Cancelled')


def test_reverse_enum_label_collision_raises():
    """Post-(c): when two members map to the same label, reverse lookup raises ValueError."""
    # Inject a collision: both 'low' and 'Low' humanize to 'Low' under some labeling
    field = {
        'prop_name': 'status',
        'enum_namespace': None,
        'enum_values': ['low', 'Low'],  # hypothetical collision: both → 'Low'
    }
    set_messages_fields({'status_low': 'Low', 'status_Low': 'Low'})
    with pytest.raises(ValueError, match="ambiguous"):
        _reverse_enum_label(field, 'Low')


def test_file_wins_overlay_for_custom_translation():
    """Correction (1): _merge_file_wins_messages overlays messages/en.json's
    existing values on top of schema defaults — a consumer's custom
    translation ('On Schedule' instead of the schema-humanized 'Scheduled')
    wins, while any schema keys absent from the file still get filled in."""
    schema_fields = {'name': 'Name'}
    schema_ns = {'ShiftStatus': {'scheduled': 'Scheduled', 'approved': 'Approved'}}
    file_msgs = {
        'Fields': {'name': 'Name'},
        'ShiftStatus': {'scheduled': 'On Schedule'},  # consumer's custom translation
    }

    merged_fields, merged_ns = _merge_file_wins_messages(schema_fields, schema_ns, file_msgs)

    assert merged_ns['ShiftStatus']['scheduled'] == 'On Schedule'  # file wins
    assert merged_ns['ShiftStatus']['approved'] == 'Approved'      # schema default fills gap
    assert merged_fields == {'name': 'Name'}
