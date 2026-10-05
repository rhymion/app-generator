"""
x-exclusive-parents: the generated test helper writes exactly one owner column
per row, in both populate<Entity>Data and populate<Entity>FullData.

The save-time validator rejects a row with zero owners or with two or more, and
the generated API spec sends the populated row back as a PUT body. The owner is
the column of the first declared parent that has a resolvable column.
Entities without the declaration render the same helper as before.
"""
import re
import sys
from pathlib import Path

import pytest
from jinja2 import Environment, FileSystemLoader

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from generators_test import api_spec_context, helper_context, spec_context  # noqa: E402
from helpers.naming import to_camel_case, to_pascal_case  # noqa: E402
from build_user_schema import build_intermediate_schema  # noqa: E402
from schema_deriver import parse_prisma_schema  # noqa: E402
from test_x_exclusive_parents import PRISMA, _schema, _user_schema  # noqa: E402,F401
from test_x_exclusive_parents import models  # noqa: E402,F401

CONFIG = {
    'list': True, 'view': True, 'new': True, 'edit': True,
    'delete': True, 'api': False, 'test': True, 'fields': None,
}


@pytest.fixture(scope='module')
def models_with_optional(tmp_path_factory):
    # An optional plain column makes the generator emit a populate...FullData function
    # of its own (without one, FullData is an alias of populate...Data).
    path = tmp_path_factory.mktemp('prisma_note') / 'schema.prisma'
    path.write_text(PRISMA.replace('  placed_alpha_id String\n', '  placed_alpha_id String\n  note String?\n', 1))
    return parse_prisma_schema(path)


def _schema_with_note(models, exclusive=('alpha', 'beta')) -> dict:
    user = _user_schema(exclusive)
    user['definitions']['placement']['fields']['note'] = {}
    return build_intermediate_schema(user, models)


def _render(schema: dict, entity: str = 'placement') -> str:
    env = Environment(
        loader=FileSystemLoader(str(Path(__file__).resolve().parents[1] / 'templates')),
        trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True,
    )
    env.filters['pascal_case'] = to_pascal_case
    env.filters['camel_case'] = to_camel_case
    ctx = helper_context(entity, [], schema, entity, entity, CONFIG)
    return env.get_template('test_helper.ts.jinja2').render(**ctx)


def _function_body(text: str, name: str) -> str:
    start = text.index(f'export async function {name}(')
    rest = text[start + 1:]
    nxt = re.search(r'\nexport (async )?(function|const) ', rest)
    return text[start:start + 1 + (nxt.start() if nxt else len(rest))]


def _create_data(body: str) -> str:
    start = body.index('prisma.placement.create(')
    return body[start:body.index('records.push', start)]


def test_row_writes_only_the_first_declared_parents_owner(models):
    data = _create_data(_function_body(_render(_schema(models)), 'populatePlacementData'))
    assert re.search(r'\balpha_id:', data), data
    assert not re.search(r'\bbeta_id:', data), data


def test_declaration_order_picks_the_owner(models):
    data = _create_data(_function_body(_render(_schema(models, ('beta', 'alpha'))), 'populatePlacementData'))
    assert re.search(r'\bbeta_id:', data), data
    assert not re.search(r'\balpha_id:', data), data


def test_full_data_writes_only_the_owner_too(models_with_optional):
    text = _render(_schema_with_note(models_with_optional))
    data = _create_data(_function_body(text, 'populatePlacementFullData'))
    assert re.search(r'\balpha_id:', data) and not re.search(r'\bbeta_id:', data), data
    assert re.search(r'\bnote:', data), data


def test_full_data_declaration_order_picks_the_owner(models_with_optional):
    text = _render(_schema_with_note(models_with_optional, ('beta', 'alpha')))
    data = _create_data(_function_body(text, 'populatePlacementFullData'))
    assert re.search(r'\bbeta_id:', data) and not re.search(r'\balpha_id:', data), data


def test_full_data_without_the_key_writes_every_owner(models_with_optional):
    text = _render(_schema_with_note(models_with_optional, None))
    data = _create_data(_function_body(text, 'populatePlacementFullData'))
    assert re.search(r'\balpha_id:', data) and re.search(r'\bbeta_id:', data), data


def test_the_non_owner_required_fk_is_still_written(models):
    data = _create_data(_function_body(_render(_schema(models)), 'populatePlacementData'))
    assert re.search(r'\bplaced_alpha_id:', data), data


def test_dependencies_still_cover_both_owner_parents(models):
    body = _function_body(_render(_schema(models)), 'populatePlacementDependencies')
    assert 'prisma.alpha' in body and 'prisma.beta' in body


def test_owner_id_comes_from_the_dependency_row(models):
    data = _create_data(_function_body(_render(_schema(models)), 'populatePlacementData'))
    assert re.search(r'\balpha_id: deps\.\w+\.id', data), data


def test_entity_without_the_key_writes_the_same_helper_as_before(models):
    without = _render(_schema(models, exclusive=None))
    data = _create_data(_function_body(without, 'populatePlacementData'))
    assert not re.search(r'\balpha_id:', data) and not re.search(r'\bbeta_id:', data), data


# --- API and UI specs ------------------------------------------------------

def _has(text: str, column: str) -> bool:
    # `alpha_id` must not match `placed_alpha_id`
    return re.search(rf'(?<![\w]){column}\b', text) is not None


def _label(text: str, label: str) -> bool:
    return f"selectAutocomplete('{label}'" in text


def _api_ctx(schema):
    return api_spec_context('placement', [], schema, 'placement', 'placement', CONFIG)


def _ui_ctx(schema):
    return spec_context('placement', [], schema, 'placement', 'placement', CONFIG)


def test_api_create_body_carries_exactly_the_first_declared_owner(models):
    body = '\n'.join(_api_ctx(_schema(models))['post_body_create'])
    assert _has(body, 'alpha_id') and not _has(body, 'beta_id'), body


def test_api_create_body_follows_declaration_order(models):
    body = '\n'.join(_api_ctx(_schema(models, ('beta', 'alpha')))['post_body_create'])
    assert _has(body, 'beta_id') and not _has(body, 'alpha_id'), body


def test_api_create_body_without_the_key_has_no_owner(models):
    body = '\n'.join(_api_ctx(_schema(models, None))['post_body_create'])
    assert not _has(body, 'alpha_id') and not _has(body, 'beta_id'), body


def test_ui_create_selects_the_owner_and_never_the_other(models_with_optional):
    ctx = _ui_ctx(_schema_with_note(models_with_optional))
    for key in ('required_fill_cmds', 'all_fill_cmds'):
        cmds = '\n'.join(ctx[key])
        assert _label(cmds, 'Alpha'), (key, cmds)
        assert not _label(cmds, 'Beta'), (key, cmds)


def test_ui_create_without_the_key_selects_neither_owner(models_with_optional):
    ctx = _ui_ctx(_schema_with_note(models_with_optional, None))
    assert not _label('\n'.join(ctx['required_fill_cmds']), 'Alpha')
    assert _label('\n'.join(ctx['all_fill_cmds']), 'Alpha')
    assert _label('\n'.join(ctx['all_fill_cmds']), 'Beta')
