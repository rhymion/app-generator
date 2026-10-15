"""
`x-entity-select` options: which entities a Permission / Approval Flow name field offers, and how
each one is displayed (docs/knowledge/entity-select-options.md).

Runs the real build_user_schema.py -> generate.py pipeline on this repo's own schema and checks that:

- the option set is every generated entity plus the `audit_log` system table
- every option has an `EntityLabel` key in every locale file, and the stored value is the entity name
- the Web view, edit and list screens, and the mobile chips, show the dictionary word

Run:
    cd code_generator && python3 -m pytest tests/test_entity_select_options.py -v
"""
import json
from pathlib import Path
import shutil

import pytest
import yaml

from build_context import _get_entity_options
from build_user_schema import build_user_schema
from generate import generate

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope='module')
def out(tmp_path_factory):
    tmp_path = tmp_path_factory.mktemp('entity_select_options')
    (tmp_path / 'prisma').mkdir()
    shutil.copy(REPO / 'prisma' / 'schema.prisma', tmp_path / 'prisma' / 'schema.prisma')
    shutil.copytree(REPO / 'messages', tmp_path / 'messages')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(REPO / 'code_generator' / 'json_schema.yaml', REPO / 'prisma' / 'schema.prisma', intermediate)
    generate(str(intermediate), str(tmp_path))
    return tmp_path


@pytest.fixture(scope='module')
def schema(out):
    return yaml.safe_load((out / 'generated_json_schema.yaml').read_text())


def _values(schema):
    return [o['value'] for o in _get_entity_options(schema)]


def test_audit_log_is_offered_after_the_generated_entities(schema):
    values = _values(schema)
    # The system table `getModelPermissions` answers for by name, though it is not a schema definition.
    assert values[-1] == 'audit_log'
    assert 'audit_log' not in schema['definitions']


def test_entities_that_are_not_permission_or_approval_targets_are_not_offered(schema):
    values = _values(schema)
    # No generated pages, no permission or approval of their own: not offered.
    for name in ('approval_request', 'comment', 'attachment', 'dashboard_widget', 'reaction'):
        assert name not in values, name
    # Every core `x-generate` flag is false.
    for name in ('approvable', 'attachable', 'commentable', 'notification'):
        assert name not in values, name


def test_generated_entities_keep_their_order_and_come_first(schema):
    from generate_types import extract_entities
    generated = [e['parent'] for e in extract_entities(schema)]
    values = _values(schema)
    assert values[:len(generated)] == generated
    assert len(values) == len(set(values))


def test_an_option_is_the_entity_name_with_a_dictionary_key_and_an_english_fallback(schema):
    option = {o['value']: o for o in _get_entity_options(schema)}['audit_log']
    assert option == {'value': 'audit_log', 'label': 'Audit Log', 'key': 'auditLog'}


def test_every_option_has_an_entity_label_key_in_every_locale(out, schema):
    keys = {o['key'] for o in _get_entity_options(schema)}
    locale_files = sorted((out / 'messages').glob('*.json'))
    assert locale_files
    for path in locale_files:
        entity_labels = json.loads(path.read_text())['EntityLabel']
        assert keys <= set(entity_labels), (path.name, sorted(keys - set(entity_labels)))


def test_web_view_and_edit_show_the_dictionary_word_and_store_the_name(out):
    edit = (out / 'app/[locale]/permission/edit/[id]/page.tsx')
    form = (out / 'components/permission/FormUpsert.tsx').read_text()
    view = (out / 'components/permission/FormView.tsx').read_text()
    assert edit.exists()
    assert "{ value: 'audit_log', label: te('auditLog') }" in form
    assert "{ value: 'audit_log', label: te('auditLog') }" in view
    # The English title is no longer baked into the screens.
    assert "label: 'Audit Log'" not in form
    assert "label: 'Audit Log'" not in view


def test_web_list_shows_the_dictionary_word_for_an_entity_name_column(out):
    page = (out / 'app/[locale]/permission/page.tsx').read_text()
    assert "getTranslations('EntityLabel')" in page
    assert "'audit_log': nameLabelsT('auditLog')" in page
    assert 'nameLabels[item.name as string] ?? item.name' in page
    flow = (out / 'app/[locale]/approval_flow/page.tsx').read_text()
    assert 'entityNameLabels[item.entity_name as string] ?? item.entity_name' in flow
