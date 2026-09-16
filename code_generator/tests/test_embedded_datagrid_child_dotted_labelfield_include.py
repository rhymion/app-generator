"""
Regression tests for issue #539: embedded DataGrid child's own FK relations
with a dotted/composite labelField.

Background
----------
`build_context.py`'s `child_include_entries` builder (~L3273-3382) fetches
each embedded DataGrid child's own FK relations for `get{Parent}Detail`
(used by FormUpsert/FormView). Previously it registered every such relation
as flat `{relation}: true}` unconditionally, regardless of whether the
relation's OWN `labelField` walks a nested relation on the FK target (e.g.
`goods_receipt_line.inventory_id -> inventory`, whose labelField is
`[item.sku, location.code, bin.code, lot_number, expiration_date]`). A flat
`true` only fetches the target's own scalar columns -- a labelField segment
that reaches one hop further (`item.sku`) then reads as `undefined` at
runtime, because `inventory.item` was never fetched.

Fix: for each of the child's own FK relations whose labelField contains a
dotted/composite path, the relation's own required nested relations are
resolved via `build_label_expression` and merged *under* that relation's own
key (not as siblings in the child's relation namespace -- the two are
different namespaces: the child's own relation names vs. the FK target's
own relation names). A relation whose labelField has no dot (simple /
single-segment, including the default `name`) is left as flat `true`,
unchanged -- the boundary this file's "simple labelField" tests fix in
place, since a fix that over-nests every relation regardless of labelField
shape would be its own regression.

This file also cross-checks the embedded case against the SAME entity
generated as an INDEPENDENT (non-embedded) top-level entity: the independent
side's own `get{Entity}Detail` include (`_detail_entry_for_rel` /
`_include_entry_for_rel` in build_context.py) already deepened dotted
labelFields correctly before this fix -- issue #539 asked for the embedded
side to produce the identical shape ("as in independent child page").
"""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / 'code_generator'))

from build_context import build_context  # noqa: E402


def _entity(model: str, children: list | None = None) -> dict:
    return {
        'parent': model,
        'model': model,
        'definition_key': model,
        'children': children or [],
        'generate_config': {
            'list': True, 'view': True, 'new': True, 'edit': True,
            'delete': True, 'api': True, 'test': True, 'fields': None,
        },
    }


def _child_entry(name: str, prop: str) -> dict:
    return {
        'name': name,
        'property_name': prop,
        'output_type': None,
        'file_type': None,
        'relationship': None,
    }


def _schema() -> dict:
    """
    `doc` embeds datagrid child `line` (property `lines`). `line` carries two
    FK relations to independent targets:

      - `bin_id -> bin`, labelField `code` -- a SIMPLE (non-dotted) labelField
        naming a plain scalar on `bin` itself. Must stay flat `true`.
      - `inventory_id -> inventory`, labelField
        `[item.sku, location.name]` -- a COMPOSITE, dotted labelField whose
        segments each walk one hop into `inventory`'s own relations
        (`item`, `location`). Must become a nested include under `inventory`.

    `line` is ALSO independently generatable (api/list/view all True) so its
    own top-level `get{Line}Detail` include can be compared against the
    embedded shape for the exact same `inventory_id` relation.
    """
    return {
        'definitions': {
            'doc': {
                'type': 'object',
                'required': ['id'],
                'properties': {'id': {'type': 'string'}},
            },
            'bin': {
                'type': 'object',
                'required': ['id', 'code'],
                'properties': {'id': {'type': 'string'}, 'code': {'type': 'string'}},
            },
            'item': {
                'type': 'object',
                'required': ['id', 'sku'],
                'properties': {'id': {'type': 'string'}, 'sku': {'type': 'string'}},
            },
            'location': {
                'type': 'object',
                'required': ['id', 'name'],
                'properties': {'id': {'type': 'string'}, 'name': {'type': 'string'}},
            },
            'inventory': {
                'type': 'object',
                'required': ['id', 'item_id', 'location_id'],
                'properties': {
                    'id': {'type': 'string'},
                    'item_id': {
                        'type': 'string',
                        'x-relationship': {
                            'type': 'many-to-one', 'target': 'item', 'labelField': 'sku',
                        },
                    },
                    'location_id': {
                        'type': 'string',
                        'x-relationship': {
                            'type': 'many-to-one', 'target': 'location', 'labelField': 'name',
                        },
                    },
                },
            },
            'line': {
                'type': 'object',
                'required': ['id', 'doc_id', 'bin_id', 'inventory_id'],
                'properties': {
                    'id': {'type': 'string'},
                    'doc_id': {
                        'type': 'string',
                        'x-relationship': {'type': 'many-to-one', 'target': 'doc'},
                    },
                    'bin_id': {
                        'type': 'string',
                        'x-relationship': {
                            'type': 'many-to-one', 'target': 'bin', 'labelField': 'code',
                        },
                    },
                    'inventory_id': {
                        'type': 'string',
                        'x-relationship': {
                            'type': 'many-to-one', 'target': 'inventory',
                            'labelField': ['item.sku', 'location.name'],
                        },
                    },
                },
            },
        },
    }


