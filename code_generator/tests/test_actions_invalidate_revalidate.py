"""
Regression test for cmd_491: `invalidate{Parent}`'s revalidatePath call in
actions.ts.jinja2 used the bare literal form (`revalidatePath('/{{ parent }}')`),
which does not match the actual route (`/[locale]/{{ parent }}`) and so never
invalidated anything — the same dead-invalidation bug fixed for
lib/approval_request/actions_core.ts in this same cmd. `invalidateAction` is
wired into ResponsiveListClient/DataGridClient and invoked via
`startTransition` while the user stays on the list page (no redirect), so it
needs the same locale-prefixed, 'page'-typed form the neighboring
`remove{Parent}` branch (line ~57) already uses.
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = REPO_ROOT / 'code_generator' / 'templates'


def _render(**context) -> str:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        trim_blocks=True, lstrip_blocks=True,
    )
    base = {
        'parent': 'widget',
        'parent_pascal': 'Widget',
        'parent_camel': 'widget',
        'model': 'widget',
        'can_create': False,
        'can_update': False,
        'can_delete': False,
        'can_list': False,
        'can_invalidate': True,
        'invalidate_module': '',
        'invalidate_handler': '',
        'comment_actions_code': '',
        'has_commentable': False,
        'should_filter_by_org': False,
        'service_imports': None,
    }
    base.update(context)
    return env.get_template('actions.ts.jinja2').render(**base)


def test_invalidate_action_revalidates_locale_prefixed_list_page():
    out = _render()
    assert "revalidatePath('/[locale]/widget', 'page');" in out


def test_invalidate_action_no_longer_emits_bare_path():
    out = _render()
    assert "revalidatePath('/widget');" not in out
