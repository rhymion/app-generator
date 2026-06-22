"""
Regression test: page_list.tsx.jinja2 enum entries rendering.

Before the fix, page_list_context() stored enum data as
  {'var_name': ..., 'ns': ..., 'entries': [(i, label), ...]}
but the template still referenced ns['keys'] (which no longer existed),
causing a Jinja2 UndefinedError at generation time.

After the fix the template uses ns['entries'] and emits
  const fooLabels: Record<number, string> = { 0: ..., 1: ..., };
so the TypeScript compiler can index by number.
"""
from pathlib import Path

import pytest
from jinja2 import Environment, FileSystemLoader

from generators import page_list_context
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


def _minimal_ctx(extra_props: dict | None = None) -> dict:
    props = {
        'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
    }
    if extra_props:
        props.update(extra_props)
    return {
        'parent': 'shift_template',
        'parent_pascal': 'ShiftTemplate',
        'parent_camel': 'shiftTemplate',
        'model_def': {'properties': props},
        'gen_cfg': {},
        'xdisplay_table': None,
        'has_chart': False,
        'parent_rels_raw': [],
        'selector_oto_rels': [],
        'can_delete': False,
        'entity_custom_components': [],
        'bridge_child_ir': None,
        'bridge_parent_options': [],
    }


def test_enum_ns_list_uses_entries_not_keys():
    """page_list_context produces 'entries' key, never 'keys'."""
    ctx = _minimal_ctx({
        'day_of_week': {
            'type': 'integer',
            'enum': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        },
    })
    result = page_list_context(ctx)
    ns_list = result['enum_ns_list']
    assert len(ns_list) == 1
    ns = ns_list[0]
    assert 'entries' in ns, "enum_ns_list entry must have 'entries' key"
    assert 'keys' not in ns, "stale 'keys' key must not be present"
    assert ns['entries'][0] == (0, 'day_of_week_Mon')
    assert ns['entries'][6] == (6, 'day_of_week_Sun')


def test_page_list_template_renders_without_exception():
    """Rendering page_list.tsx.jinja2 with an enum entity raises no exception."""
    ctx = _minimal_ctx({
        'day_of_week': {
            'type': 'integer',
            'enum': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        },
    })
    pl_ctx = {**ctx, **page_list_context(ctx)}
    rendered = _ENV.get_template('page_list.tsx.jinja2').render(**pl_ctx)
    assert rendered  # non-empty


def test_page_list_emits_record_number_string_type():
    """Generated object uses Record<number, string> so TS can index by number."""
    ctx = _minimal_ctx({
        'day_of_week': {
            'type': 'integer',
            'enum': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        },
    })
    pl_ctx = {**ctx, **page_list_context(ctx)}
    rendered = _ENV.get_template('page_list.tsx.jinja2').render(**pl_ctx)
    assert 'Record<number, string>' in rendered
    assert '0:' in rendered
    assert '6:' in rendered
