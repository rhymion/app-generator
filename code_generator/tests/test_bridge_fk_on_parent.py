"""
FK-on-parent bridge pattern tests.

Verifies the generator correctly handles the new bridge direction where:
  - bridge model (`<child>able`) holds only `id` and back-relations
  - parent entities carry `<child>able_id String @unique`
  - child entity carries `<child>able_id` (required FK to bridge, onDelete: Cascade)

Run:
    cd code_generator && python3 -m pytest tests/test_bridge_fk_on_parent.py -v
"""
import pytest
from helpers.bridge_direction import (
    bridge_child_from_name,
    get_new_form_bridge,
    collect_parent_bridge_fk_props,
    collect_parent_bridge_children,
)
from helpers.bridge_prisma import (
    emit_bridge_model,
    emit_parent_bridge_fk,
    emit_child_bridge_fk,
)
from build_context import build_context
from generators import service_context


# ---------------------------------------------------------------------------
# Minimal schema builders
# ---------------------------------------------------------------------------

def _bridge_schema(
    bridge_name: str = 'channelable',
    child_name: str = 'channel',
    parent_names: list[str] | None = None,
) -> dict:
    """Build a minimal schema with child entity using new-form x-bridge."""
    if parent_names is None:
        parent_names = ['work', 'character', 'scene']

    defs: dict = {}

    # Bridge model (id only, x-generate all false)
    defs[f'__{bridge_name}'] = {
        'type': 'object',
        'required': ['id'],
        'properties': {'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'}},
    }
    defs[bridge_name] = {
        'x-generate': {
            'list': False, 'view': False, 'new': False, 'edit': False,
            'delete': False, 'api': False, 'test': False,
        },
        'allOf': [{'$ref': f'#/definitions/__{bridge_name}'}],
    }

    # Child entity with new-form x-bridge — x-bridge lives on the raw entity.
    defs[f'__{child_name}'] = {
        'type': 'object',
        'required': ['id', 'name'],
        'x-bridge': {
            'name': bridge_name,
            'child': child_name,
            'parentCardinality': 'exactlyOne',
            'parents': [
                {'role': f'{p}_hub', 'target': p, 'labelField': 'name'}
                for p in parent_names
            ],
        },
        'properties': {
            'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
            'name': {'type': 'string', 'minLength': 1},
        },
    }
    defs[child_name] = {
        'x-generate': {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': True, 'test': True,
        },
        'allOf': [{'$ref': f'#/definitions/__{child_name}'}],
    }

    # Parent entities (minimal)
    for p in parent_names:
        defs[f'__{p}'] = {
            'type': 'object',
            'required': ['id', 'name'],
            'properties': {
                'id': {'type': 'string', 'pattern': '^c[a-z0-9]{24,}$'},
                'name': {'type': 'string', 'minLength': 1},
            },
        }
        defs[p] = {
            'x-generate': {
                'list': True, 'view': True, 'new': True, 'edit': True,
                'delete': True, 'api': True, 'test': True,
            },
            'allOf': [{'$ref': f'#/definitions/__{p}'}],
        }

    return {'definitions': defs}


def _entity(model: str) -> dict:
    return {
        'parent': model,
        'model': model,
        'definition_key': model,
        'children': [],
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': True, 'test': True, 'fields': None,
        },
    }


# ---------------------------------------------------------------------------
# Bridge direction tests  (naming convention)
# ---------------------------------------------------------------------------

def test_bridge_direction_commentable_child():
    """commentable bridge → child entity is 'comment'."""
    assert bridge_child_from_name('commentable') == 'comment'


def test_bridge_direction_channelable_child():
    """channelable bridge → child entity is 'channel'."""
    assert bridge_child_from_name('channelable') == 'channel'


def test_bridge_direction_bookmarkable_child():
    """bookmarkable bridge → child entity is 'bookmark'."""
    assert bridge_child_from_name('bookmarkable') == 'bookmark'


# ---------------------------------------------------------------------------
# New-form x-bridge parsing
# ---------------------------------------------------------------------------

def test_new_form_bridge_parsed_correctly():
    """get_new_form_bridge extracts bridge_name, child, and parent_targets."""
    entity_def = {
        'x-bridge': {
            'name': 'channelable',
            'child': 'channel',
            'parentCardinality': 'exactlyOne',
            'parents': [
                {'role': 'work_hub', 'target': 'work', 'labelField': 'title'},
                {'role': 'character_hub', 'target': 'character', 'labelField': 'name'},
                {'role': 'scene_hub', 'target': 'scene', 'labelField': 'label'},
            ],
        }
    }
    ir = get_new_form_bridge(entity_def)
    assert ir is not None
    assert ir['name'] == 'channelable'
    assert ir['child'] == 'channel'
    assert ir['cardinality'] == 'exactlyOne'
    assert set(ir['parent_targets']) == {'work', 'character', 'scene'}


