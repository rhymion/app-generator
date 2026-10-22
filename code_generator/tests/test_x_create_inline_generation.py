"""
x-create-inline generated output (Issue #846).

Runs the real build_user_schema.py -> generate.py pipeline on a small fixture
(fixtures/create_inline_gate) and checks, by named examples, what is generated:

  inline_note.inline_topic_id   declares x-create-inline  -> inline_topic is a target
  inline_note.inline_category_id  plain foreign key        -> inline_category is not a target

- the declaring form gets the "Create new" control, the dialog and a permission check
- a declaring field that is rendered read-only gets none of it
- the dialog sits beside the form, never inside it (a submit event would bubble to it)
- the target gets the dialog, its server actions and the return-id mode of its save action
- everything else is generated exactly as before
- the return-id mode runs after the permission and validation checks, and only creates
"""
from pathlib import Path
import shutil

import pytest

from build_user_schema import build_user_schema
from generate import generate

FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'create_inline_gate'


@pytest.fixture(scope='module')
def out(tmp_path_factory) -> Path:
    tmp_path = tmp_path_factory.mktemp('create_inline')
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir()
    shutil.copy(FIXTURE / 'schema.prisma', prisma_dir / 'schema.prisma')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(FIXTURE / 'json_schema.yaml', FIXTURE / 'schema.prisma', intermediate)
    generate(str(intermediate), str(tmp_path))
    return tmp_path


def _form(out: Path, entity: str) -> str:
    return (out / 'components' / entity / 'FormUpsert.tsx').read_text()


def _actions(out: Path, entity: str) -> str:
    return (out / 'lib' / entity / 'actions.ts').read_text()


def _dialog(out: Path, entity: str) -> Path:
    return out / 'components' / entity / 'InlineCreateDialog.tsx'


def _server_actions(out: Path, entity: str) -> Path:
    return out / 'lib' / entity / 'inline_create.ts'


# --- the declaring form ---


def test_declaring_form_gets_the_create_control_and_the_dialog(out):
    form = _form(out, 'inline_note')
    assert "import InlineTopicInlineCreateDialog from '@/components/inline_topic/InlineCreateDialog';" in form
    assert "import { canInlineTopicBeCreatedInline } from '@/lib/inline_topic/inline_create';" in form
    assert 'onCreateNew={inlineTopicIdCanCreate ? () => setInlineTopicIdCreateOpen(true) : undefined}' in form
    assert '<InlineTopicInlineCreateDialog' in form


def test_create_control_waits_for_the_permission_check(out):
    form = _form(out, 'inline_note')
    assert 'const [inlineTopicIdCanCreate, setInlineTopicIdCanCreate] = useState(false);' in form
    assert 'canInlineTopicBeCreatedInline().then((ok) =>' in form


def test_created_record_is_selected_through_its_own_option(out):
    form = _form(out, 'inline_note')
    # Its label is read back through the field's own search action, which returns
    # includeIds verbatim, so a record outside the initial list still shows its label.
    assert "const rows = await inlineTopicIdSearchAction('', [id]);" in form
    assert 'setInlineTopicIdCreatedOption(rows.find((o) => o.id === id) ?? { id, label: id });' in form
    assert 'setInlineTopicId(id);' in form
    assert 'currentOption={inlineTopicIdCreatedOption && inlineTopicIdCreatedOption.id === inlineTopicId' in form


def test_created_notice_is_shown_once_a_record_was_created(out):
    form = _form(out, 'inline_note')
    assert "createdNotice={inlineTopicIdCreatedOption ? tc('createdInlineNotice', { entity: tf('inlineTopic') }) : null}" in form


def test_field_without_the_key_gets_no_create_control(out):
    form = _form(out, 'inline_note')
    # The control group: the category field is a plain foreign key to a non-target.
    assert form.count('onCreateNew=') == 1
    assert 'CategoryIdCreateOpen' not in form
    assert 'InlineCategoryInlineCreateDialog' not in form


def test_read_only_declaring_field_gets_no_control_state_or_dialog(out):
    # inline_locked declares the key on a foreign key that x-readonly-fields renders as a
    # read-only display, so there is no autocomplete to attach the control to.
    form = _form(out, 'inline_locked')
    assert 'readOnly' in form
    assert 'onCreateNew' not in form
    assert 'InlineTopicInlineCreateDialog' not in form
    assert 'CanCreate' not in form
    assert 'useEffect' not in form


def test_dialog_is_rendered_beside_the_form_not_inside_it(out):
    form = _form(out, 'inline_note')
    form_end = form.index('/>', form.index('<FormWithChildGrid'))
    assert form.index('<InlineTopicInlineCreateDialog') > form_end