def _embedded_include_detail() -> str:
    entity = _entity('doc', children=[_child_entry('line', 'lines')])
    ctx = build_context(entity, _schema())
    return ctx['include_props_detail']


def _independent_include_detail() -> str:
    entity = _entity('line')
    ctx = build_context(entity, _schema())
    return ctx['include_props_detail']


def test_dotted_labelfield_relation_becomes_nested_include():
    """`inventory_id`'s labelField (`item.sku`, `location.name`) must nest
    `item`/`location` under `inventory` in the embedded parent's detail
    include -- a flat `inventory: true` (the pre-fix shape) reads
    `undefined` at runtime for both segments, since neither `item` nor
    `location` would have been fetched."""
    include_detail = _embedded_include_detail()
    assert 'inventory: { include: { item: true, location: true } }' in include_detail, (
        "embedded child_include_entries must deepen the `inventory` "
        "relation to match its own composite labelField "
        "['item.sku', 'location.name'].\n"
        f"include_props_detail was: {include_detail}"
    )


def test_dotted_labelfield_relation_is_not_flat_true():
    """Boundary in the other direction: `inventory` must NOT appear as a
    bare flat `true` anywhere in the include -- that is exactly the
    pre-fix shape that produced the `undefined` labels (issue #539)."""
    include_detail = _embedded_include_detail()
    assert 'inventory: true' not in include_detail, (
        "`inventory` must be nested (composite labelField), not flat "
        f"true.\ninclude_props_detail was: {include_detail}"
    )


def test_simple_labelfield_relation_stays_flat_true():
    """`bin_id`'s labelField (`code`) is a plain scalar on `bin` itself --
    no dot, no relation to walk. It must stay flat `true`: over-nesting a
    simple labelField (e.g. into `bin: { include: {} } }`) would be its own
    regression in the opposite direction."""
    include_detail = _embedded_include_detail()
    assert 'bin: true' in include_detail, (
        "a simple (non-dotted) labelField must leave the relation as flat "
        f"true.\ninclude_props_detail was: {include_detail}"
    )
    assert 'bin: { include:' not in include_detail, (
        "a simple (non-dotted) labelField must NOT be nested.\n"
        f"include_props_detail was: {include_detail}"
    )


def test_embedded_include_matches_independent_child_page_shape():
    """Issue #539's own wording: the embedded child's include for a relation
    with a composite/dotted labelField must render identically to how that
    SAME entity's independent (non-embedded) `get{Entity}Detail` already
    rendered it before this fix -- "as in independent child page"."""
    embedded = _embedded_include_detail()
    independent = _independent_include_detail()
    expected_shape = 'inventory: { include: { item: true, location: true } }'
    assert expected_shape in embedded, f"embedded include was: {embedded}"
    assert expected_shape in independent, f"independent include was: {independent}"
