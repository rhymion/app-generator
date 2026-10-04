"""
Regression pin for a `comments` child (`x-outputType: comments`).

The list-child fixes for issues #801 and #805 changed the `list` branch of
`build_context()` (the child include) and of `build_entity_context()` (the
option props of a child with a nullable parent FK). A `comments` child shares
those code paths but must keep producing exactly what it produced before. The
default schema has no comments child, so the generated-output snapshot harness
cannot cover it; this test does.

How the golden was captured: `comment_child_context_golden.json` (next to this
file, under `fixtures/`) is the output of `snapshot()` below, run against the
tree of origin/develop c2a087fe (the commit this branch was cut from), NOT
against the branch. To recapture, check that commit out into a detached
worktree, copy this file into its `code_generator/tests/` and run

    python3 code_generator/tests/test_comment_child_context_golden.py --print

there. Do not regenerate it on the branch: it pins existing behaviour.

Three shapes of comments child are built: a plain one, one with a second FK to
the parent's model (the shape of #801), and one whose structural FK to the
parent is nullable (the shape of #805).
"""
import dataclasses
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'code_generator'))

from build_context import build_context  # noqa: E402
from context import build_entity_context  # noqa: E402
from generate_types import _extract_children  # noqa: E402

GOLDEN = Path(__file__).parent / 'fixtures' / 'comment_child_context_golden.json'

SHAPES = {
    'plain': {'second_fk': False, 'nullable': False},
    'rel_par': {'second_fk': True, 'nullable': False},
    'nullable': {'second_fk': False, 'nullable': True},
}

# build_context() keys that read the child include or the child's relations.
BUILD_CONTEXT_KEYS = (
    'include_props_detail', 'include_entries_detail', 'include_props_list',
    'search_include_props_list', 'snapshot_include_props', 'one_to_one_include',
    'child_nested_create', 'child_nested_update', 'child_params_for_update',
    'children_data',
)
ENTITY_CONTEXT_KEYS = ('all_option_targets', 'import_targets', 'children', 'one_to_one_rels')


def _fk(target, nullable=False):
    return {
        'type': ['string', 'null'] if nullable else 'string',
        'x-relationship': {'type': 'many-to-one', 'target': target},
    }


def _model(extra=None, required_extra=()):
    props = {'id': {'type': 'string'}, 'name': {'type': 'string'}}
    props.update(extra or {})
    return {'type': 'object', 'required': ['id', 'name', *required_extra], 'properties': props}


def _build_schema():
    definitions = {}
    for shape, opts in SHAPES.items():
        parent, note = f'cc_{shape}_par', f'cc_{shape}_note'
        link = f'{parent}_id'
        note_props = {link: _fk(parent, nullable=opts['nullable'])}
        note_required = [] if opts['nullable'] else [link]
        if opts['second_fk']:
            note_props['rel_par_id'] = _fk(parent)
            note_required.append('rel_par_id')
        definitions[note] = _model(note_props, note_required)
        definitions[parent] = _model({
            'notes': {'type': 'array', 'x-outputType': 'comments',
                      'items': {'$ref': f'#/definitions/{note}'}},
        })
        definitions[parent]['x-generate'] = {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': False, 'test': False}
    return {'definitions': definitions}


def snapshot():
    """The comments-child context the generator builds, as plain JSON data."""
    schema = _build_schema()
    out = {}
    for shape in SHAPES:
        parent = f'cc_{shape}_par'
        entity = {
            'parent': parent,
            'model': parent,
            'definition_key': parent,
            'children': _extract_children(schema['definitions'][parent], schema),
            'generate_config': {
                'list': True, 'view': True, 'new': True, 'edit': True,
                'delete': True, 'api': False, 'test': False, 'fields': None,
            },
        }
        ctx = build_context(entity, schema)
        entity_ctx = dataclasses.asdict(build_entity_context(entity, schema))
        out[shape] = {
            'build_context': {k: ctx[k] for k in BUILD_CONTEXT_KEYS},
            'entity_context': {k: entity_ctx[k] for k in ENTITY_CONTEXT_KEYS},
        }
    return json.dumps(out, indent=1, sort_keys=True,
                      default=lambda o: sorted(o) if isinstance(o, set) else repr(o))


def test_comments_child_context_matches_the_pre_change_golden():
    assert snapshot() == GOLDEN.read_text().rstrip('\n'), (
        'the comments-child context changed; it was pinned from origin/develop '
        'c2a087fe, before the list-child fixes')


def test_golden_covers_the_comments_include():
    """A golden that lost its comments include would pin nothing."""
    data = json.loads(GOLDEN.read_text())
    assert set(data) == set(SHAPES)
    for shape in SHAPES:
        detail = data[shape]['build_context']['include_props_detail']
        assert detail.startswith('notes: { include: { creator: { select:'), detail
        assert "orderBy: { created_at: 'asc' }" in detail


if __name__ == '__main__':
    if '--print' in sys.argv:
        print(snapshot())