# --- the target ---


def test_target_gets_the_dialog_and_its_server_actions(out):
    assert _dialog(out, 'inline_topic').exists()
    assert _server_actions(out, 'inline_topic').exists()
    dialog = _dialog(out, 'inline_topic').read_text()
    # The dialog shows the target's own generated form, with the options /new would load.
    assert "import FormUpsert from './FormUpsert';" in dialog
    assert 'getInlineTopicInlineCreateInit()' in dialog
    assert 'initialInlineCategorys={init.initialInlineCategorys}' in dialog
    assert 'searchInlineCategoryOptions={ searchInlineCategoryOptions }' in dialog
    assert '<InlineCreateProvider value={contextValue}>' in dialog


def test_target_server_actions_probe_the_same_check_as_the_new_page(out):
    text = _server_actions(out, 'inline_topic').read_text()
    assert text.startswith("'use server';")
    # The dialog shows the /new form, so the hint is the /new page's own access check; the
    # save action stays the authority on whether a record is created.
    probe = text[text.index('export async function canInlineTopicBeCreatedInline'):text.index('export async function getInlineTopicInlineCreateInit')]
    assert 'await getInlineTopicNewPageAccessCheck();' in probe
    assert 'return false;' in probe
    # The init action throws when the user may not open the form, like the /new page does.
    assert 'getInlineTopicNewPageAccessCheck()' in text
    # Permission-denied markers become plain booleans before crossing to the client.
    assert 'initialInlineCategorysPermissionDenied: Boolean(' in text


def test_non_targets_get_no_dialog_and_no_server_actions(out):
    for entity in ('inline_note', 'inline_category'):
        assert not _dialog(out, entity).exists(), entity
        assert not _server_actions(out, entity).exists(), entity


def test_target_form_follows_the_dialog_context(out):
    form = _form(out, 'inline_topic')
    assert "import { useInlineCreate } from '@/components/_standard/InlineCreate';" in form
    assert 'const inlineCreate = useInlineCreate();' in form
    # Asks the action for the id, reports it, and cancels without navigating.
    assert "formData.set('__return_id', '1');" in form
    assert 'inlineCreate ? (id) => inlineCreate.onCreated(id) : undefined' in form
    assert "'id' in result" in (out / 'lib' / 'inline_topic' / 'use_entity_form.ts').read_text()
    assert 'inlineCreate.onCancel();' in form
    # Not offered in a dialog: the dialog closes after the save.
    assert 'inDialog: Boolean(inlineCreate)' in form
    assert 'canContinue: !inDialog && (isEdit || Boolean(permissions?.update)),' in (
        out / 'lib' / 'inline_topic' / 'use_entity_capabilities.ts'
    ).read_text()
    assert 'inDialog={Boolean(inlineCreate)}' in form


def test_non_target_forms_are_generated_without_any_dialog_wiring(out):
    for entity in ('inline_note', 'inline_category', 'inline_locked'):
        form = _form(out, entity)
        assert 'useInlineCreate' not in form
        assert '__return_id' not in form
        assert 'inDialog' not in form


# --- the save action's return-id mode ---


def test_target_action_has_a_return_id_mode_that_only_creates(out):
    actions = _actions(out, 'inline_topic')
    assert "const _returnId = data.get('__return_id') === '1';" in actions
    # An update would already be written when the id is returned, so the mix is refused
    # before anything else runs.
    assert "if (_returnId && data.get('id')) {" in actions
    assert actions.index("data.get('__return_id')") < actions.index("requirePermission('inline_topic', 'create')")
    assert '_createdId = (await addInlineTopic(' in actions


def test_return_id_mode_returns_after_the_permission_and_validation_path(out):
    actions = _actions(out, 'inline_topic')
    body = actions[actions.index('export async function upsertInlineTopic'):]
    # Every failure returns an ActionFailure before this point: the permission check,
    # the form-data validation and the create call (which runs the service validation
    # and the organisation check) are all above it.
    ret = body.index('if (_returnId) {')
    assert body.index("requirePermission('inline_topic', 'create')") < ret
    assert body.index('_createdId = (await addInlineTopic(') < ret
    assert 'return { ok: true as const, id: _createdId as string };' in body
    # The normal path still redirects after it.
    assert body.index("redirect('/inline_topic');") > ret


def test_non_target_actions_have_no_return_id_mode(out):
    for entity in ('inline_note', 'inline_category'):
        actions = _actions(out, entity)
        assert '__return_id' not in actions
        assert '_returnId' not in actions
    # inline_note keeps the continue-editing capture, unchanged by this feature.
    assert '_createdId = (await addInlineNote(' in _actions(out, 'inline_note')