def test_old_form_bridge_returns_none_from_new_parser():
    """Old array x-bridge is not recognized by get_new_form_bridge."""
    entity_def = {
        'x-bridge': [
            {'role': 'work_hub', 'target': 'work', 'via': 'work_id', 'kind': 'one_to_one_bridge'}
        ]
    }
    assert get_new_form_bridge(entity_def) is None


def test_no_xbridge_returns_none():
    """Entity without x-bridge returns None."""
    assert get_new_form_bridge({'type': 'object', 'properties': {}}) is None


# ---------------------------------------------------------------------------
# Cardinality tests — parent FK injection + bridge create
# ---------------------------------------------------------------------------

def test_parent_bridge_fk_injected_into_work_context():
    """Parent entity (work) gets channelable_id injected when channel declares x-bridge."""
    schema = _bridge_schema()
    ctx = build_context(_entity('work'), schema)

    # channelable_id must appear as a one-to-one_bridge auto-create rel
    auto_oto_targets = [r['target'] for r in ctx['one_to_one_rels']]
    assert 'channelable' in auto_oto_targets, (
        f'Expected channelable in auto_create_oto_rels, got: {auto_oto_targets}'
    )


def test_parent_one_to_one_pre_creates_includes_bridge():
    """Generated service pre-creates bridge row on parent create (cardinality = exactly-one)."""
    schema = _bridge_schema()
    ctx = build_context(_entity('work'), schema)

    pre_creates = ctx['one_to_one_pre_creates']
    assert 'channelable' in pre_creates, (
        f'Expected bridge pre-create for channelable, got:\n{pre_creates}'
    )
    assert 'tx.channelable.create' in pre_creates


def test_zero_parent_bridge_fk_not_injected_into_child():
    """Child entity (channel) does NOT get bridge FK injected into its own auto-create OTO."""
    schema = _bridge_schema()
    ctx = build_context(_entity('channel'), schema)

    # channel is a child: its one_to_one_rels should NOT include channelable
    # (channelable is the bridge that channel belongs to — FK may be on channel, but it's
    # a many-to-one to the bridge, not a one-to-one it auto-creates)
    auto_oto_targets = [r['target'] for r in ctx['one_to_one_rels']]
    assert 'channelable' not in auto_oto_targets, (
        f'channelable should not be auto-created by child; got: {auto_oto_targets}'
    )


# ---------------------------------------------------------------------------
# Cascade tests — bridge cleanup on parent delete
# ---------------------------------------------------------------------------

def test_parent_context_has_bridge_cleanup_rels():
    """Parent entity (work) context includes bridge_cleanup_rels for channelable."""
    schema = _bridge_schema()
    ctx = build_context(_entity('work'), schema)

    cleanup_targets = [r['target'] for r in ctx['bridge_cleanup_rels']]
    assert 'channelable' in cleanup_targets, (
        f'Expected channelable in bridge_cleanup_rels, got: {cleanup_targets}'
    )


def test_parent_context_bridge_pre_delete_select_populated():
    """bridge_pre_delete_select is non-empty for parent entities that own bridge rows."""
    schema = _bridge_schema()
    ctx = build_context(_entity('work'), schema)

    assert ctx['bridge_pre_delete_select'] is not None
    assert 'channelable_id' in ctx['bridge_pre_delete_select']


def test_parent_context_bridge_post_delete_cleanups_populated():
    """bridge_post_delete_cleanups contains channelable deleteMany for parent entities."""
    schema = _bridge_schema()
    ctx = build_context(_entity('work'), schema)

    cleanups = ctx['bridge_post_delete_cleanups']
    assert 'channelable' in cleanups, (
        f'Expected channelable cleanup in bridge_post_delete_cleanups, got:\n{cleanups}'
    )
    assert 'deleteMany' in cleanups


def test_service_delete_includes_bridge_cleanup():
    """Generated service delete code includes bridge row cleanup for parent entities."""
    from generators import service_context
    from jinja2 import Environment, FileSystemLoader
    from pathlib import Path

    schema = _bridge_schema()
    ctx = build_context(_entity('work'), schema)
    # generate.py merges ctx + service_context output before rendering
    svc_ctx = {**ctx, **service_context(ctx, schema)}

    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    rendered = env.get_template('service.ts.jinja2').render(**svc_ctx)

    assert '_bridgeRows' in rendered, 'service delete should capture bridge row IDs'
    assert 'channelable' in rendered, 'service delete should cleanup channelable bridge rows'


