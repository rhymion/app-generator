"""
Framework-neutral UI hooks the Web entity screens call (use_entity_form,
use_entity_capabilities, use_entity_approval_actions).

The hooks hold the screens' state, validation orchestration, permission-derived
show/hide decisions and approval wiring, so a client other than the Web one can
reuse them. Runs the real build_user_schema.py -> generate.py pipeline on small
fixtures and checks:

- each hook is generated exactly where the screen that calls it is
- no hook imports a Next.js, next-intl, DOM or UI-library module
- the Web screens call the hooks instead of carrying the logic inline

Run:
    cd code_generator && python3 -m pytest tests/test_shared_ui_hooks.py -v
"""
from pathlib import Path
import re
import shutil

import pytest
import yaml

from build_user_schema import build_user_schema
from generate import generate

FIXTURES = Path(__file__).resolve().parent / 'fixtures'

HOOK_FILES = ('use_entity_form.ts', 'use_entity_capabilities.ts', 'use_entity_approval_actions.ts')

# Anything platform-specific. The hooks may import react, @/lib/* and
# type-only helpers, nothing else.
FORBIDDEN_IMPORT = re.compile(
    r"""from\s+['"](next/|next-intl|@/i18n/|@mui/|@/components/|react-dom)""",
)


def _run_pipeline(fixture_dir: Path, tmp_path: Path) -> Path:
    prisma_dir = tmp_path / 'prisma'
    prisma_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(fixture_dir / 'schema.prisma', prisma_dir / 'schema.prisma')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(fixture_dir / 'json_schema.yaml', fixture_dir / 'schema.prisma', intermediate)
    generate(str(intermediate), str(tmp_path))
    return tmp_path


@pytest.fixture(scope='module')
def continue_out(tmp_path_factory):
    return _run_pipeline(FIXTURES / 'save_continue_gate', tmp_path_factory.mktemp('hooks_continue'))


@pytest.fixture(scope='module')
def approval_out(tmp_path_factory):
    """The approval-lockdown fixture with the shared ApprovalSection component
    declared on the view page of its x-approval entity."""
    fixture = tmp_path_factory.mktemp('hooks_approval_fixture')
    shutil.copytree(FIXTURES / 'approval_lockdown_gate', fixture, dirs_exist_ok=True)
    schema_path = fixture / 'json_schema.yaml'
    schema = yaml.safe_load(schema_path.read_text())
    root = schema.get('definitions') or schema.get('$defs') or schema
    root['approval_lockdown_gate_item']['x-custom-components'] = [
        {'name': 'ApprovalSection', 'path': '@/components/_standard/ApprovalSection', 'target': ['view']},
    ]
    schema_path.write_text(yaml.safe_dump(schema, sort_keys=False))
    return _run_pipeline(fixture, tmp_path_factory.mktemp('hooks_approval'))


def _lib(out: Path, entity: str, name: str) -> Path:
    return out / 'lib' / entity / name


def test_editable_entity_gets_form_and_capabilities_hooks(continue_out):
    assert _lib(continue_out, 'continue_plain', 'use_entity_form.ts').exists()
    assert _lib(continue_out, 'continue_plain', 'use_entity_capabilities.ts').exists()


def test_create_only_entity_has_no_edit_capability(continue_out):
    caps = _lib(continue_out, 'continue_create_only', 'use_entity_capabilities.ts').read_text()
    assert 'canEdit: false,' in caps
    assert 'canContinue: false,' in caps


def test_web_form_calls_the_hooks_instead_of_inlining_the_logic(continue_out):
    form = (continue_out / 'components' / 'continue_plain' / 'FormUpsert.tsx').read_text()
    assert "from '@/lib/continue_plain/use_entity_form'" in form
    assert 'useEntityForm({' in form
    assert 'useEntityCapabilities({' in form
    assert 'validate(getValidationError)' in form
    # The state and orchestration moved into the hook.
    assert 'useTransition' not in form
    assert 'startTransition' not in form
    assert 'const getErrorMessage' not in form
    assert 'setValidationError' not in form


def test_web_view_calls_the_capabilities_hook(continue_out):
    view = (continue_out / 'components' / 'continue_plain' / 'FormView.tsx').read_text()
    assert 'useEntityCapabilities(' in view
    assert 'permissions?.update' not in view


def test_form_hook_exposes_the_error_mapper_and_the_hook(continue_out):
    text = _lib(continue_out, 'continue_plain', 'use_entity_form.ts').read_text()
    assert 'export function getEntityFormErrorMessage(' in text
    assert 'export function useEntityForm(' in text
    assert 'save: (formData: FormData) => Promise<EntityFormSaveResult>;' in text


def test_approval_hook_follows_the_approval_section(approval_out):
    hook = _lib(approval_out, 'approval_lockdown_gate_item', 'use_entity_approval_actions.ts')
    assert hook.exists()
    text = hook.read_text()
    assert 'export const HAS_ON_WITHDRAWN = false;' in text
    assert 'export function useEntityApprovalActions(' in text
    view = (approval_out / 'components' / 'approval_lockdown_gate_item' / 'FormView.tsx').read_text()
    assert 'useEntityApprovalActions(' in view
    assert 'hasOnWithdrawn={approvalActions.hasOnWithdrawn}' in view
    # No inline literal is left in the view.
    assert 'hasOnWithdrawn={ ' not in view
    # Entities without ApprovalSection get neither the hook file nor a call to it.
    for view_path in (approval_out / 'components').glob('*/FormView.tsx'):
        entity = view_path.parent.name
        has_hook_file = _lib(approval_out, entity, 'use_entity_approval_actions.ts').exists()
        assert has_hook_file == ('useEntityApprovalActions(' in view_path.read_text()), entity


def test_plain_entity_has_no_approval_hook(continue_out):
    assert not list((continue_out / 'lib').glob('*/use_entity_approval_actions.ts'))


@pytest.mark.parametrize('out_fixture', ['continue_out', 'approval_out'])
def test_hooks_import_no_platform_module(out_fixture, request):
    out = request.getfixturevalue(out_fixture)
    checked = 0
    for name in HOOK_FILES:
        for path in (out / 'lib').glob(f'*/{name}'):
            checked += 1
            for line in path.read_text().splitlines():
                assert not FORBIDDEN_IMPORT.search(line), f'{path}: {line}'
    assert checked > 0


def test_approval_hook_binds_the_submit_action_when_the_entity_can_submit():
    from jinja2 import Environment, FileSystemLoader

    env = Environment(
        loader=FileSystemLoader(Path(__file__).resolve().parent.parent / 'templates'),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    template = env.get_template('use_entity_approval_actions.ts.jinja2')
    with_submit = template.render(parent='widget', submit_for_approval_needed=True, has_on_withdrawn=True)
    assert "import type { ActionFailure } from '@/lib/_errors';" in with_submit
    assert 'submit: (id: string) => Promise<ActionFailure | void>;' in with_submit
    assert 'onSubmitForApproval: () => submit(recordId),' in with_submit
    assert 'export const HAS_ON_WITHDRAWN = true;' in with_submit
    without_submit = template.render(parent='widget', submit_for_approval_needed=False, has_on_withdrawn=False)
    assert 'onSubmitForApproval' not in without_submit
    assert '@/lib/_errors' not in without_submit


def test_form_takes_setError_from_the_hook_only_when_its_fragments_use_it(continue_out):
    # No child grid or flatten section: nothing calls setError, so it is not
    # destructured (an unused binding is a lint warning).
    form = (continue_out / 'components' / 'continue_plain' / 'FormUpsert.tsx').read_text()
    assert 'setError' not in form

