"""EntityContext: pre-computed data for template rendering.

All logic lives here. Templates receive plain data structures with no
computation needed — just iteration and conditionals on boolean flags.
"""
from dataclasses import dataclass
from typing import Optional

from helpers.naming import to_pascal_case, to_camel_case
from helpers.type_mapping import get_ts_type
from helpers.schema_helpers import (
    filter_fields,
    get_parent_relationships,
    get_detail_relation_name,
)


# ---------------------------------------------------------------------------
# Data structures passed to templates
# ---------------------------------------------------------------------------

@dataclass
class FieldInfo:
    name: str
    ts_type: str


@dataclass
class RelInfo:
    relation_name: str   # resolved from detail def (e.g. "organization", not "organization_id")
    target: str          # entity name (e.g. "organization")
    label_field: str     # for XxxOption types (usually "name")


@dataclass
class ChildContext:
    name: str            # entity name (e.g. "shift_assignment")
    property_name: str   # array property on parent (e.g. "shift_assignments")
    output_type: Optional[str]
    fields: list[FieldInfo]
    relationships: list[RelInfo]   # many-to-one rels within this child
    declare_type: bool   # False when this child type was already declared earlier


@dataclass
class EntityContext:
    parent: str
    model: str
    import_targets: list[str]       # deduped external type imports
    parent_fields: list[FieldInfo]
    parent_rels: list[RelInfo]      # many-to-one relationships on parent
    option_types: list[RelInfo]     # XxxOption types to emit (target != model)
    children: list[ChildContext]
    form_view_fields: list[FieldInfo]   # parent fields minus timestamps
    all_option_targets: list[str]       # for FormUpsertProps allXxx / xxxPermissions


# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------

_TIMESTAMP_FIELDS = {'created_at', 'updated_at', 'creator_id'}


def _dedupe_ordered(items):
    seen = set()
    result = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


def build_entity_context(entity: dict, schema: dict) -> EntityContext:
    """Convert a raw EntityRelation dict + schema into a flat EntityContext for templates."""
    parent = entity['parent']
    model = entity['model']
    def_key = entity['definition_key']
    generate_config = entity.get('generate_config', {})
    children_raw = entity.get('children', [])

    model_def = schema['definitions'].get(model, {})
    filtered_props = filter_fields(
        model_def.get('properties', {}),
        generate_config.get('fields'),
    )

    # Many-to-one relationships on parent (using filtered props)
    merged_def = {**model_def, 'properties': filtered_props}
    rels_raw = get_parent_relationships(merged_def)

    # Dedupe by target (first occurrence wins, same as TS Map behaviour)
    seen_targets: dict[str, dict] = {}
    for r in rels_raw:
        seen_targets.setdefault(r['target'], r)
    relationship_targets = list(seen_targets.values())

    # Resolve property name from detail definition (e.g. find "organization" prop that $refs Organization)
    parent_rels = [
        RelInfo(
            relation_name=get_detail_relation_name(parent, r['target'], schema, def_key),
            target=r['target'],
            label_field=r.get('label_field', r.get('label_field', 'name')),
        )
        for r in relationship_targets
    ]

    parent_fields = [FieldInfo(k, get_ts_type(v)) for k, v in filtered_props.items()]
    parent_fields.append(FieldInfo('creator_id', 'string | null'))  # enforce id as string for permissions

    form_view_fields = [
        FieldInfo(k, get_ts_type(v, for_view_props=True))
        for k, v in filtered_props.items()
        if k not in _TIMESTAMP_FIELDS
    ]

    # Child many-to-one rels — needed early for import target calculation
    child_rels_early = []
    for child_raw in children_raw:
        child_def = schema['definitions'].get(child_raw['name'], {})
        if child_def.get('properties'):
            child_rels_early.extend(get_parent_relationships(child_def))

    # Import targets = union of parent + child relationship targets, filtered to exclude model itself
    all_import_targets = _dedupe_ordered([
        *[r['target'] for r in relationship_targets],
        *[r['target'] for r in child_rels_early],
    ])
    import_targets = [t for t in all_import_targets if t != model]

    # XxxOption types — parent rels whose target is not the model itself
    option_types = [r for r in parent_rels if r.target != model]

    # Build child contexts, deduplicating type declarations
    children: list[ChildContext] = []
    declared_child_types: set[str] = set()

    for child_raw in children_raw:
        child_name = child_raw['name']
        child_def = schema['definitions'].get(child_name, {})
        if not child_def.get('properties'):
            continue

        # Respect field filtering from child's own detail definition
        child_detail_def = schema['definitions'].get(f'{child_name}_detail', {})
        child_fields_whitelist = (child_detail_def.get('x-generate') or {}).get('fields')
        filtered_child_props = filter_fields(child_def['properties'], child_fields_whitelist)

        child_fields = [FieldInfo(k, get_ts_type(v)) for k, v in filtered_child_props.items()]

        child_rels = [
            RelInfo(
                relation_name=r['prop_name'].removesuffix('_id'),
                target=r['target'],
                label_field=r.get('label_field', 'name'),
            )
            for r in get_parent_relationships(child_def)
        ]

        already_declared = child_name in declared_child_types or child_name == model
        if not already_declared:
            declared_child_types.add(child_name)

        children.append(ChildContext(
            name=child_name,
            property_name=child_raw['property_name'],
            output_type=child_raw.get('output_type'),
            fields=child_fields,
            relationships=child_rels,
            declare_type=not already_declared,
        ))

    # all_option_targets for FormUpsertProps: m2m targets + parent rels + child rel targets
    m2m_targets = [
        c['relationship']['target']
        for c in children_raw
        if (c.get('relationship') or {}).get('type') == 'many-to-many'
    ]
    child_rel_targets = _dedupe_ordered(r['target'] for r in child_rels_early)
    all_option_targets = _dedupe_ordered([
        *m2m_targets,
        *[r.target for r in parent_rels],
        *child_rel_targets,
    ])

    return EntityContext(
        parent=parent,
        model=model,
        import_targets=import_targets,
        parent_fields=parent_fields,
        parent_rels=parent_rels,
        option_types=option_types,
        children=children,
        form_view_fields=form_view_fields,
        all_option_targets=all_option_targets,
    )
