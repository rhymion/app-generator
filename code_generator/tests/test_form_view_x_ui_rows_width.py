"""
x-ui.rows / x-ui.width on the detail (view) page.

FormUpsert already honours both hints: `rows` makes a string input a
multi-line textarea (description and x-mention fields default to 4 rows),
`width` wraps the field in <AppFormFieldWrapper cols={N}>. FormView rendered
every field as a full-width single-line read-only input, so a long note
entered in a 6-row textarea collapsed into one line on the detail page and
half-width fields jumped to full width. These tests pin that the view page
now applies the same treatment (and that read-only fields on the edit page,
rendered by the same shared renderer, get it too).

Run:
    cd code_generator && python3 -m pytest tests/test_form_view_x_ui_rows_width.py -v
"""
import re
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from build_context import build_context
from generators import form_upsert_context, form_view_context

_ID = {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}
_GEN = {
    'list': True, 'view': True, 'new': True, 'edit': True,
    'delete': True, 'api': True, 'test': True,
}


def _schema(with_width: bool = True, readonly_notes: bool = False) -> dict:
    props = {
        'id': _ID,
        'name': {'type': 'string', 'minLength': 1},
        'notes': {'type': ['string', 'null'], 'x-ui': {'rows': 6}},
        'description': {'type': ['string', 'null']},
        'short_title': {'type': ['string', 'null']},
        'amount': {'type': ['integer', 'null']},
    }
    if with_width:
        props['short_title']['x-ui'] = {'width': 6}
        props['amount']['x-ui'] = {'width': 4}
        props['notes']['x-ui'] = {'rows': 6, 'width': 8}
    raw: dict = {'type': 'object', 'required': ['id', 'name'], 'properties': props}
    view: dict = {'x-generate': _GEN, 'allOf': [{'$ref': '#/definitions/__memo'}]}
    if readonly_notes:
        # x-readonly-fields is read from the view entity (build_context.py).
        view['x-readonly-fields'] = ['notes']
    return {'definitions': {'__memo': raw, 'memo': view}}


def _entity() -> dict:
    return {
        'parent': 'memo', 'model': 'memo', 'definition_key': 'memo', 'children': [],
        'generate_config': {**_GEN, 'fields': None},
    }


def _env() -> Environment:
    return Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True, lstrip_blocks=True,
    )


def _render(template: str, ctx_fn, schema: dict) -> str:
    ctx = build_context(_entity(), schema)
    full = {**ctx, **ctx_fn(ctx, schema)}
    return _env().get_template(template).render(**full)


def _field_block(rendered: str, src_field: str) -> str:
    """The <AppFieldText ...> element whose value reads src.<field>."""
    m = re.search(r'<AppFieldText\n(?:(?!/>).)*?src\.' + src_field + r'\b(?:(?!/>).)*?/>', rendered, re.S)
    assert m, f'no AppFieldText for {src_field}'
    return m.group(0)


def test_view_applies_explicit_rows():
    out = _render('form_view.tsx.jinja2', form_view_context, _schema())
    block = _field_block(out, 'notes')
    assert 'multiline' in block and 'rows={6}' in block and 'readOnly' in block


def test_view_description_defaults_to_four_rows_like_upsert():
    out = _render('form_view.tsx.jinja2', form_view_context, _schema())
    assert 'rows={4}' in _field_block(out, 'description')


def test_view_plain_string_and_number_stay_single_line():
    out = _render('form_view.tsx.jinja2', form_view_context, _schema())
    assert 'multiline' not in _field_block(out, 'name')
    assert 'multiline' not in _field_block(out, 'amount')


def test_view_wraps_width_fields_and_imports_wrapper():
    out = _render('form_view.tsx.jinja2', form_view_context, _schema())
    assert "import { AppFormFieldWrapper } from '@/components/ui';" in out
    assert re.search(r'<AppFormFieldWrapper cols=\{6\}>\s*<AppFieldText\n\s*label=\{tf\(\'shortTitle\'\)\}', out)
    assert re.search(r'<AppFormFieldWrapper cols=\{8\}>\s*<AppFieldText\n\s*label=\{tf\(\'notes\'\)\}', out)
    assert re.search(r'<AppFormFieldWrapper cols=\{4\}>\s*<AppFieldText\n\s*label=\{tf\(\'amount\'\)\}', out)
    assert out.count('<AppFormFieldWrapper') == 3


def test_view_without_width_has_no_wrapper_import():
    out = _render('form_view.tsx.jinja2', form_view_context, _schema(with_width=False))
    assert 'AppFormFieldWrapper' not in out


def test_upsert_readonly_field_gets_rows_and_width():
    out = _render('form_upsert.tsx.jinja2', form_upsert_context, _schema(readonly_notes=True))
    block = _field_block(out, 'notes')
    assert 'multiline' in block and 'rows={6}' in block and 'readOnly' in block
    assert re.search(r'\{isEdit && \(\n\s*<AppFormFieldWrapper cols=\{8\}>\s*<AppFieldText', out)
    assert "import { AppFormFieldWrapper } from '@/components/ui';" in out
