"""
Mobile search screen (templates/mobile/app/(app)/search.tsx.jinja2).

Runs the real build_user_schema.py -> generate.py pipeline on tests/fixtures/mobile_entity_gate and checks that:

- a result opens the record's detail screen (`/entity/<type>/<id>`), the entity list when the entity has no
  detail screen, and nothing (a marked row) when the entity has no native screens
- every string of the screen comes from the translation messages, and those are bundled for every locale
- the match markers of a snippet are rendered, not shown raw

Run:
    cd code_generator && python3 -m pytest tests/test_mobile_search.py -v
"""
import json
from pathlib import Path
import shutil

import pytest
import yaml

from build_user_schema import build_user_schema
from generate import generate

FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'mobile_entity_gate'
REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope='module')
def out(tmp_path_factory):
    root = tmp_path_factory.mktemp('mobile_search')
    (root / 'prisma').mkdir()
    shutil.copy(FIXTURE / 'schema.prisma', root / 'prisma' / 'schema.prisma')
    shutil.copytree(REPO / 'messages', root / 'messages')
    intermediate = root / 'generated_json_schema.yaml'
    build_user_schema(FIXTURE / 'json_schema.yaml', FIXTURE / 'schema.prisma', intermediate)
    schema = yaml.safe_load(intermediate.read_text())
    schema.setdefault('x-generator', {})['search'] = {'default_scope': 'all'}
    intermediate.write_text(yaml.safe_dump(schema))
    generate(str(intermediate), str(root))
    return root


def _screen(out: Path) -> str:
    return (out / 'mobile' / 'app' / '(app)' / 'search.tsx').read_text()


def test_result_opens_detail_list_or_is_marked_unavailable(out):
    src = _screen(out)
    assert '`/entity/${item.entity_type}/${item.id}`' in src
    assert 'screens.View' in src
    assert 'disabled={!href}' in src
    assert "t('Search.notAvailable')" in src


def test_screen_text_comes_from_messages(out):
    src = _screen(out)
    for hard_coded in ("'Type at least 2 characters.'", "'Search failed", '>No results.<', 'placeholder="Search"'):
        assert hard_coded not in src
    for key in ('Search.minLength', 'Search.failed', 'Search.noResults', 'Search.notAvailable', 'Common.search'):
        assert key in src


def test_search_messages_are_written_and_bundled_for_every_locale(out):
    bundled = (out / 'mobile' / 'lib' / 'messages.ts').read_text()
    for locale_file in sorted((out / 'messages').glob('*.json')):
        data = json.loads(locale_file.read_text())
        assert set(data['Search']) == {'minLength', 'failed', 'noResults', 'notAvailable'}
    assert '"Search": {' in bundled
    assert '"notAvailable"' in bundled


def test_result_entity_labels_are_bundled(out):
    src = _screen(out)
    assert 'LABEL_KEYS' in src
    assert '"EntityLabel": {' in (out / 'mobile' / 'lib' / 'messages.ts').read_text()


def test_snippet_markers_are_not_shown_raw(out):
    assert '(<<<|>>>)' in _screen(out)