# ---------------------------------------------------------------------------
# Autocomplete tests — bridge child parent selector
# ---------------------------------------------------------------------------

def test_bridge_child_ir_populated_for_child_entity():
    """Child entity (channel) context has bridge_child_ir with correct parent_targets."""
    schema = _bridge_schema()
    ctx = build_context(_entity('channel'), schema)

    ir = ctx['bridge_child_ir']
    assert ir is not None, 'channel should have bridge_child_ir set'
    assert ir['name'] == 'channelable'
    assert ir['child'] == 'channel'
    assert set(ir['parent_targets']) == {'work', 'character', 'scene'}


def test_bridge_child_selection_targets_include_parents():
    """Child entity (channel) selection_targets includes parent entity names for autocomplete."""
    schema = _bridge_schema()
    ctx = build_context(_entity('channel'), schema)

    targets = ctx['selection_targets']
    assert 'work' in targets, f'Expected work in selection_targets, got: {targets}'
    assert 'character' in targets, f'Expected character in selection_targets, got: {targets}'
    assert 'scene' in targets, f'Expected scene in selection_targets, got: {targets}'


def test_parent_entity_has_no_bridge_child_ir():
    """Parent entity (work) bridge_child_ir is None (only child entities have it)."""
    schema = _bridge_schema()
    ctx = build_context(_entity('work'), schema)
    assert ctx['bridge_child_ir'] is None


# ---------------------------------------------------------------------------
# Prisma emission tests
# ---------------------------------------------------------------------------

def test_emit_bridge_model_contains_id_and_back_relations():
    """emit_bridge_model generates id field and back-relations for all parents and child."""
    result = emit_bridge_model('channelable', 'channel', ['work', 'character', 'scene'])

    assert 'model channelable' in result
    assert '@id @default(cuid())' in result
    assert 'work?' in result
    assert 'character?' in result
    assert 'scene?' in result
    assert 'channel[]' in result
    assert 'channelable_id' not in result  # bridge model does NOT have parent FK columns


def test_emit_parent_bridge_fk_lines():
    """emit_parent_bridge_fk returns @unique scalar FK and optional relation."""
    scalar, relation = emit_parent_bridge_fk('channelable', 'work')

    assert 'channelable_id' in scalar
    assert '@unique' in scalar
    assert 'channelable?' in relation
    assert 'WorkChannelable' in relation


def test_emit_child_bridge_fk_lines():
    """emit_child_bridge_fk returns required scalar FK and relation with onDelete: Cascade."""
    scalar, relation = emit_child_bridge_fk('channelable')

    assert 'channelable_id' in scalar
    assert '@unique' not in scalar  # child FK is not unique (many channels per bridge is disallowed by validation, not by DB constraint)
    assert 'onDelete: Cascade' in relation


# ---------------------------------------------------------------------------
# Regression: existing tests not broken
# ---------------------------------------------------------------------------

def test_old_form_bridge_still_works_via_commentable():
    """Old array x-bridge (commentable pattern) still produces correct context.

    _commentable_schema() uses 'db_table' as the entity with a one-to-one_bridge commentable_id.
    """
    from tests.test_auto_create_oto import _commentable_schema, _entity as _oto_entity
    schema = _commentable_schema()
    ctx = build_context(_oto_entity('db_table'), schema)

    assert ctx['has_commentable'] is True
    assert ctx['bridge_child_ir'] is None  # old-form array x-bridge is not new-form object x-bridge


def test_collect_parent_bridge_fk_props_returns_fk_for_listed_parent():
    """collect_parent_bridge_fk_props returns FK props for entities listed as parents."""
    schema = _bridge_schema()
    injected = collect_parent_bridge_fk_props('work', schema)

    assert 'channelable_id' in injected
    fk_def = injected['channelable_id']
    assert fk_def['x-relationship']['type'] == 'one-to-one_bridge'
    assert fk_def['x-relationship']['target'] == 'channelable'


def test_collect_parent_bridge_fk_props_empty_for_non_parent():
    """collect_parent_bridge_fk_props returns nothing for entities not listed as parents."""
    schema = _bridge_schema()
    injected = collect_parent_bridge_fk_props('music', schema)
    assert injected == {}


# ---------------------------------------------------------------------------
# B1: generate.py bridge_additions pipeline
# ---------------------------------------------------------------------------

def test_build_bridge_prisma_additions_generates_model_and_fk():
    """build_bridge_prisma_additions emits bridge model + parent/child FK lines."""
    from generate import build_bridge_prisma_additions

    schema = _bridge_schema()
    output = build_bridge_prisma_additions(schema)

    assert 'model channelable' in output, (
        f'Expected "model channelable" in bridge additions, got:\n{output}'
    )
    assert 'channelable_id' in output, (
        f'Expected "channelable_id" FK references in bridge additions, got:\n{output}'
    )


