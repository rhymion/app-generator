"""app_setting.timezone is a native `Timezone` enum (Issue #921).

The enum member is a stable snake_case identifier; the IANA spelling lives only in the generated
lib/_timezone.ts (TIMEZONE_IANA_NAME); display names come from the `Timezone` namespace of
messages/*.json through the generic native-enum mechanism.

Run:
    cd code_generator && python3 -m pytest tests/test_timezone_enum.py -v
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

from build_user_schema import build_user_schema
from generate import generate
from helpers.timezones import DEFAULT_MEMBER, TIMEZONES, timezone_iana_names, timezone_members

REPO = Path(__file__).resolve().parents[2]
FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'mobile_entity_gate'
MIGRATION = REPO / 'scripts' / 'migrations' / '04_app_setting_timezone_enum.sql'
WIDGET_MIGRATION = REPO / 'scripts' / 'migrations' / '05_dashboard_widget_timezone.sql'


def _prisma_enum_members(schema_text: str, name: str) -> list[str]:
    body = re.search(rf'^enum {name} \{{\n(.*?)^\}}', schema_text, re.S | re.M).group(1)
    return [line.strip() for line in body.splitlines() if line.strip()]


def _node(script: str, *args: str) -> str:
    return subprocess.run(
        ['node', '-e', script, *args], check=True, capture_output=True, text=True, timeout=60,
    ).stdout


@pytest.fixture(scope='module')
def default_out(tmp_path_factory):
    out = tmp_path_factory.mktemp('timezone_default')
    (out / 'prisma').mkdir()
    shutil.copy(REPO / 'prisma' / 'schema.prisma', out / 'prisma' / 'schema.prisma')
    shutil.copytree(REPO / 'messages', out / 'messages')
    intermediate = out / 'generated_json_schema.yaml'
    build_user_schema(REPO / 'code_generator' / 'json_schema.yaml', REPO / 'prisma' / 'schema.prisma', intermediate)
    generate(str(intermediate), str(out))
    return out


@pytest.fixture(scope='module')
def mobile_out(tmp_path_factory):
    out = tmp_path_factory.mktemp('timezone_mobile')
    (out / 'prisma').mkdir()
    shutil.copy(FIXTURE / 'schema.prisma', out / 'prisma' / 'schema.prisma')
    intermediate = out / 'generated_json_schema.yaml'
    build_user_schema(FIXTURE / 'json_schema.yaml', FIXTURE / 'schema.prisma', intermediate)
    generate(str(intermediate), str(out))
    return out


# --- the list itself ---------------------------------------------------------------------------

def test_there_are_54_unique_snake_case_members():
    members = timezone_members()
    assert len(members) == 54
    assert len(set(members)) == 54
    for member in members:
        assert re.fullmatch(r'[a-z][a-z0-9_]*', member), member


def test_iana_names_are_unique_and_the_default_is_utc():
    iana = [name for _m, name, _o in TIMEZONES]
    assert len(set(iana)) == len(iana)
    assert DEFAULT_MEMBER == 'utc'
    assert timezone_iana_names()['utc'] == 'UTC'


def test_every_iana_name_is_accepted_by_intl_date_time_format():
    names = [name for _m, name, _o in TIMEZONES]
    script = (
        "const bad = JSON.parse(process.argv[1]).filter((tz) => {"
        "  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return false; } catch { return true; }"
        "}); console.log(JSON.stringify(bad));"
    )
    assert json.loads(_node(script, json.dumps(names))) == []


def test_declared_standard_offsets_match_the_real_zone_and_cover_every_offset():
    script = (
        "const out = {}; for (const tz of JSON.parse(process.argv[1])) {"
        "  const off = (d) => { const p = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'longOffset' })"
        "    .formatToParts(d).find((x) => x.type === 'timeZoneName').value.replace('GMT', '');"
        "    const v = p === '' ? '+00:00' : p; const [h, m] = v.slice(1).split(':').map(Number);"
        "    return (v[0] === '-' ? -1 : 1) * (h * 60 + m); };"
        "  out[tz] = Math.min(off(new Date('2026-01-15T12:00:00Z')), off(new Date('2026-07-15T12:00:00Z')));"
        "} console.log(JSON.stringify(out));"
    )
    measured = json.loads(_node(script, json.dumps([name for _m, name, _o in TIMEZONES])))

    def minutes(offset: str) -> int:
        sign = -1 if offset[0] == '-' else 1
        hours, mins = offset[1:].split(':')
        return sign * (int(hours) * 60 + int(mins))

    for _member, iana, offset in TIMEZONES:
        assert measured[iana] == minutes(offset), iana
    assert len({minutes(offset) for _m, _i, offset in TIMEZONES}) == 37


# --- the three declarations agree ----------------------------------------------------------------

def test_prisma_enum_json_schema_and_mapping_list_the_same_members_in_the_same_order():
    prisma = _prisma_enum_members((REPO / 'prisma' / 'schema.prisma').read_text(), 'Timezone')
    schema = yaml.safe_load((REPO / 'code_generator' / 'json_schema.yaml').read_text())
    declared = schema['definitions']['app_setting']['fields']['timezone']
    assert prisma == timezone_members()
    assert declared['enum'] == timezone_members()
    assert declared['default'] == DEFAULT_MEMBER


def test_the_app_setting_column_is_typed_as_the_enum_with_the_utc_default():
    prisma = (REPO / 'prisma' / 'schema.prisma').read_text()
    assert re.search(r'^\s+timezone\s+Timezone\s+@default\(utc\)', prisma, re.M)


# --- generated output ----------------------------------------------------------------------------

def test_lib_timezone_ts_maps_every_member_to_its_iana_name(default_out):
    code = (default_out / 'lib' / '_timezone.ts').read_text()
    for member, iana, _offset in TIMEZONES:
        assert f"  {member}: '{iana}'," in code
    assert "export const DEFAULT_TIMEZONE: Timezone = 'utc';" in code
    assert (REPO / 'lib' / '_timezone.ts').read_text() == code


def test_the_dictionary_gets_one_label_per_member_in_both_languages(default_out):
    for locale in ('en', 'ja'):
        labels = json.loads((default_out / 'messages' / f'{locale}.json').read_text())['Timezone']
        assert set(labels) == set(timezone_members())
        assert all(labels.values())
        # The dictionary holds display names only: no IANA spelling.
        assert not any('/' in label for label in labels.values())
    for locale in ('en', 'ja'):
        committed = json.loads((REPO / 'messages' / f'{locale}.json').read_text())['Timezone']
        assert set(committed) == set(timezone_members())


def test_the_upsert_form_renders_the_time_zone_select_not_a_text_field(default_out):
    form = (default_out / 'components' / 'app_setting' / 'FormUpsert.tsx').read_text()
    assert "import TimeZoneSelect from '@/components/_standard/TimeZoneSelect';" in form
    assert '<TimeZoneSelect' in form
    assert "label={tf('timezone')}" in form


def test_the_mobile_copy_is_byte_identical_to_the_web_file(mobile_out):
    assert (mobile_out / 'mobile' / 'lib' / '_timezone.ts').read_bytes() == (REPO / 'lib' / '_timezone.ts').read_bytes()


# --- the one-time data migration (statically; the SQL itself is run by scripts/check_timezone_migration.sh) ---

def test_migration_creates_the_enum_with_exactly_the_members():
    sql = MIGRATION.read_text()
    created = re.search(r'CREATE TYPE "Timezone" AS ENUM \((.*?)\);', sql, re.S).group(1)
    assert re.findall(r"'([a-z_0-9]+)'", created) == timezone_members()


def test_migration_maps_every_iana_name_to_its_member_and_records_coerced_rows():
    sql = MIGRATION.read_text()
    for member, iana, _offset in TIMEZONES:
        assert f"('{iana}', '{member}')" in sql
    assert '"_app_setting_timezone_coerced"' in sql


# --- dashboard_widget.timezone (Issue #911) -------------------------------------------------------

def test_the_dashboard_widget_column_is_typed_as_the_enum_with_the_utc_default():
    prisma = (REPO / 'prisma' / 'schema.prisma').read_text()
    model = re.search(r'^model dashboard_widget \{\n(.*?)^\}', prisma, re.S | re.M).group(1)
    assert re.search(r'^\s+timezone\s+Timezone\s+@default\(utc\)', model, re.M)


def test_the_dashboard_widget_schema_lists_the_same_members_as_the_enum():
    schema = yaml.safe_load((REPO / 'code_generator' / 'json_schema.yaml').read_text())
    prop = schema['definitions']['dashboard_widget']['fields']['timezone']
    assert prop['enum'] == timezone_members()
    assert prop['default'] == DEFAULT_MEMBER


def test_the_dashboard_widget_migration_adds_a_non_null_utc_default_column():
    sql = WIDGET_MIGRATION.read_text()
    assert re.search(r'ADD COLUMN IF NOT EXISTS "timezone" "Timezone" NOT NULL DEFAULT \'utc\'', sql)
    assert 'CREATE TYPE' not in sql


def test_the_dashboard_catalog_lists_the_audit_timestamps_as_date_time_fields(default_out):
    catalog = (default_out / 'lib' / 'dashboard' / 'catalog.ts').read_text()
    for entity in re.findall(r"^    name: '(\w+)',", catalog, re.M):
        block = catalog.split(f"    name: '{entity}',", 1)[1].split('\n  },', 1)[0]
        assert "name: 'created_at', label: 'Created At', kind: 'datetime', datetime_format: 'date-time'" in block
        assert "name: 'updated_at', label: 'Updated At', kind: 'datetime', datetime_format: 'date-time'" in block
        assert "name: 'id'" not in block
