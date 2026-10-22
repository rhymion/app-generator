"""
Durable, entity-free regression coverage for the list-page per-column-kind
GridColDef.type/valueOptions wiring and buildFilter clause-shape dispatch
(app-generator#756/#759, extended to `format: time`).

Why this file exists instead of a live schema entity: this repo's own
dogfood schema (`code_generator/json_schema.yaml`) must never declare a
test-only fixture entity of its own (see
`test_no_test_only_entities_in_own_schema.py`) -- a visible test-fixture
entity belongs in a consumer repo's own schema (e.g. app-template's
testbed), never in app-generator's own committed schema. The
generated-code-string-level assertions here (GridColDef `type`/`format`/
`valueOptions` substrings, and `_column_filter_kind`'s clause-shape
dispatch) don't need any live entity or database at all, so they cover the
per-type filter/sort wiring at the template level -- at the cost of not
exercising real-browser behavior (a browser-level IEEE-754 round-trip bug
class on decimal filter inputs is not re-creatable at this level; that
category of regression relies on one-off real-UI verification against an
existing consumer entity in a throwaway isolated worktree, per
`docs/knowledge/appendix/approval-flow.md`'s Naming note precedent, not a
permanent spec here).
"""
from pathlib import Path

from build_context import _column_filter_kind
from generators import page_list_context
from helpers.naming import to_pascal_case, to_camel_case
from jinja2 import Environment, FileSystemLoader


# ---------------------------------------------------------------------------
# _column_filter_kind: pure clause-shape dispatch (build_context.py)
# ---------------------------------------------------------------------------

class TestColumnFilterKind:
    def test_native_enum_kind(self):
        assert _column_filter_kind({'_prisma_native_enum_type': 'FooStatus'}) == 'enum'

    def test_decimal_kind(self):
        assert _column_filter_kind({'_prisma_decimal_type': True}) == 'decimal'

    def test_date_kind(self):
        assert _column_filter_kind({'format': 'date'}) == 'date'

    def test_date_time_kind(self):
        assert _column_filter_kind({'format': 'date-time'}) == 'date'

    def test_time_kind_reuses_date_clause_shape(self):
        """format: time (Prisma DateTime @db.Timetz) must dispatch through
        the exact same 'date' clause shape as date/date-time -- empirically
        verified via a direct query against a real @db.Timetz column that
        Postgres casts any timestamp-shaped comparison value to `timetz`
        before comparing, discarding its date part regardless of what date
        a full date+time picker attaches. No separate 'time' clause shape
        or date-part normalization is needed."""
        assert _column_filter_kind({'format': 'time'}) == 'date'

    def test_boolean_kind(self):
        assert _column_filter_kind({'type': 'boolean'}) == 'boolean'

    def test_number_kind(self):
        assert _column_filter_kind({'type': 'number'}) == 'number'
        assert _column_filter_kind({'type': 'integer'}) == 'number'

    def test_string_default_kind(self):
        assert _column_filter_kind({'type': 'string'}) == 'string'
        assert _column_filter_kind({}) == 'string'


# ---------------------------------------------------------------------------
# page_list_context: GridColDef type/format/valueOptions emission
# (generators.py's xdisplay_table loop)
# ---------------------------------------------------------------------------

def _minimal_ctx(xdisplay_table: list, props: dict) -> dict:
    full_props = {'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}, **props}
    return {
        'parent': 'widget',
        'parent_pascal': 'Widget',
        'parent_camel': 'widget',
        'model_def': {'properties': full_props},
        'gen_cfg': {},
        'xdisplay_table': xdisplay_table,
        'has_chart': False,
        'parent_rels_raw': [],
        'selector_oto_rels': [],
        'can_delete': False,
        'entity_custom_components': [],
        'bridge_child_ir': None,
        'bridge_parent_options': [],
    }


class TestGridColDefTypeWiring:
    def test_boolean_column_gets_boolean_type(self):
        ctx = _minimal_ctx(
            [{'is_enabled': {'width': 120}}],
            {'is_enabled': {'type': 'boolean'}},
        )
        result = page_list_context(ctx)
        assert "type: 'boolean'" in result['display_fields_code']

    def test_number_column_gets_number_type(self):
        ctx = _minimal_ctx(
            [{'priority': {'width': 100}}],
            {'priority': {'type': 'integer'}},
        )
        result = page_list_context(ctx)
        assert "type: 'number'" in result['display_fields_code']

    def test_date_column_gets_date_type(self):
        ctx = _minimal_ctx(
            [{'valid_from': {'width': 140}}],
            {'valid_from': {'type': 'string', 'format': 'date'}},
        )
        result = page_list_context(ctx)
        code = result['display_fields_code']
        assert "type: 'date'" in code
        assert "format: 'date'" in code

    def test_date_time_column_gets_datetime_type(self):
        ctx = _minimal_ctx(
            [{'started_at': {'width': 180}}],
            {'started_at': {'type': 'string', 'format': 'date-time'}},
        )
        result = page_list_context(ctx)
        code = result['display_fields_code']
        assert "type: 'dateTime'" in code
        assert "format: 'date-time'" in code

    def test_time_column_gets_datetime_type_and_time_format(self):
        """format: time has no dedicated MUI GridColDef type -- reuses
        'dateTime' (same established convention as the independent
        DataGrid-child context elsewhere in this generator), distinguished
        from a genuine date-time column only by its own `format: 'time'`
        attr (which lib/_format.ts's formatLabelValue and DataGridClient's
        DisplayFieldConfig already handled pre-existing, display-only)."""
        ctx = _minimal_ctx(
            [{'start_time': {'width': 150}}],
            {'start_time': {'type': 'string', 'format': 'time'}},
        )
        result = page_list_context(ctx)
        code = result['display_fields_code']
        assert "type: 'dateTime'" in code
        assert "format: 'time'" in code

    def test_relation_column_gets_no_type(self):
        """FK relation display columns are explicitly excluded from
        GridColDef.type wiring (app-generator#756's stated scope cut) --
        a relation's value space is the target table's rows, not a small
        fixed member set."""
        ctx = _minimal_ctx(
            [{'assignee': {'width': 200}}],
            {'assignee_id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}},
        )
        ctx['parent_rels_raw'] = [
            {'prop_name': 'assignee_id', 'label_field': 'name', 'target': 'user'},
        ]
        schema = {
            'definitions': {
                'user': {'properties': {'name': {'type': 'string'}}},
            }
        }
        result = page_list_context(ctx, schema)
        code = result['display_fields_code']
        assert "field: 'assignee'" in code
        assert "type:" not in code


# ---------------------------------------------------------------------------
# Template rendering smoke test: page_list.tsx.jinja2 with a time column
# ---------------------------------------------------------------------------

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


def test_page_list_template_renders_with_time_column():
    ctx = _minimal_ctx(
        [{'start_time': {'width': 150}}],
        {'start_time': {'type': 'string', 'format': 'time'}},
    )
    pl_ctx = {**ctx, **page_list_context(ctx)}
    rendered = _ENV.get_template('page_list.tsx.jinja2').render(**pl_ctx)
    assert rendered
    assert "type: 'dateTime'" in rendered
    assert "format: 'time'" in rendered
