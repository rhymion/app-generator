"""form_validation.ts must compile for an entity with no required form field."""
import os

from jinja2 import Environment, FileSystemLoader


def test_required_fields_has_explicit_element_type_when_empty():
    template_dir = os.path.join(os.path.dirname(__file__), '..', 'templates')
    env = Environment(loader=FileSystemLoader(template_dir), trim_blocks=True, lstrip_blocks=True)
    out = env.get_template('form_validation.ts.jinja2').render(
        client_required_fields=[], client_decimal_fields=[], client_date_value_fields=[],
    )
    assert 'const REQUIRED_FIELDS: { key: string; label: string }[] = [' in out
    assert '] as const;' not in out
