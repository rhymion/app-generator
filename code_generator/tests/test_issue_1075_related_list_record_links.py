"""
Issue #1075: each row of a related list on a detail or edit screen links to the related record.

The link follows the single-FK reference field (AppFieldRelation): it is not hidden from a reader who
may not view the record (the target page answers 403), and a record without a page of its own gets no
link. Covered per relation kind on the Web screens (the list-child fixture: one-to-many with a required
or an optional FK, read-only and editable, many-to-many, a child with no page) and on the native
screens (the mobile fixture: many-to-one and many-to-many).

Run:
    cd code_generator && python3 -m pytest tests/test_issue_1075_related_list_record_links.py -v
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from build_user_schema import build_user_schema
from generate import generate
from generators import record_href_line, target_has_view_page

REPO_ROOT = Path(__file__).resolve().parents[2]
LIST_CHILD_FIXTURE = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'list_child_e2e_gate'
MOBILE_FIXTURE = REPO_ROOT / 'code_generator' / 'tests' / 'fixtures' / 'mobile_entity_gate'
COMPOSE = REPO_ROOT / 'scripts' / 'compose_child_datagrid_e2e_fixture.py'

ALL_FLAGS_OFF = {flag: False for flag in ('list', 'view', 'new', 'edit', 'delete', 'api')}


# --- which targets get a link ----------------------------------------------------------------

def _schema(**definitions) -> dict:
    return {'definitions': definitions}


@pytest.mark.parametrize('definitions, expected', [
    pytest.param({'t': {'x-generate': {'list': True}}}, True, id='page-generating entity'),
    pytest.param({'t': {'x-generate': {'view': True, 'list': False}}}, True, id='view page only'),
    pytest.param({'t': {}}, False, id='no x-generate: embedded child, no page of its own'),
    pytest.param({'t': {'x-generate': {'list': True, 'view': False}}}, False, id='view page switched off'),
    pytest.param({'t': {'x-generate': ALL_FLAGS_OFF}}, False, id='bridge internals: every core flag off'),
    pytest.param({'t': {'x-internal': True, 'x-generate': {'list': True}}}, False, id='x-internal entity'),
    pytest.param({'t': {}, '__t': {'x-generate': {'list': True}}}, True, id='x-generate on the raw twin'),
    pytest.param({'t': {}, '__t': {'x-internal': True, 'x-generate': {'list': True}}}, False, id='x-internal on the raw twin'),
])
def test_only_a_target_with_a_view_page_is_linked(definitions, expected):
    assert target_has_view_page('t', _schema(**definitions)) is expected


def test_unknown_target_is_not_linked():
    assert target_has_view_page('missing', _schema()) is False
    assert record_href_line('', _schema(), 'f', '  ') == ''


def test_href_line_points_at_the_view_page_of_the_row():
    schema = _schema(t={'x-generate': {'list': True}})
    assert record_href_line('t', schema, 'f', '    ') == '    href: `/t/view/${f.id}`,\n'
    assert record_href_line('t', schema, 'f', '    ', guard_id=True) == '    href: f.id ? `/t/view/${f.id}` : undefined,\n'
    assert record_href_line('t', None, 'f', '    ') == ''


# --- Web screens -------------------------------------------------------------------------------

@pytest.fixture(scope='module')
def web_out(tmp_path_factory):
    app = tmp_path_factory.mktemp('related_links_web')
    (app / 'code_generator').mkdir()
    (app / 'prisma').mkdir()
    for name in ('json_schema.yaml', 'json_schema_internal.yaml'):
        shutil.copy(REPO_ROOT / 'code_generator' / name, app / 'code_generator')
    shutil.copy(REPO_ROOT / 'prisma' / 'schema.prisma', app / 'prisma')
    done = subprocess.run([sys.executable, str(COMPOSE), str(LIST_CHILD_FIXTURE), str(app)], capture_output=True, text=True)
    assert done.returncode == 0, done.stderr
    intermediate = app / 'generated_json_schema.yaml'
    build_user_schema(app / 'code_generator' / 'json_schema.yaml', app / 'prisma' / 'schema.prisma', intermediate)
    generate(str(intermediate), str(app))
    return app


def _screen(web_out: Path, entity: str, screen: str) -> str:
    return (web_out / 'components' / entity / f'{screen}.tsx').read_text()


@pytest.mark.parametrize('parent, child', [
    pytest.param('lc_req_parent', 'lc_req_child', id='one-to-many, required FK (read-only list)'),
    pytest.param('lc_edit_parent', 'lc_edit_child', id='one-to-many, optional FK (editable list)'),
    pytest.param('lc_ro_parent', 'lc_ro_child', id='one-to-many, read-only parent list'),
    pytest.param('lc_m2m_parent', 'lc_m2m_child', id='many-to-many'),
])
@pytest.mark.parametrize('screen', ['FormView', 'FormUpsert'])
def test_a_related_list_row_links_to_its_record(web_out, parent, child, screen):
    assert f'href: `/{child}/view/${{f.id}}`' in _screen(web_out, parent, screen)


@pytest.mark.parametrize('parent, child', [
    pytest.param('lc_plain_parent', 'lc_plain_child', id='child without a page of its own'),
])
@pytest.mark.parametrize('screen', ['FormView', 'FormUpsert'])
def test_a_child_without_a_page_of_its_own_gets_no_link(web_out, parent, child, screen):
    source = _screen(web_out, parent, screen)
    assert 'href:' not in source
    assert f'/{child}/view/' not in source


def test_a_sibling_without_a_page_stays_unlinked_beside_a_linked_list(web_out):
    source = _screen(web_out, 'lc_edit_parent', 'FormUpsert')
    sibs = source[source.index('localInitialSibs'):]
    sibs = sibs[:sibs.index('})));')]
    assert 'href' not in sibs
    assert 'lc_edit_child/view' in source


def test_the_list_components_render_the_href_as_a_link():
    for name in ('ListWrapper', 'EditableListWrapper', 'OrderedEditableListWrapper'):
        source = (REPO_ROOT / 'components' / '_standard' / f'{name}.tsx').read_text()
        assert '<Link href=' in source and 'item.href' in source


# --- native screens ----------------------------------------------------------------------------

@pytest.fixture(scope='module')
def mobile_out(tmp_path_factory):
    out = tmp_path_factory.mktemp('related_links_mobile')
    (out / 'prisma').mkdir()
    shutil.copy(MOBILE_FIXTURE / 'schema.prisma', out / 'prisma' / 'schema.prisma')
    intermediate = out / 'generated_json_schema.yaml'
    build_user_schema(MOBILE_FIXTURE / 'json_schema.yaml', MOBILE_FIXTURE / 'schema.prisma', intermediate)
    generate(str(intermediate), str(out))
    return out


def _specs(mobile_out: Path) -> dict[str, list[dict]]:
    """Each native entity's FieldSpec list, read back from the generated client."""
    specs = {}
    for client in sorted((mobile_out / 'mobile' / 'lib').glob('*/mobile_client.ts')):
        match = re.search(r'FIELDS: FieldSpec\[\] = (\[.*?\n\]);', client.read_text(), re.S)
        if match:
            specs[client.parent.name] = json.loads(match.group(1))
    return specs


