"""
Regression tests for issue #540: embedded DataGrid column date/time display
format.

Background
----------
`column_def_context()` (generators.py, embedded DataGrid child column
codegen) previously rendered every `format: date` / `date-time` / `time`
scalar column with a fixed MUI `type: 'dateTime'` and a hand-rolled
`valueFormatter` (`dayjs(value).format('YYYY-MM-DD HH:mm')`) regardless of
the field's own `format`. A `format: date` column (date-only, e.g.
`expiry_date`) rendered with a time component it should never have shown,
and its MUI column `type` stayed `'dateTime'` (date-time range filter UI)
instead of `'date'` (date-only range filter UI).

Fix: the column now calls the shared `formatLabelValue(value, '{fmt}')`
helper (`lib/_format.ts`) already used by the independent list page's
`DataGridClient` -- one formatter, one place that knows date vs date-time vs
time display, instead of a second hand-rolled dayjs format string here. The
MUI column `type` is aligned to the field's own format: `'date'` when
`fmt == 'date'`, `'dateTime'` otherwise (there is no dedicated MUI
`GridColDef` type for `'time'`, so `time` columns keep `'dateTime'` --
unchanged from before this fix).

What must NOT change: `date-time` columns are declared unaffected by this
fix ("data-time列は従来どおり日時で描かれること") -- this file fixes that
boundary in place with its own tests, not just the `date` side, so a future
change to the `date` branch cannot silently widen and start affecting
`date-time` too.
"""
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'code_generator'))

from build_context import build_context  # noqa: E402
from generators import column_def_context  # noqa: E402


def _entity(model: str, children: list) -> dict:
    return {
        'parent': model,
        'model': model,
        'definition_key': model,
        'children': children,
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': False, 'test': False, 'fields': None,
        },
    }


def _child_entry(name: str, prop: str) -> dict:
    return {
        'name': name,
        'property_name': prop,
        'output_type': None,
        'file_type': None,
        'relationship': None,
    }


def _schema() -> dict:
    """`doc` embeds datagrid child `line`, which carries one column of each
    date-shaped `format`: `date`, `date-time`, `time`."""
    return {
        'definitions': {
            'doc': {
                'type': 'object',
                'required': ['id'],
                'properties': {'id': {'type': 'string'}},
            },
            'line': {
                'type': 'object',
                'required': ['id', 'doc_id'],
                'properties': {
                    'id': {'type': 'string'},
                    'doc_id': {'type': 'string'},
                    'expiry_date': {'type': ['string', 'null'], 'format': 'date'},
                    'received_at': {'type': ['string', 'null'], 'format': 'date-time'},
                    'pickup_time': {'type': ['string', 'null'], 'format': 'time'},
                },
            },
        },
    }


def _fn_code() -> str:
    entity = _entity('doc', children=[_child_entry('line', 'lines')])
    schema = _schema()
    built = build_context(entity, schema)
    ctx = column_def_context(built, schema)
    return ctx['column_children'][0]['fn_code']


def _column_block(fn_code: str, field: str) -> str:
    """Extract the single-column object literal for `field` out of the
    generated `fn_code` source (from `field: '{field}'` up to the closing
    `},` of that column entry)."""
    marker = f"field: '{field}',"
    start = fn_code.index(marker)
    end = fn_code.index('},', start) + len('},')
    return fn_code[fn_code.rindex('{', 0, start):end]


def test_date_format_column_type_is_date_not_datetime():
    """`format: date` (`expiry_date`) must render as MUI column
    `type: 'date'` (date-only range filter UI) -- the pre-fix shape was a
    fixed `type: 'dateTime'` for every date-shaped format."""
    block = _column_block(_fn_code(), 'expiry_date')
    assert "type: 'date'," in block, f"expiry_date column was: {block}"
    assert "type: 'dateTime'," not in block, f"expiry_date column was: {block}"


def test_date_format_column_uses_shared_format_label_value_date():
    """`expiry_date`'s valueFormatter must call the shared
    `formatLabelValue(value, 'date')` -- not a hand-rolled dayjs format
    string."""
    block = _column_block(_fn_code(), 'expiry_date')
    assert "formatLabelValue(value, 'date')" in block, f"expiry_date column was: {block}"
    assert 'dayjs(' not in block, f"expiry_date column was: {block}"


def test_date_format_column_never_shows_time_component():
    """The valueFormatter call itself must not carry a time-bearing dayjs
    format string like 'YYYY-MM-DD HH:mm' anywhere in the date column --
    this is the exact regression issue #540 reports: a date-only field
    rendering with a spurious time-of-day."""
    block = _column_block(_fn_code(), 'expiry_date')
    assert 'HH:mm' not in block, (
        f"date-only column must never format a time component: {block}"
    )


def test_datetime_format_column_type_unchanged():
    """`format: date-time` (`received_at`) must keep MUI column
    `type: 'dateTime'` -- behavior-preserving, unaffected by this fix."""
    block = _column_block(_fn_code(), 'received_at')
    assert "type: 'dateTime'," in block, f"received_at column was: {block}"


def test_datetime_format_column_uses_shared_format_label_value_datetime():
    """`received_at`'s valueFormatter must call
    `formatLabelValue(value, 'date-time')` -- same shared helper as the date
    column, just with the date-time format passed through, producing the
    same date+time display the old hand-rolled dayjs format string did."""
    block = _column_block(_fn_code(), 'received_at')
    assert "formatLabelValue(value, 'date-time')" in block, f"received_at column was: {block}"


def test_time_format_column_type_unchanged():
    """`format: time` (`pickup_time`) has no dedicated MUI GridColDef type --
    it must keep `type: 'dateTime'`, unchanged from before this fix."""
    block = _column_block(_fn_code(), 'pickup_time')
    assert "type: 'dateTime'," in block, f"pickup_time column was: {block}"
    assert "formatLabelValue(value, 'time')" in block, f"pickup_time column was: {block}"


def test_mui_col_type_splits_date_from_datetime_across_all_three_formats():
    """General invariant tying the three formats together: exactly one of
    the three date-shaped columns (`expiry_date`) gets MUI `type: 'date'`;
    the other two (`received_at`, `pickup_time`) both keep `type:
    'dateTime'`. Asserted from one shared `fn_code` string so a future
    change that flips the branch condition trips this even if the
    per-field tests above are edited independently."""
    fn_code = _fn_code()
    date_types = dict(re.findall(r"field: '(\w+)',\s*headerName:[^,]+,\s*width: \d+,\s*editable: \w+,\s*type: '(\w+)',", fn_code))
    assert date_types['expiry_date'] == 'date'
    assert date_types['received_at'] == 'dateTime'
    assert date_types['pickup_time'] == 'dateTime'
