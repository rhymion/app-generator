"""
"Save and continue editing" button (Issue #832): a second submit control on the
generated form that saves and keeps the user on the record instead of going
back to the list.

Runs the real build_user_schema.py -> generate.py pipeline on small fixtures and
checks the generated action, form and edit page, so the visibility rules are
shown by named examples:

- shown for an entity with both a create and an update path
- hidden when `x-generate.edit: false` (no `/edit/[id]` route exists)
- shown on an edit-only entity (`x-generate.new: false`), where it only stays in place
- hidden for x-payment entities (a create ends at the Checkout page)
- hidden for approval-lockable entities (a save can lock the record)
- hidden for a user without update permission (decided from the permissions
  the page passes to the form)

Run:
    cd code_generator && python3 -m pytest tests/test_save_and_continue_editing.py -v
"""
from pathlib import Path
import shutil

from build_user_schema import build_user_schema
from build_context import build_context
from generate import generate
from generators import actions_context, approval_lockdown_context, can_save_and_continue, form_upsert_context
from test_approval_edit_delete_invalidate_lockdown import _entity as _lockdown_entity, _lockdown_schema

FIXTURES = Path(__file__).resolve().parent / 'fixtures'
CONTINUE_FIXTURE = FIXTURES / 'save_continue_gate'
PAYMENT_FIXTURE = FIXTURES / 'payment_gate'

CONTINUE_LABEL = "continueButtonLabel={canContinue ? tc('saveAndContinue') : undefined}"


def _run_pipeline(fixture_dir: Path, tmp_path: Path) -> Path:
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(fixture_dir / 'schema.prisma', prisma_dir / 'schema.prisma')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(fixture_dir / 'json_schema.yaml', fixture_dir / 'schema.prisma', intermediate)
    generate(str(intermediate), str(tmp_path))
    return tmp_path


def _lockdown_ctx(entity: dict, schema: dict) -> dict:
    ctx = build_context(entity, schema)
    return {**ctx, **approval_lockdown_context(ctx, schema)}


def _form(out: Path, entity: str) -> str:
    return (out / 'components' / entity / 'FormUpsert.tsx').read_text()


def _actions(out: Path, entity: str) -> str:
    return (out / 'lib' / entity / 'actions.ts').read_text()


def _edit_page(out: Path, entity: str) -> str:
    return (out / 'app' / '[locale]' / entity / 'edit' / '[id]' / 'page.tsx').read_text()


def test_save_continue_button_shown_with_create_and_update(tmp_path):
    out = _run_pipeline(CONTINUE_FIXTURE, tmp_path)
    form = _form(out, 'continue_plain')
    assert CONTINUE_LABEL in form
    # The button follows the update permission the page passes to the form: an
    # edit screen already required it, /new needs it explicitly.
    assert 'const canContinue = isEdit || Boolean(permissions?.update);' in form
    assert "formData.set('__continue', '1');" in form
    assert "submitter?.value === 'continue'" in form
    # The action lands on the new record after a create.
    actions = _actions(out, 'continue_plain')
    assert "const _continueEditing = data.get('__continue') === '1';" in actions
    assert '_createdId = (await addContinuePlain(' in actions
    assert '/continue_plain/edit/${_continueId}' in actions


def test_save_continue_button_hidden_when_edit_false(tmp_path):
    out = _run_pipeline(CONTINUE_FIXTURE, tmp_path)
    form = _form(out, 'continue_create_only')
    assert 'continueButtonLabel' not in form
    assert '__continue' not in form
    actions = _actions(out, 'continue_create_only')
    assert '__continue' not in actions
    assert '_createdId' not in actions
    # No `/edit/[id]` route exists for the entity to land on.
    assert not (out / 'app' / '[locale]' / 'continue_create_only' / 'edit').exists()


def test_save_continue_on_edit_only_entity_stays_on_the_record(tmp_path):
    out = _run_pipeline(CONTINUE_FIXTURE, tmp_path)
    assert CONTINUE_LABEL in _form(out, 'continue_edit_only')
    actions = _actions(out, 'continue_edit_only')
    assert "data.get('__continue') === '1'" in actions
    # No create path, so no new id to capture.
    assert '_createdId' not in actions
    assert 'const _continueId = id;' in actions


