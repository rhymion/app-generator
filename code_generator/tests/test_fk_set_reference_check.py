"""
Regression test (Issue #1324): every reference a parent write carries is checked
for reachability (lib/_fk_reference.ts), not only the parent's own foreign keys.

- A to-many set chosen on the parent (a many-to-many set, or a one-to-many list
  attached through the child's nullable foreign key): an added member must be
  reachable (else NOT_FOUND), a removed member must be reachable (else
  PERMISSION_DENIED), a member kept unchanged is not checked again.
- An inline child row dropped by a parent update: its stored references must be
  reachable, as for a cleared reference.
- Deleting the parent: the set members and the inline rows' references count, as
  the parent's own foreign keys do (assertDeleteReferencesReachable<Entity>).
- The security matrix's `fk_shape` axis gets the `many_to_many` / `one_to_many`
  shapes from the same checks.

Run:
    cd code_generator && python3 -m pytest tests/test_fk_set_reference_check.py -v
"""
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

import generate
from build_context import build_context
from generators import service_context

_GEN = {'list': True, 'view': True, 'new': True, 'edit': True, 'delete': True, 'api': True, 'test': True}
_ID = {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}
_NULLABLE_ID = {'type': ['string', 'null'], 'pattern': '^c[a-z0-9]{24,}$'}


def _fk(target: str, base: dict = _ID) -> dict:
    return {**base, 'x-relationship': {'type': 'many-to-one', 'target': target, 'labelField': 'name'}}


def _entity(name: str, props: dict, required: list[str], gen: dict | None = None) -> dict:
    return {
        f'__{name}': {
            'type': 'object', 'required': ['id', 'name', *required],
            'properties': {'id': _ID, 'name': {'type': 'string', 'minLength': 1}, **props},
        },
        name: {'x-generate': dict(gen or _GEN), 'allOf': [{'$ref': f'#/definitions/__{name}'}]},
    }


def _schema(member_scoped: bool = True) -> dict:
    """widget holds: a many-to-many set of tag, a one-to-many list of note (nullable
    widget_id), and inline part rows with a nullable gadget_id."""
    org = {'organization_id': _fk('organization')} if member_scoped else {}
    defs: dict = {}
    defs.update(_entity('organization', {}, []))
    defs.update(_entity('gadget', {'organization_id': _fk('organization')}, ['organization_id']))
    defs.update(_entity('tag', dict(org), list(org)))
    defs.update(_entity('note', {**org, 'widget_id': _fk('widget', _NULLABLE_ID)}, list(org)))
    defs.update(_entity('widget', {
        'organization_id': _fk('organization'),
        'tags': {'type': 'array', 'x-outputType': 'list', 'items': {'$ref': '#/definitions/tag'}},
        'notes': {'type': 'array', 'x-outputType': 'list', 'items': {'$ref': '#/definitions/note'}},
        'parts': {'type': 'array', 'items': {'$ref': '#/definitions/part'}},
    }, ['organization_id']))
    defs['part'] = {
        'type': 'object', 'required': ['id', 'name', 'widget_id'],
        'x-generate': {**_GEN, 'new': False, 'edit': False, 'delete': False, 'api': False, 'test': False},
        'properties': {
            'id': _ID, 'name': {'type': 'string', 'minLength': 1},
            'widget_id': _fk('widget'),
            'gadget_id': _fk('gadget', _NULLABLE_ID),
        },
    }
    return {'definitions': defs}


_CHILDREN = [
    {'name': 'tag', 'property_name': 'tags', 'output_type': 'list', 'file_type': None,
     'relationship': {'type': 'many-to-many', 'target': 'tag'}},
    {'name': 'note', 'property_name': 'notes', 'output_type': 'list', 'file_type': None, 'relationship': None},
    {'name': 'part', 'property_name': 'parts', 'output_type': None, 'file_type': None, 'relationship': None},
]


def _render(schema: dict, gen: dict | None = None) -> tuple[str, dict]:
    entity = {
        'parent': 'widget', 'model': 'widget', 'definition_key': 'widget', 'children': [dict(c) for c in _CHILDREN],
        'generate_config': {**_GEN, **(gen or {}), 'fields': None},
    }
    ctx = build_context(entity, schema)
    svc_ctx = {**ctx, **service_context(ctx, schema)}
    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True, lstrip_blocks=True,
    )
    return env.get_template('service.ts.jinja2').render(**svc_ctx), svc_ctx


def _body(rendered: str, fn: str) -> str:
    start = rendered.index(f'export async function {fn}')
    end = rendered.find('export async function', start + 1)
    return rendered[start:] if end == -1 else rendered[start:end]


def test_both_to_many_sets_are_listed_with_their_kind():
    _, ctx = _render(_schema())
    assert [(s['prop'], s['target'], s['kind']) for s in ctx['set_fk_checks']] == [
        ('tags', 'tag', 'many_to_many'), ('notes', 'note', 'one_to_many')]
    assert ctx['delete_reference_check'] is True


