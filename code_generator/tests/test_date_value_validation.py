"""
Date, date-time and time values are validated by one shared module (lib/_date_value.ts).

Runs the real build_user_schema.py -> generate.py pipeline on tests/fixtures/mobile_entity_gate and checks that:

- the Web form validation and the server-side write guard both check every date / date-time / time column
  with that module, so an unparseable value is a validation error (HTTP 400) instead of a Prisma failure (HTTP 500)
- the Expo app gets the module byte for byte and its date inputs use it, so mobile and Web agree on the value shape

Run:
    cd code_generator && python3 -m pytest tests/test_date_value_validation.py -v
"""
from pathlib import Path
import re
import shutil

import pytest

from build_user_schema import build_user_schema
from generate import generate

FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'mobile_entity_gate'
REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope='module')
def out(tmp_path_factory):
    tmp_path = tmp_path_factory.mktemp('date_value_validation')
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir(parents=True)
    shutil.copy(FIXTURE / 'schema.prisma', prisma_dir / 'schema.prisma')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(FIXTURE / 'json_schema.yaml', FIXTURE / 'schema.prisma', intermediate)
    generate(str(intermediate), str(tmp_path))
    return tmp_path


def test_date_value_module_is_framework_free():
    src = (REPO / 'lib' / '_date_value.ts').read_text()
    assert not re.search(r"^import ", src, re.M), 'it is copied to mobile/ unchanged, so it imports nothing'


def test_web_form_validation_checks_date_columns(out):
    src = (out / 'components' / 'mobile_note' / 'form_validation.ts').read_text()
    assert "from '@/lib/_date_value'" in src
    assert "{ key: 'due_on', label: 'Due On', format: 'date' }" in src
    assert 'isValidDateValue(field.format' in src


def test_server_guard_rejects_unparseable_dates_as_validation_errors(out):
    src = (out / 'lib' / 'mobile_note' / 'service_validation.ts').read_text()
    assert "from '@/lib/_date_value'" in src
    assert "{ key: 'due_on', label: 'Due On', format: 'date' }" in src
    loop = src.split('for (const field of DATE_FIELDS)')[1][:400]
    assert "isValidDateValue(field.format, data[field.key])" in loop
    assert "throw new AppError('VALIDATION'" in loop and "field.key, 'invalid'" in loop


def test_expo_app_gets_the_module_unchanged_and_uses_it(out):
    assert (out / 'mobile' / 'lib' / '_date_value.ts').read_text() == (REPO / 'lib' / '_date_value.ts').read_text()
    field_input = (out / 'mobile' / 'components' / 'native' / 'FieldInput.tsx').read_text()
    assert "from '@/lib/_date_value'" in field_input
    assert 'DateValueInput' in field_input
    form = (out / 'mobile' / 'components' / 'mobile_note' / 'form_validation.ts').read_text()
    assert "from '@/lib/_date_value'" in form