def test_save_continue_button_hidden_for_x_payment_entity(tmp_path):
    out = _run_pipeline(PAYMENT_FIXTURE, tmp_path)
    for entity in ('paid_widget', 'paid_gadget'):
        assert 'continueButtonLabel' not in _form(out, entity)
        actions = _actions(out, entity)
        assert '__continue' not in actions
        assert 'redirect(_checkoutUrl)' in actions
    # Control in the same run: an entity without x-payment keeps the button.
    assert CONTINUE_LABEL in _form(out, 'plain_widget')


def test_save_continue_button_hidden_for_approval_lockable_entity():
    # An entity with the approvable bridge and x-approval.submit_on gets the
    # edit guard: a save can submit the record for approval and lock it.
    schema = _lockdown_schema()
    ctx = _lockdown_ctx(_lockdown_entity('widget', 'widget'), schema)
    assert ctx['has_edit_guard'] is True
    assert can_save_and_continue(ctx) is False
    act = actions_context(ctx)
    assert act['can_continue'] is False
    assert '__continue' not in act['upsert_body']
    assert form_upsert_context(ctx, schema)['can_continue'] is False
    # Same entity without the approval declaration keeps the button.
    plain_ctx = {**ctx, 'has_edit_guard': False}
    assert can_save_and_continue(plain_ctx) is True


def test_save_continue_button_hidden_without_update_permission(tmp_path):
    out = _run_pipeline(CONTINUE_FIXTURE, tmp_path)
    form = _form(out, 'continue_plain')
    # On /new the form is given the user's general permissions; a user without
    # update gets canContinue === false, so no label is passed and the shared
    # form wrapper renders no second button.
    assert 'Boolean(permissions?.update)' in form
    assert 'continueButtonLabel={canContinue ?' in form


def test_upsert_continue_create_redirects_to_edit_with_new_id(tmp_path):
    out = _run_pipeline(CONTINUE_FIXTURE, tmp_path)
    actions = _actions(out, 'continue_plain')
    create = actions.index('_createdId = (await addContinuePlain(')
    redirect_to_edit = actions.index('/continue_plain/edit/${_continueId}')
    list_redirect = actions.index("redirect('/continue_plain');")
    # create first, then the continue redirect, then the default list redirect
    assert create < redirect_to_edit < list_redirect
    # A create has no stale-write snapshot to refresh: the edit URL carries no nonce.
    assert 'redirect(id ? `/continue_plain/edit/${_continueId}?saved=${Date.now()}` : `/continue_plain/edit/${_continueId}`);' in actions


def test_upsert_continue_edit_reloads_the_record_with_a_new_form_key(tmp_path):
    out = _run_pipeline(CONTINUE_FIXTURE, tmp_path)
    actions = _actions(out, 'continue_plain')
    assert '?saved=${Date.now()}' in actions
    page = _edit_page(out, 'continue_plain')
    # The `saved` value keys the form so its state (child grids included) is
    # rebuilt from the saved record; otherwise rows added in the grid keep
    # their temporary ids and the next save would create them again.
    assert 'searchParams: Promise<{ saved?: string | string[] }>' in page
    assert 'formKey={typeof saved ===' in page
    assert '<FormUpsert key={formKey}' in page


def test_upsert_failure_returns_before_the_continue_redirect(tmp_path):
    out = _run_pipeline(CONTINUE_FIXTURE, tmp_path)
    actions = _actions(out, 'continue_plain')
    body = actions[actions.index('export async function upsertContinuePlain'):]
    # Every failure path returns an ActionFailure before the redirect, so a
    # failed save keeps the form and its values whichever button was used.
    assert body.index('satisfies ActionFailure') < body.index('if (_continueEditing)')
    assert 'redirect(' not in body[:body.index('satisfies ActionFailure')]


def test_x_payment_entity_keeps_the_original_edit_page_and_form(tmp_path):
    out = _run_pipeline(PAYMENT_FIXTURE, tmp_path)
    page = _edit_page(out, 'paid_widget')
    assert 'searchParams' not in page and 'formKey' not in page
    assert 'canContinue' not in _form(out, 'paid_widget')
