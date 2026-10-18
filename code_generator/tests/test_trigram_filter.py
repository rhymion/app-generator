"""List panel search box and trigram indexes: `x-trigram-filter` and its link to cross-entity search.

An entity that is a cross-entity search target (x-generator.search.default_scope / x-generate.search)
gets a list search box over its search trigram columns by default, and shares their COALESCE `_v2`
GIN indexes. A column annotated `x-trigram-filter: true` under `fields:` adds itself (also on an entity
that is not a search target) and its own index; `false` removes it from the box. An entity that is not
a search target and declares nothing has no box and no index.
"""
import re
import shutil
from pathlib import Path

import pytest
from ruamel.yaml import YAML

from build_user_schema import build_intermediate_schema, build_user_schema
from convert_to_user_schema import convert_to_user_schema
from generate import generate
from helpers.schema_helpers import resolve_trigram_search_fields, trigram_filter_true_fields
from schema_deriver import parse_prisma_enums, parse_prisma_schema
from validate import SchemaValidationError, validate_schema

FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'mobile_entity_gate'
SEARCH_BLOCK = "x-generator:\n  search:\n    default_scope: all\n  mobile:\n    enabled: true\n"


def _generate(tmp_path: Path, schema_text: str) -> Path:
    (tmp_path / 'prisma').mkdir(parents=True)
    shutil.copy(FIXTURE / 'schema.prisma', tmp_path / 'prisma' / 'schema.prisma')
    user = tmp_path / 'json_schema.yaml'
    user.write_text(schema_text)
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(user, FIXTURE / 'schema.prisma', intermediate)
    generate(str(intermediate), str(tmp_path))
    return tmp_path


def _search_keys(out: Path, entity: str) -> list[str]:
    page = (out / 'app' / '[locale]' / entity / 'page.tsx').read_text()
    m = re.search(r'searchKeys: \[(.*?)\]', page)
    return re.findall(r"'([^']+)'", m.group(1))


def _v2_indexes(out: Path) -> set[str]:
    sql = (out / 'scripts' / 'create-gin-indexes.sql').read_text()
    return set(re.findall(r'"(idx_\w+_gin_trgm_v2)"', sql))


@pytest.fixture(scope='module')
def declared_only(tmp_path_factory):
    """default_scope opt_in (the default): only declared columns."""
    return _generate(tmp_path_factory.mktemp('trigram_declared'), (FIXTURE / 'json_schema.yaml').read_text())


@pytest.fixture(scope='module')
def linked(tmp_path_factory):
    """default_scope all: every entity is a search target; mobile_note's title is switched off."""
    text = (FIXTURE / 'json_schema.yaml').read_text()
    text = text.replace("x-generator:\n  mobile:\n    enabled: true\n", SEARCH_BLOCK, 1)
    text = text.replace("      title:\n        x-trigram-filter: true\n", "      title:\n        x-trigram-filter: false\n", 1)
    return _generate(tmp_path_factory.mktemp('trigram_linked'), text)


def test_declared_column_is_the_search_box_of_a_non_search_entity(declared_only):
    assert _search_keys(declared_only, 'mobile_note') == ['title']


def test_non_search_entity_declaring_nothing_has_no_search_box_and_no_index(declared_only):
    assert _search_keys(declared_only, 'mobile_group') == []
    assert _v2_indexes(declared_only) == {'idx_mobile_note_title_gin_trgm_v2'}


def test_search_target_gets_its_search_columns_as_search_box_by_default(linked):
    assert _search_keys(linked, 'mobile_group') == ['name']


def test_false_removes_a_search_column_from_the_box(linked):
    keys = _search_keys(linked, 'mobile_note')
    assert 'title' not in keys
    assert 'details' in keys


def test_search_box_shares_the_search_v2_index_and_adds_none(linked):
    indexes = _v2_indexes(linked)
    assert 'idx_mobile_group_name_gin_trgm_v2' in indexes
    # `false` removes the column from the box only: cross-entity search still reads it.
    assert 'idx_mobile_note_title_gin_trgm_v2' in indexes
    sql = (linked / 'scripts' / 'create-gin-indexes.sql').read_text()
    assert sql.count('"idx_mobile_group_name_gin_trgm_v2"') == 1


def test_index_provisioning_paths_agree(linked):
    sql = _v2_indexes(linked)
    ts = set(re.findall(r'"(idx_\w+_gin_trgm_v2)"', (linked / 'lib' / 'db-init.ts').read_text()))
    assert sql == ts
    assert (linked / 'instrumentation.ts').exists()


def test_resolve_adds_true_and_removes_false():
    props = {'a': {'x-trigram-filter': True}, 'b': {'x-trigram-filter': False}, 'c': {}}
    assert resolve_trigram_search_fields(props, ['b', 'c']) == ['c', 'a']
    assert resolve_trigram_search_fields(props, []) == ['a']
    assert trigram_filter_true_fields(props) == ['a']


def _schema(prop: dict) -> dict:
    return {'definitions': {'thing': {'properties': {'label': {'type': 'string', **prop}}}}}


def test_validate_accepts_boolean_on_a_text_column():
    validate_schema(_schema({'x-trigram-filter': True}))
    validate_schema(_schema({'x-trigram-filter': False}))


@pytest.mark.parametrize('bad', [{'x-trigram-filter': 'yes'}, {'x-trigram-filter': 1}])
def test_validate_rejects_a_non_boolean(bad):
    with pytest.raises(SchemaValidationError, match='x-trigram-filter must be a boolean'):
        validate_schema(_schema(bad))


@pytest.mark.parametrize('bad', [{'enum': ['a', 'b']}, {'format': 'date'}, {'x-relationship': {'target': 'x'}}])
def test_validate_rejects_true_on_a_non_text_column(bad):
    with pytest.raises(SchemaValidationError, match='requires a text column'):
        validate_schema(_schema({'x-trigram-filter': True, **bad}))


def test_fields_annotation_reaches_the_internal_schema_and_survives_reverse_conversion():
    prisma_path = FIXTURE / 'schema.prisma'
    yaml = YAML()
    user = yaml.load((FIXTURE / 'json_schema.yaml').read_text())
    prisma_models = parse_prisma_schema(prisma_path)
    intermediate = build_intermediate_schema(user, prisma_models, parse_prisma_enums(prisma_path))
    prop = intermediate['definitions']['__mobile_note']['properties']['title']
    assert prop['x-trigram-filter'] is True
    # Reverse conversion keeps the annotation under the entity's fields:.
    legacy = {'definitions': {
        'mobile_note': {'type': 'object', 'properties': {'title': {'type': 'string', 'x-trigram-filter': True}}},
        'mobile_note_detail': {'allOf': [{'$ref': '#/definitions/mobile_note'}, {'type': 'object'}]},
    }}
    back = convert_to_user_schema(legacy, prisma_models)
    assert back['definitions']['mobile_note']['fields']['title']['x-trigram-filter'] is True


def test_getter_falls_back_to_contains_beyond_the_id_limit(linked):
    getters = (linked / 'lib' / 'mobile_group' / 'getters.ts').read_text()
    assert 'TRIGRAM_ID_LIMIT' in getters
    assert "mode: 'insensitive'" in getters
    # the id lookup is one tagged query through the shared helper, never an inline raw call
    assert 'selectTrigramIds(' in getters
    assert '$queryRaw' not in getters