# ---------------------------------------------------------------------------
# B4: service.ts rendering for bridge child entity
# ---------------------------------------------------------------------------

def test_service_bridge_child_has_resolved_fk_and_branches():
    """Rendered service.ts for bridge child has _resolvedBridgeFk and per-parent branches."""
    from jinja2 import Environment, FileSystemLoader
    from pathlib import Path

    schema = _bridge_schema()
    ctx = build_context(_entity('channel'), schema)
    svc_ctx = {**ctx, **service_context(ctx, schema)}

    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    rendered = env.get_template('service.ts.jinja2').render(**svc_ctx)

    assert '_resolvedBridgeFk' in rendered, (
        'service add should declare _resolvedBridgeFk for bridge child'
    )
    assert 'channelable_id' in rendered, (
        'service add should include channelable_id in create data'
    )
    assert "selectedParentType === 'work'" in rendered, (
        'service add should branch on work parent type'
    )
    assert "selectedParentType === 'character'" in rendered, (
        'service add should branch on character parent type'
    )


# ---------------------------------------------------------------------------
# B4: form_upsert rendering for bridge child entity
# ---------------------------------------------------------------------------

def test_form_upsert_bridge_child_has_parent_selector():
    """Stage 2: bridge child FormUpsert uses hidden inputs (no visible parent-type text field)."""
    from generators import form_upsert_context
    from jinja2 import Environment, FileSystemLoader
    from pathlib import Path

    schema = _bridge_schema()
    ctx = build_context(_entity('channel'), schema)
    fu_ctx = {**ctx, **form_upsert_context(ctx, schema)}

    env = Environment(
        loader=FileSystemLoader(Path(__file__).parent.parent / 'templates'),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    rendered = env.get_template('form_upsert.tsx.jinja2').render(**fu_ctx)

    # Stage 2: comment changed from "bridge-parent-selector" to "bridge-parent"
    assert 'bridge-parent:' in rendered, (
        'FormUpsert should contain bridge-parent comment marker'
    )
    # Refs are still generated (needed for hidden inputs in new mode)
    assert 'selectedParentTypeRef' in rendered, (
        'FormUpsert should declare selectedParentTypeRef'
    )
    assert 'selectedParentIdRef' in rendered, (
        'FormUpsert should declare selectedParentIdRef'
    )
    assert "selectedParentType" in rendered, (
        'FormUpsert handleSubmit should set selectedParentType in formData'
    )
    # Stage 2: no visible text inputs for parent selection in edit mode
    assert 'Parent type' not in rendered, (
        'Stage 2: visible parent type text input should be removed'
    )


# ---------------------------------------------------------------------------
# B5: bridge_cleanup_rels null safety
# ---------------------------------------------------------------------------

def test_bridge_cleanup_rels_filter_boolean_present():
    """bridge_post_delete_cleanups uses .filter(Boolean) to skip null bridge FKs."""
    schema = _bridge_schema()
    ctx = build_context(_entity('work'), schema)

    cleanups = ctx['bridge_post_delete_cleanups']
    assert '.filter(Boolean)' in cleanups, (
        f'Expected .filter(Boolean) in bridge cleanup code, got:\n{cleanups}'
    )


# ---------------------------------------------------------------------------
# Parent-embedded bridge child discovery (cmd_167 §4 — parent DataGrid)
# ---------------------------------------------------------------------------

def test_collect_parent_bridge_children_discovers_each_parent():
    schema = _bridge_schema(parent_names=['work', 'character', 'scene'])
    for parent in ['work', 'character', 'scene']:
        kids = collect_parent_bridge_children(parent, schema)
        assert [k['child'] for k in kids] == ['channel']
        k = kids[0]
        assert k['bridge_name'] == 'channelable'
        assert k['parent_fk'] == 'channelable_id'
        assert k['role'] == f'{parent}_hub'
        assert k['label_field'] == 'name'


def test_collect_parent_bridge_children_empty_for_non_parent():
    schema = _bridge_schema(parent_names=['work'])
    assert collect_parent_bridge_children('character', schema) == []


def test_collect_parent_bridge_children_columns_from_x_display():
    schema = _bridge_schema(parent_names=['work'])
    schema['definitions']['__channel']['x-display'] = {
        'table': [{'name': {'primary': True}}, {'kind': {}}]
    }
    kids = collect_parent_bridge_children('work', schema)
    assert kids[0]['columns'] == [{'name': {'primary': True}}, {'kind': {}}]
