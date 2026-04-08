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
    is_optional_fk_to_parent,
    get_one_to_one_rels,
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
class OneToOneChildInfo:
    property_name: str   # e.g. "approval_requests"
    child_name: str      # e.g. "approval_request"
    fields: list[FieldInfo]
    relationships: list[RelInfo]


@dataclass
class OneToOneRelInfo:
    relation_name: str       # e.g. "approvable"
    target: str              # e.g. "approvable"
    children: list[OneToOneChildInfo]


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
    one_to_one_rels: list[OneToOneRelInfo]  # one-to-one outbound FK rels with nested children
    entity_view_component: str | None = None   # custom component rendered in FormView
    entity_edit_component: str | None = None   # custom component rendered in FormUpsert


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

    # Dedupe by target for import purposes only (each target type imported once)
    seen_targets: dict[str, dict] = {}
    for r in rels_raw:
        seen_targets.setdefault(r['target'], r)
    relationship_targets = list(seen_targets.values())

    # All many-to-one rels (not deduplicated) — derive relation name from prop_name directly
    parent_rels = [
        RelInfo(
            relation_name=r['prop_name'].removesuffix('_id'),
            target=r['target'],
            label_field=r.get('label_field', 'name'),
        )
        for r in rels_raw
    ]

    parent_fields = [FieldInfo(k, get_ts_type(v)) for k, v in filtered_props.items()]
    parent_fields.append(FieldInfo('creator_id', 'string | null'))  # enforce id as string for permissions

    # One-to-one FK props (computed early for form_view_fields exclusion)
    _oto_fk_names_early = {
        p for p, v in filtered_props.items()
        if (v.get('x-relationship') or {}).get('type') == 'one-to-one'
    }

    form_view_fields = [
        FieldInfo(k, get_ts_type(v, for_view_props=True))
        for k, v in filtered_props.items()
        if k not in _TIMESTAMP_FIELDS and k not in _oto_fk_names_early
    ]

    # Child many-to-one rels — needed early for import target and option calculation.
    # Exclude list children: they are independent entities managed on their own pages,
    # so their FK dropdown options are not needed in this form.
    child_rels_early = []
    for child_raw in children_raw:
        if child_raw.get('output_type') == 'list':
            continue
        child_def = schema['definitions'].get(child_raw['name'], {})
        if child_def.get('properties'):
            child_rels_early.extend(get_parent_relationships(child_def))

    # One-to-one outbound FK rels (computed early for import targets)
    oto_rels_early = get_one_to_one_rels({**model_def, 'properties': filtered_props}, schema)
    # Only import oto child rel targets that have their own generated types
    def _has_generated_types(target: str) -> bool:
        detail = schema['definitions'].get(f'{target}_detail', {})
        gen = detail.get('x-generate') or {}
        return any(gen.get(k) for k in ('list', 'view', 'new', 'edit', 'delete', 'api'))

    oto_child_rel_targets = [
        cr['target']
        for oto in oto_rels_early
        for c in oto['children']
        for cr in c['child_rels']
        if cr['target'] != oto['target'] and _has_generated_types(cr['target'])
    ]

    # Import targets = union of parent + child + one-to-one nested rel targets
    all_import_targets = _dedupe_ordered([
        *[r['target'] for r in relationship_targets],
        *[r['target'] for r in child_rels_early],
        *oto_child_rel_targets,
    ])
    import_targets = [t for t in all_import_targets if t != model]

    # XxxOption types — parent rels whose target is not the model itself (deduplicated by target)
    _seen_option_targets: set[str] = set()
    option_types = []
    for r in parent_rels:
        if r.target != model and r.target not in _seen_option_targets:
            _seen_option_targets.add(r.target)
            option_types.append(r)

    # Build child contexts, deduplicating type declarations
    children: list[ChildContext] = []
    declared_child_types: set[str] = set()

    for child_raw in children_raw:
        child_name = child_raw['name']
        child_def = schema['definitions'].get(child_name, {})
        if not child_def.get('properties'):
            continue

        # Independent entity: a list child (not m2m) that has its own _detail with x-generate.
        # Its type is declared in its own module — import it rather than redeclaring inline.
        is_independent = (
            child_raw.get('output_type') == 'list'
            and (child_raw.get('relationship') or {}).get('type') != 'many-to-many'
            and bool(schema['definitions'].get(f'{child_name}_detail', {}).get('x-generate'))
        )
        if is_independent:
            if child_name not in import_targets and child_name != model:
                import_targets.append(child_name)

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

        already_declared = is_independent or child_name in declared_child_types or child_name == model
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

    # all_option_targets for FormUpsertProps: m2m + optional-FK-list + parent rels + embedded child rels
    m2m_targets = [
        c['relationship']['target']
        for c in children_raw
        if (c.get('relationship') or {}).get('type') == 'many-to-many'
    ]
    optional_fk_list_targets = [
        c['name'] for c in children_raw
        if (c.get('output_type') == 'list'
            and (c.get('relationship') or {}).get('type') != 'many-to-many'
            and is_optional_fk_to_parent(schema['definitions'].get(c['name'], {}), model))
    ]
    child_rel_targets = _dedupe_ordered(r['target'] for r in child_rels_early)
    all_option_targets = _dedupe_ordered([
        *m2m_targets,
        *optional_fk_list_targets,
        *[r.target for r in parent_rels],
        *child_rel_targets,
    ])

    # One-to-one outbound FK rels with nested children (for types + display)
    oto_rels_raw = get_one_to_one_rels({**model_def, 'properties': filtered_props}, schema)
    one_to_one_rels: list[OneToOneRelInfo] = []
    for oto in oto_rels_raw:
        oto_children: list[OneToOneChildInfo] = []
        for c in oto['children']:
            child_def = c['child_def']
            child_filtered = filter_fields(child_def.get('properties', {}), None)
            c_fields = [FieldInfo(k, get_ts_type(v)) for k, v in child_filtered.items()]
            c_rels = [
                RelInfo(
                    relation_name=r['prop_name'].removesuffix('_id'),
                    target=r['target'],
                    label_field=r.get('label_field', 'name'),
                )
                for r in c['child_rels']
                if r['target'] != oto['target']  # exclude back-ref to one-to-one parent
            ]
            oto_children.append(OneToOneChildInfo(
                property_name=c['property_name'],
                child_name=c['child_name'],
                fields=c_fields,
                relationships=c_rels,
            ))
        one_to_one_rels.append(OneToOneRelInfo(
            relation_name=oto['relation_name'],
            target=oto['target'],
            children=oto_children,
        ))

    # Custom view/edit components from x-custom-component config
    _xcc = schema['definitions'].get(def_key, {}).get('x-custom-component') or {}
    _xcc_name = _xcc.get('name')
    _xcc_target = _xcc.get('target') or ['list']
    entity_view_component = _xcc_name if (_xcc_name and 'view' in _xcc_target) else None
    entity_edit_component = _xcc_name if (_xcc_name and 'edit' in _xcc_target) else None

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
        one_to_one_rels=one_to_one_rels,
        entity_view_component=entity_view_component,
        entity_edit_component=entity_edit_component,
    )
