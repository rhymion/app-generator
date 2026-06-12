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
    get_detail_ref_rels,
    get_flatten_rels,
)


# ---------------------------------------------------------------------------
# Data structures passed to templates
# ---------------------------------------------------------------------------

@dataclass
class FieldInfo:
    name: str
    ts_type: str
    optional: bool = False


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
class ReverseOtoRelInfo:
    prop_name: str           # TypeScript property name, e.g. "checkup_judgment"
    relation_name: str       # Prisma relation field name (may differ), e.g. "judgement"
    target: str              # entity name, e.g. "checkup_judgment"
    label_field: str         # field to show as display value
    label_field_is_date: bool


@dataclass
class FlattenRelInfo:
    prop_name: str           # TypeScript property name, e.g. "lifestyle"
    relation_name: str       # Prisma relation name (may differ), e.g. "lifestyle"
    target: str              # entity name, e.g. "lifestyle"
    is_m2o: bool             # True when FK lives in the parent model


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
    reverse_oto_rels: list[ReverseOtoRelInfo]  # reverse OTO: FK in target pointing back to this model
    flatten_rels: list[FlattenRelInfo]         # flatten rels: shown as collapsible accordion in detail view
    flatten_detail_imports: list[tuple[str, str]] = ()  # (type_name, module_name) for *_detail flatten targets
    inline_flatten_types: list[dict] = ()      # flatten targets without their own module; [{name, fields}]
    entity_view_components: list[dict] = ()    # custom components rendered in FormView; [{name, path?}]
    entity_edit_components: list[dict] = ()    # custom components rendered in FormUpsert; [{name, path?}]
    is_bridge_child: bool = False              # entity declares new-form x-bridge (parent-context create)


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

    parent_fields = [FieldInfo(k, get_ts_type(v)) for k, v in filtered_props.items()]
    parent_fields.append(FieldInfo('creator_id', 'string | null'))  # enforce id as string for permissions

    # Virtual columns: fields in x-display.table absent from both properties and relation
    # names ({field}_id in properties). Fields derived from FK relations are handled by
    # the existing relation system and must NOT be duplicated as virtual columns.
    xdisplay_ctx = model_def.get('x-display', {})
    _xdt: list | None = None
    if isinstance(xdisplay_ctx, list):
        _xdt = xdisplay_ctx
    elif isinstance(xdisplay_ctx, dict) and isinstance(xdisplay_ctx.get('table'), list):
        _xdt = xdisplay_ctx['table']
    if _xdt:
        for _item in _xdt:
            _fn = list(_item.keys())[0]
            _is_prop = _fn in filtered_props
            _is_rel  = f'{_fn}_id' in filtered_props
            if not _is_prop and not _is_rel:
                parent_fields.append(FieldInfo(_fn, 'string', optional=True))

    # Compute all OTO rels early so we can split and use for FK-name exclusions
    oto_rels_early = get_one_to_one_rels({**model_def, 'properties': filtered_props}, schema)
    _auto_create_oto_early = [r for r in oto_rels_early if not r['is_selector']]
    _selector_oto_early    = [r for r in oto_rels_early if r['is_selector']]
    _all_oto_prop_names = {r['prop_name'] for r in oto_rels_early}

    # Remove all OTO relations from the m2o-style list. Selector OTO is re-added
    # below as a parent_rel (autocomplete UI). Auto-create OTO (commentable/
    # approvable bridges) is handled via the dedicated `one_to_one_rels` list
    # downstream — letting it stay here would produce duplicate type fields,
    # duplicate includes, and bogus initial/search option props.
    rels_raw = [r for r in rels_raw if r['prop_name'] not in _all_oto_prop_names]

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

    # All OTO FK props are excluded from form_view_fields — the selector OTO rels will be
    # displayed through parent_rels (like many-to-one), and auto-create OTO via nested includes
    form_view_fields = [
        FieldInfo(k, get_ts_type(v, for_view_props=True))
        for k, v in filtered_props.items()
        if k not in _TIMESTAMP_FIELDS and k not in _all_oto_prop_names
    ]

    # Bridge child (Stage 3): add parent_type / parent_label virtual fields.
    # These are computed inline in getters.ts from the bridge parent include;
    # they are optional so detail-page returns that don't compute them still type-check.
    _x_bridge = model_def.get('x-bridge')
    if isinstance(_x_bridge, dict) and _x_bridge.get('parents'):
        _bridge_parent_vfields = [
            FieldInfo('parent_type', 'string | null', optional=True),
            FieldInfo('parent_label', 'string | null', optional=True),
        ]
        parent_fields.extend(_bridge_parent_vfields)
        form_view_fields.extend(_bridge_parent_vfields)

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

    # Only import auto-create OTO child rel targets that have their own generated types
    def _has_generated_types(target: str) -> bool:
        detail = schema['definitions'].get(f'{target}_detail', {})
        gen = detail.get('x-generate') or {}
        return any(gen.get(k) for k in ('list', 'view', 'new', 'edit', 'delete', 'api'))

    oto_child_rel_targets = [
        cr['target']
        for oto in _auto_create_oto_early
        for c in oto['children']
        for cr in c['child_rels']
        if cr['target'] != oto['target'] and _has_generated_types(cr['target'])
    ]

    # Selector OTO rels are treated like many-to-one for display and type generation
    # Add them to parent_rels so they get RelInfo, XxxOption types, and autocomplete UI
    for r in _selector_oto_early:
        parent_rels.append(RelInfo(
            relation_name=r['relation_name'],
            target=r['target'],
            label_field=r['label_field'],
        ))

    # Reverse OTO rels (FK lives in target, not in this model) — display-only in detail view
    _reverse_oto_early = get_detail_ref_rels(parent, {**model_def, 'properties': filtered_props}, schema)

    # Flatten rels (x-outputType: flatten on non-array $ref in _detail)
    _flatten_rels_raw = get_flatten_rels(parent, {**model_def, 'properties': filtered_props}, schema)
    # Only non-m2o flatten rels need new type imports (m2o targets are already in parent_rels)
    _flatten_non_m2o_targets = [r['target'] for r in _flatten_rels_raw if not r['is_m2o']]
    # Each flatten target falls into one of three buckets:
    #   1. `_detail` target with a base entity (e.g. `pre_check_detail` → import
    #      `PreCheckDetail` from `lib/pre_check/types`). Handled via
    #      `flatten_detail_imports`.
    #   2. Plain target that has its own generated module (own page or API).
    #      Imported normally via `import_targets`.
    #   3. Plain target with NO generated module (embedded one-to-one with no
    #      `x-generate` anywhere, e.g. `checkup_result`). There is no
    #      `lib/<target>/types.ts` to import from, so declare the type inline
    #      in this entity's `types.ts`.
    _USER_GENERATE_FLAGS = ('list', 'view', 'new', 'edit', 'delete', 'api')

    def _target_has_module(t: str) -> bool:
        defs = schema.get('definitions', {})
        for key in (t, f'{t}_detail'):
            defn = defs.get(key)
            if not isinstance(defn, dict):
                continue
            gen = defn.get('x-generate')
            if not isinstance(gen, dict):
                continue
            # extract_entities skips an entity only when every user-facing flag
            # is explicitly False; default for missing flags is True.
            if not all(gen.get(f) is False for f in _USER_GENERATE_FLAGS):
                return True
        return False

    _detail_suffix = '_detail'
    _flatten_detail_imports: list[tuple[str, str]] = []
    _flatten_non_detail_targets: list[str] = []
    _inline_flatten_targets: list[str] = []
    for _t in _flatten_non_m2o_targets:
        if _t.endswith(_detail_suffix) and _t[:-len(_detail_suffix)] in schema.get('definitions', {}):
            _flatten_detail_imports.append((_t, _t[:-len(_detail_suffix)]))
        elif _target_has_module(_t):
            _flatten_non_detail_targets.append(_t)
        else:
            _inline_flatten_targets.append(_t)

    # Build inline type declarations for embedded flatten targets. Field shape
    # mirrors the independent-entity convention (`parent_fields`): every
    # schema property plus `creator_id` so consumers can read audit info.
    _inline_flatten_types: list[dict] = []
    _seen_inline = set()
    for _t in _inline_flatten_targets:
        if _t in _seen_inline:
            continue
        _seen_inline.add(_t)
        _target_def = schema.get('definitions', {}).get(_t, {}) or {}
        _target_props = _target_def.get('properties', {}) or {}
        _fields = [FieldInfo(k, get_ts_type(v)) for k, v in _target_props.items()]
        if 'creator_id' not in _target_props:
            _fields.append(FieldInfo('creator_id', 'string | null'))
        _inline_flatten_types.append({'name': _t, 'fields': _fields})

    # Import targets = union of parent + child + auto-create OTO nested rel targets + selector OTO + reverse OTO + flatten
    all_import_targets = _dedupe_ordered([
        *[r['target'] for r in relationship_targets],
        *[r['target'] for r in child_rels_early],
        *oto_child_rel_targets,
        *[r['target'] for r in _selector_oto_early],
        *[r['target'] for r in _reverse_oto_early],
        *_flatten_non_detail_targets,
    ])
    import_targets = [t for t in all_import_targets if t != model]

    # XxxOption types — parent rels (including selector OTO) whose target is not the model (deduplicated)
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
            # When this child's type is declared inline, its FK targets are
            # referenced as types inside this file — they must be imported.
            for rel in child_rels:
                if rel.target != model and rel.target not in import_targets:
                    import_targets.append(rel.target)

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
    # For bridge-child entities (new-form x-bridge), include bridge parent targets in FormUpsertProps
    x_bridge = model_def.get('x-bridge')
    bridge_parent_targets = (
        [p.get('target') for p in (x_bridge.get('parents') or []) if p.get('target')]
        if isinstance(x_bridge, dict)
        else []
    )
    for _bpt in bridge_parent_targets:
        if _bpt != model and _bpt not in import_targets:
            import_targets.append(_bpt)
    all_option_targets = _dedupe_ordered([
        *m2m_targets,
        *optional_fk_list_targets,
        *[r.target for r in parent_rels],
        *child_rel_targets,
        *bridge_parent_targets,
    ])

    # Auto-create OTO rels with nested children (for types + display)
    # Selector OTO rels are already handled via parent_rels above
    one_to_one_rels: list[OneToOneRelInfo] = []
    for oto in _auto_create_oto_early:
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

    # Reverse OTO rels for template rendering
    reverse_oto_rels = [
        ReverseOtoRelInfo(
            prop_name=r['prop_name'],
            relation_name=r.get('relation_name', r['prop_name']),
            target=r['target'],
            label_field=r['label_field'],
            label_field_is_date=r.get('label_field_is_date', False),
        )
        for r in _reverse_oto_early
    ]

    # Flatten rels for type generation (non-m2o ones need new optional fields in CheckupDetail)
    flatten_rels = [
        FlattenRelInfo(
            prop_name=r['prop_name'],
            relation_name=r.get('relation_name', r['prop_name']),
            target=r['target'],
            is_m2o=r['is_m2o'],
        )
        for r in _flatten_rels_raw
    ]

    # Custom view/edit components from x-custom-components config (entity-level, list).
    _xcc_list_raw = schema['definitions'].get(def_key, {}).get('x-custom-components') or []
    if not isinstance(_xcc_list_raw, list):
        raise ValueError(
            f"x-custom-components on '{def_key}' must be a list of component objects; "
            f"got {type(_xcc_list_raw).__name__}"
        )
    entity_view_components: list[dict] = []
    entity_edit_components: list[dict] = []
    for _item in _xcc_list_raw:
        if not isinstance(_item, dict) or not _item.get('name'):
            continue
        _target = _item.get('target') or ['list']
        _entry = {'name': _item['name'], 'path': _item.get('path')}
        if 'view' in _target:
            entity_view_components.append(_entry)
        if 'edit' in _target:
            entity_edit_components.append(_entry)

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
        reverse_oto_rels=reverse_oto_rels,
        flatten_rels=flatten_rels,
        flatten_detail_imports=_flatten_detail_imports,
        inline_flatten_types=_inline_flatten_types,
        entity_view_components=entity_view_components,
        entity_edit_components=entity_edit_components,
        is_bridge_child=isinstance(_x_bridge, dict),
    )
