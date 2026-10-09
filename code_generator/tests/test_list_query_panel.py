"""
The entity list's shared sort / filter / search panel (lib/_list_query.ts, ListQueryPanel).

Runs the real build_user_schema.py -> generate.py pipeline on tests/fixtures/mobile_entity_gate and checks that:

- every generated Web list page hands the list clients a `listQuery` spec built from the REST list's own
  allow-list (columns, kinds, enum members), with the search box on the list's title column
- the Web list clients mount the panel only when that spec is given, so a list without it is unchanged
- the Expo app gets the Web's list-query module byte for byte, and its list screen builds its request
  through that module instead of keeping a second copy of the logic

Run:
    cd code_generator && python3 -m pytest tests/test_list_query_panel.py -v
"""
import json
from pathlib import Path
import re
import shutil

import pytest

from build_user_schema import build_user_schema
from generate import generate
from generators import page_list_context

FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'mobile_entity_gate'
REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope='module')
def out(tmp_path_factory):
    tmp_path = tmp_path_factory.mktemp('list_query_panel')
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir(parents=True)
    shutil.copy(FIXTURE / 'schema.prisma', prisma_dir / 'schema.prisma')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(FIXTURE / 'json_schema.yaml', FIXTURE / 'schema.prisma', intermediate)
    generate(str(intermediate), str(tmp_path))
    return tmp_path


def _page(out: Path, entity: str) -> str:
    return (out / 'app' / '[locale]' / entity / 'page.tsx').read_text()


def _spec_literal(page: str) -> str:
    return re.search(r'listQuery=\{ (\{.*?\n        \}) \}', page, re.S).group(1)


def _keys(literal: str, name: str) -> list[str]:
    return json.loads(re.search(rf'{name}: (\[.*?\])', literal).group(1).replace("'", '"'))


def test_every_list_page_carries_a_spec_for_the_panel(out):
    for entity in ('mobile_note', 'mobile_log', 'mobile_group', 'mobile_task'):
        page = _page(out, entity)
        assert 'listQuery={ {' in page, entity
        assert "getTranslations('Fields')" in page, entity  # the labels


def test_spec_follows_the_rest_list_allow_list_and_kinds(out):
    literal = _spec_literal(_page(out, 'mobile_note'))
    sort_keys = _keys(literal, 'sortKeys')
    filter_keys = _keys(literal, 'filterKeys')
    # Every scalar column the REST list sorts on, including the audit dates; no record id.
    assert sort_keys == ['title', 'details', 'status', 'priority', 'amount', 'is_done', 'due_on', 'created_at', 'updated_at']
    # A date column is sort-only; the rest take a filter control.
    assert filter_keys == ['title', 'details', 'status', 'priority', 'amount', 'is_done']
    assert "key: 'status', label: tf.has('status') ? tf('status') : 'Status', kind: 'enum', options: ['open', 'closed']" in literal
    assert "kind: 'number' }" in literal and "kind: 'decimal' }" in literal and "kind: 'boolean' }" in literal
    assert 'id' not in sort_keys


def test_enum_members_show_their_translated_labels_when_the_list_has_them(out):
    literal = _spec_literal(_page(out, 'mobile_note'))
    assert 'optionLabels: statusLabels' in literal
    assert 'const statusLabels' in _page(out, 'mobile_note')


def test_search_box_matches_the_title_column(out):
    assert "searchKey: 'title'" in _spec_literal(_page(out, 'mobile_note'))
    assert "searchKey: 'message'" in _spec_literal(_page(out, 'mobile_log'))


def test_foreign_key_id_columns_are_left_out_of_the_panel(out):
    literal = _spec_literal(_page(out, 'mobile_task'))
    assert 'mobile_group_id' not in literal and 'creator_id' not in literal


def test_page_context_without_a_filterable_column_has_no_spec():
    ctx = {
        'parent': 'widget', 'parent_pascal': 'Widget', 'parent_camel': 'widget',
        'model_def': {'properties': {}}, 'gen_cfg': {}, 'xdisplay_table': None, 'has_chart': False,
        'parent_rels_raw': [], 'selector_oto_rels': [], 'can_delete': False,
        'sort_filter_fields': [], 'sort_filter_field_kinds': {}, 'sort_filter_relation_fields': [],
    }
    assert page_list_context(ctx)['list_query_code'] == ''


def test_relation_display_column_is_offered_as_text(out):
    ctx = {
        'parent': 'widget', 'parent_pascal': 'Widget', 'parent_camel': 'widget',
        'model_def': {'properties': {'name': {'type': 'string'}}}, 'gen_cfg': {},
        'xdisplay_table': [{'name': {'primary': True}}], 'has_chart': False,
        'parent_rels_raw': [{'prop_name': 'epic_id', 'label_field': 'title', 'target': 'epic'}],
        'selector_oto_rels': [], 'can_delete': False,
        'sort_filter_fields': ['name', 'epic_id', 'id'],
        'sort_filter_field_kinds': {'name': 'string', 'epic_id': 'string', 'id': 'string'},
        'sort_filter_relation_fields': [('epic', 'title')],
    }
    literal = page_list_context(ctx)['list_query_code']
    assert _keys(literal, 'sortKeys') == ['name', 'epic']
    assert _keys(literal, 'filterKeys') == ['name', 'epic']
    assert "searchKey: 'name'" in literal


def test_list_clients_mount_the_panel_only_with_a_spec():
    for name in ('DataGridClient', 'CardListClient'):
        src = (REPO / 'components' / '_standard' / f'{name}.tsx').read_text()
        assert 'listQuery?: ListQuerySpec' in src, name
        assert '<ListQueryPanel' in src and 'listQuery &&' in src, name
    responsive = (REPO / 'components' / '_standard' / 'ResponsiveListClient.tsx').read_text()
    assert responsive.count('listQuery={listQuery}') == 2  # the grid and the cards


def test_list_query_module_is_framework_free():
    src = (REPO / 'lib' / '_list_query.ts').read_text()
    assert not re.search(r"^import ", src, re.M), 'it is copied to mobile/ unchanged, so it imports nothing'


def test_expo_app_gets_the_web_module_unchanged(out):
    assert (out / 'mobile' / 'lib' / '_list_query.ts').read_text() == (REPO / 'lib' / '_list_query.ts').read_text()


def test_expo_list_builds_its_request_through_the_shared_module(out):
    lst = (out / 'mobile' / 'components' / 'mobile_note' / 'List.tsx').read_text()
    assert "from '@/lib/_list_query'" in lst
    for fn in ('toListQuery', 'cycleSort', 'setFilterValue', 'countActiveFilters', 'filterChoices'):
        assert fn in lst, fn
    # The native list keeps its own one-column sort.
    assert 'cycleSort(prev, key, false)' in lst
    http = (out / 'mobile' / 'lib' / 'entity-http.ts').read_text()
    assert "from './_list_query'" in http and 'export type SortItem' not in http