def test_add_checks_every_member_before_the_write():
    rendered, _ = _render(_schema())
    add = _body(rendered, 'addWidget')
    assert "...tagsIds.map((_m) => ({ model: 'tag', id: _m," in add
    assert "...notesIds.map((_m) => ({ model: 'note', id: _m," in add
    assert add.index("model: 'tag'") < add.index('prisma.$transaction')
    assert "import { assertFkReferencesUsable } from '@/lib/_fk_reference';" in rendered


def test_update_checks_added_and_removed_members_against_the_stored_set():
    rendered, _ = _render(_schema())
    upd = _body(rendered, 'updateWidget')
    assert ("const _tagsIdsPrev = ((await prisma.widget.findUnique({ where: { id }, "
            "select: { tags: { select: { id: true } } } }))?.tags ?? []).map((r) => r.id);") in upd
    # added: a reference written (NOT_FOUND when unreachable); removed: a reference left (PERMISSION_DENIED)
    assert "...tagsIds.filter((_m) => !_tagsIdsPrev.includes(_m)).map((_m) => ({ model: 'tag', id: _m," in upd
    assert "..._tagsIdsPrev.filter((_m) => !tagsIds.includes(_m)).map((_m) => ({ model: 'tag', id: null, previousId: _m," in upd
    assert "..._notesIdsPrev.filter((_m) => !notesIds.includes(_m))" in upd
    assert upd.index('_tagsIdsPrev') < upd.index('prisma.$transaction')


def test_update_checks_the_references_of_inline_rows_it_drops():
    rendered, _ = _render(_schema())
    upd = _body(rendered, 'updateWidget')
    assert "const _partsDropped = (await prisma.widget.findUnique({" in upd
    assert "select: { parts: { where: { id: { notIn: partsItems.map((f) => f.id)" in upd
    assert "..._partsDropped.map((f) => ({ model: 'gadget', id: null, previousId: f.gadget_id," in upd
    assert upd.index('_partsDropped') < upd.index('prisma.$transaction')
    # create has nothing to drop
    assert '_partsDropped' not in _body(rendered, 'addWidget')


def test_delete_helper_checks_set_members_and_inline_rows():
    rendered, _ = _render(_schema())
    helper = _body(rendered, 'assertDeleteReferencesReachableWidget')
    assert ("select: { tags: { select: { id: true } }, notes: { select: { id: true } }, "
            "parts: { select: { gadget_id: true, } }, }") in helper
    assert "..._row.tags.map((_m) => ({ model: 'tag', id: _m.id," in helper
    assert "..._row.notes.map((_m) => ({ model: 'note', id: _m.id," in helper
    assert "..._row.parts.flatMap((_c) => [" in helper
    assert "{ model: 'gadget', id: _c.gadget_id," in helper
    assert "import { assertStoredFkReferencesReachable } from '@/lib/_fk_reference';" in rendered


def test_delete_entrances_run_the_check_for_an_entity_with_only_set_or_inline_references():
    from generators import actions_context

    entity = {
        'parent': 'widget', 'model': 'widget', 'definition_key': 'widget', 'children': [dict(c) for c in _CHILDREN],
        'generate_config': {**_GEN, 'fields': None},
    }
    ctx = build_context(entity, _schema())
    assert not ctx['fk_write_checks']  # widget's own foreign keys are organization only
    env = generate._make_env()
    detail = env.get_template('api_detail_route.ts.jinja2').render(**ctx)
    bulk = env.get_template('api_bulk_route.ts.jinja2').render(**ctx)
    assert 'assertDeleteReferencesReachableWidget(actorId, [id]);' in detail
    assert 'assertDeleteReferencesReachableWidget(actorId, [id]);' in bulk
    assert 'assertDeleteReferencesReachableWidget' in actions_context(ctx)['service_imports']


def test_no_delete_helper_without_delete():
    rendered, _ = _render(_schema(), {'delete': False})
    assert 'assertDeleteReferencesReachableWidget' not in rendered
    assert 'assertStoredFkReferencesReachable' not in rendered


def test_security_flags_name_the_set_shapes_of_organization_scoped_members():
    _, ctx = _render(_schema())
    flags = generate._security_fk_shape_flags('widget', {}, _schema(), True, ctx['set_fk_checks'])
    assert flags['fk_set_many_to_many'] and flags['fk_set_one_to_many']
    # without an organization column on the parent nothing is unreachable
    off = generate._security_fk_shape_flags('widget', {}, _schema(), False, ctx['set_fk_checks'])
    assert not off['fk_set_many_to_many'] and not off['fk_set_one_to_many']


def test_members_without_an_organization_are_checked_but_are_not_a_matrix_shape():
    schema = _schema(member_scoped=False)
    rendered, ctx = _render(schema)
    # still checked for read permission, as a single foreign key to such a target is
    assert "model: 'tag'" in _body(rendered, 'addWidget')
    flags = generate._security_fk_shape_flags('widget', {}, schema, True, ctx['set_fk_checks'])
    assert not flags['fk_set_many_to_many'] and not flags['fk_set_one_to_many']