def test_a_relation_links_exactly_when_its_target_has_a_native_detail_screen(mobile_out):
    specs = _specs(mobile_out)
    viewable = {p.parent.name for p in (mobile_out / 'mobile' / 'components').glob('*/FormView.tsx')}
    kinds = set()
    for name, fields in specs.items():
        for field in fields:
            if field['kind'] not in ('relation', 'relation_many'):
                continue
            kinds.add(field['kind'])
            assert field.get('viewLink', False) is (field['target'] in viewable), (name, field['key'])
    assert kinds == {'relation', 'relation_many'}


def test_both_a_single_reference_and_a_many_to_many_list_are_linked(mobile_out):
    fields = {(n, f['key']): f for n, fs in _specs(mobile_out).items() for f in fs}
    assert any(f['kind'] == 'relation' and f.get('viewLink') for f in fields.values())
    assert any(f['kind'] == 'relation_many' and f.get('viewLink') for f in fields.values())


def test_the_detail_screen_opens_the_related_record_on_its_own_screen(mobile_out):
    view = (mobile_out / 'mobile' / 'components' / 'mobile_task' / 'FormView.tsx').read_text()
    assert 'router.push(`/entity/${target}/${relatedId}` as never)' in view
    assert 'RelationValue' in view
    field_input = (mobile_out / 'mobile' / 'components' / 'native' / 'FieldInput.tsx').read_text()
    assert 'onOpen(target, row.id)' in field_input
    assert 'if (!spec.viewLink' in field_input
