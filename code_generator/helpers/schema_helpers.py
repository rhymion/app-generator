"""Schema navigation utilities — port of helpers/schema-helpers.ts"""

_DATE_FORMATS = frozenset({'date', 'date-time', 'time'})
_SYSTEM_FIELDS = frozenset({'id', 'created_at', 'updated_at', 'creator_id', 'updater_id'})


def _get_entity_base_props(entity: str, schema: dict) -> dict:
    """Returns the base (non-detail) properties for an entity, resolving allOf if needed."""
    defn = schema['definitions'].get(entity, {})
    if 'properties' in defn:
        return defn['properties']
    for item in defn.get('allOf', []):
        if 'properties' in item:
            return item['properties']
    return {}


def _label_field_is_date(label_field: str, target: str, schema: dict) -> bool:
    """Returns True if the label_field on the target entity has a date/time format."""
    props = _get_entity_base_props(target, schema)
    return props.get(label_field, {}).get('format') in _DATE_FORMATS


def get_detail_properties(parent: str, schema: dict, detail_key: str | None = None) -> dict | None:
    key = detail_key or f'{parent}_detail'
    defn = schema['definitions'].get(key)
    if not defn:
        return None
    if 'properties' in defn:
        return defn['properties']
    for item in defn.get('allOf', []):
        if 'properties' in item:
            return item['properties']
    return None


def get_detail_relation_name(parent: str, target: str, schema: dict, detail_key: str | None = None) -> str:
    """Resolves the property name that $ref-s to `target` in the detail definition.
    e.g. for target='organization', finds 'organization' property with $ref: '#/definitions/organization'
    Falls back to target name if not found."""
    properties = get_detail_properties(parent, schema, detail_key)
    if not properties:
        return target
    for prop_name, prop in properties.items():
        ref = prop.get('$ref', '')
        if ref and ref.split('/')[-1] == target:
            return prop_name
    return target


def filter_fields(properties: dict, fields: list[str] | None = None) -> dict:
    """If fields whitelist is given, keep only those + id/timestamps. Otherwise return all."""
    if not fields:
        return properties
    allowed = set(fields) | {'id', 'created_at', 'updated_at', 'creator_id'}
    return {k: v for k, v in properties.items() if k in allowed}


def is_optional_fk_to_parent(child_def: dict, parent_model: str) -> bool:
    """Return True if the child's structural FK to parent_model is nullable.

    Uses get_parent_fk_props to find the actual parent FK column (convention-first),
    so a secondary x-relationship FK pointing to the same entity is not confused
    with the structural parent link.
    """
    fk_props = get_parent_fk_props(child_def, parent_model)
    props = child_def.get('properties', {})
    for fk_prop in fk_props:
        prop_def = props.get(fk_prop)
        if prop_def is not None:
            t = prop_def.get('type')
            return isinstance(t, list) and 'null' in t
    return False  # FK not found or not nullable → treat as mandatory


def get_parent_fk_props(child_def: dict, parent_model: str) -> set[str]:
    """Find the FK property (or properties) in child_def that represent the structural
    parent-to-child link — i.e. the column the parent uses to own/embed this child.

    Priority:
    1. The conventional '{parent_model}_id' field, if it exists on the child.
       This is the Prisma-style implicit FK and is often NOT annotated with
       x-relationship (which is reserved for additional relationship dropdowns).
    2. Fallback: scan x-relationship annotations for target == parent_model.
       Used when the child genuinely uses a non-conventional FK name.
    3. Last resort: return {'{parent_model}_id'} as the assumed convention even if
       the field was not found (preserves old behaviour for schema edge cases).

    NOTE: do NOT return x-relationship FKs when the conventional field already
    exists — a field like 'reference_id' may point to the same parent entity for
    a different purpose and must not be treated as the structural parent FK.
    """
    props = child_def.get('properties', {})
    convention = f'{parent_model}_id'
    if convention in props:
        return {convention}
    # Conventional field absent — scan for an annotated FK to this parent
    found = {
        prop_name
        for prop_name, prop in props.items()
        if (prop.get('x-relationship') or {}).get('target') == parent_model
    }
    return found or {convention}


def get_one_to_one_rels(parent_def: dict, schema: dict) -> list[dict]:
    """Returns outbound one-to-one FK relationship metadata (FK is on this model).

    Recognises two relation types and tags each entry accordingly:
      - 'one-to-one'        → selector OTO (target has own pages, picker UI)
      - 'one-to-one_bridge' → bridge OTO (target auto-created alongside parent,
                              e.g. approvable/commentable; no picker)

    Each entry: {prop_name, relation_name, target, label_field, relation_type,
                 is_selector, nullable, children}.
    'children' = array children of the target's _detail (for nested includes
    and display) — only populated for bridge OTO.
    'is_selector' = True for 'one-to-one', False for 'one-to-one_bridge';
    kept as a convenience so existing callers don't need to switch on the type
    string everywhere.
    'nullable' = True when the FK field itself is nullable."""
    props = parent_def.get('properties', {})
    result = []
    for prop_name, prop in props.items():
        rel = prop.get('x-relationship')
        if not rel or not rel.get('target'):
            continue
        relation_type = rel.get('type')
        if relation_type not in ('one-to-one', 'one-to-one_bridge'):
            continue
        target = rel['target']
        relation_name = prop_name[:-3] if prop_name.endswith('_id') else prop_name
        label_field = rel.get('labelField', 'name')

        is_selector = relation_type == 'one-to-one'

        # Determine if FK is nullable
        prop_type = prop.get('type')
        nullable = isinstance(prop_type, list) and 'null' in prop_type

        # Collect array children from the target's _detail definition (only for bridge OTO).
        # Selector OTO has no nested children rendered through this list — its target has its
        # own pages and uses regular m2o/list rendering.
        children = []
        if not is_selector:
            target_detail = schema['definitions'].get(f'{target}_detail', {})
            target_detail_props = {}
            if 'properties' in target_detail:
                target_detail_props = target_detail['properties']
            else:
                for item in target_detail.get('allOf', []):
                    if 'properties' in item:
                        target_detail_props = item['properties']
                        break
            for cp_name, cp in target_detail_props.items():
                if cp.get('type') == 'array' and (cp.get('items') or {}).get('$ref'):
                    child_name = cp['items']['$ref'].split('/')[-1]
                    child_def = schema['definitions'].get(child_name, {})
                    child_rels = get_parent_relationships(child_def)
                    children.append({
                        'property_name': cp_name,
                        'child_name': child_name,
                        'child_rels': child_rels,
                        'child_def': child_def,
                    })

        result.append({
            'prop_name': prop_name,
            'relation_name': relation_name,
            'target': target,
            'label_field': label_field,
            'label_field_is_date': _label_field_is_date(label_field, target, schema),
            'relation_type': relation_type,
            'is_selector': is_selector,
            'nullable': nullable,
            'children': children,
        })
    return result


def _get_first_label_field(target: str, schema: dict) -> str:
    """Returns the first non-id/non-timestamp/non-fk simple field of target entity."""
    _SKIP = {'id', 'created_at', 'updated_at', 'creator_id', 'updater_id'}
    props = _get_entity_base_props(target, schema)
    for field_name, prop in props.items():
        if field_name in _SKIP or field_name.endswith('_id'):
            continue
        prop_type = prop.get('type')
        if isinstance(prop_type, list):
            prop_type = next((t for t in prop_type if t != 'null'), None)
        if prop_type in ('string', 'integer', 'number', 'boolean'):
            return field_name
    return 'id'


def _extract_flatten_fields(target_props: dict, parent_model: str) -> list[dict]:
    """Extract field info for flatten accordion display.
    Excludes system fields, back-references to parent, and arrays.
    """
    fields = []
    for field_name, prop in target_props.items():
        if field_name in _SYSTEM_FIELDS:
            continue
        prop_type = prop.get('type')
        if prop_type == 'array':
            continue
        rel = prop.get('x-relationship')
        if rel:
            rel_target = rel.get('target', '')
            if rel_target == parent_model:
                continue  # back-reference to parent — skip
            if rel.get('type') in ('many-to-one', 'one-to-one'):
                nullable = isinstance(prop_type, list) and 'null' in prop_type
                fields.append({
                    'name': field_name,
                    'prop_type': 'string',
                    'format': None,
                    'nullable': nullable,
                    'enum': None,
                    'is_fk': True,
                    'fk_target': rel_target,
                    'fk_label_field': rel.get('labelField', 'name'),
                    'relation_name': field_name.removesuffix('_id'),
                })
                continue
        # Regular field
        nullable = False
        if isinstance(prop_type, list):
            nullable = 'null' in prop_type
            prop_type = next((t for t in prop_type if t != 'null'), 'string')
        fields.append({
            'name': field_name,
            'prop_type': prop_type or 'string',
            'format': prop.get('format'),
            'nullable': nullable,
            'enum': prop.get('enum') if isinstance(prop.get('enum'), list) else None,
            'is_fk': False,
            # Numeric bounds — needed downstream by cypress_create_value so the
            # generated test value respects the schema cap (e.g. lifestyle's
            # quolity_of_sleep has max: 10; emitting '100' would be clipped by
            # the BaseNumberField on input and break the post-save assertion).
            'minimum': prop.get('minimum'),
            'maximum': prop.get('maximum'),
        })
    return fields


def get_flatten_rels(parent: str, parent_def: dict, schema: dict) -> list[dict]:
    """Returns $ref properties from the _detail definition with x-outputType: flatten.

    These are rendered as collapsible accordion sections showing the target entity's fields
    inline in the detail view (read-only). Fields that back-reference the parent are excluded.
    Each entry: {prop_name, relation_name, target, is_m2o, fields}
    """
    detail_props = get_detail_properties(parent, schema)
    if not detail_props:
        return []

    base_props = parent_def.get('properties', {})
    result = []
    for prop_name, prop in detail_props.items():
        if prop.get('x-outputType') != 'flatten':
            continue
        ref = prop.get('$ref', '')
        if not ref or prop.get('type') == 'array':
            continue
        target = ref.split('/')[-1]
        relation_name = prop.get('x-relationName') or prop_name
        is_m2o = f'{prop_name}_id' in base_props
        target_props = _get_entity_base_props(target, schema)
        fields = _extract_flatten_fields(target_props, parent)
        result.append({
            'prop_name': prop_name,
            'relation_name': relation_name,
            'target': target,
            'is_m2o': is_m2o,
            'fields': fields,
        })
    return result


def get_detail_ref_rels(parent: str, parent_def: dict, schema: dict) -> list[dict]:
    """Returns reverse one-to-one relation metadata from a _detail definition.

    These are plain $ref properties in the {parent}_detail extension that have NO
    corresponding FK field in the base model (the FK lives in the target, pointing back).
    Properties with x-outputType: flatten are excluded (handled by get_flatten_rels).
    Each entry: {prop_name, target, label_field}
    """
    detail_props = get_detail_properties(parent, schema)
    if not detail_props:
        return []

    base_props = parent_def.get('properties', {})
    # Many-to-one relation names (derived from FK prop_name by stripping _id)
    m2o_relation_names = {
        r['prop_name'].removesuffix('_id')
        for r in get_parent_relationships(parent_def, schema)
    }
    # Outbound OTO FK prop names (FK is in this model)
    oto_fk_names = {r['prop_name'] for r in get_one_to_one_rels(parent_def, schema)}

    result = []
    for prop_name, prop in detail_props.items():
        ref = prop.get('$ref', '')
        if not ref or prop.get('type') == 'array':
            continue
        # flatten properties are handled separately by get_flatten_rels
        if prop.get('x-outputType') == 'flatten':
            continue
        target = ref.split('/')[-1]
        # Skip if base model has a corresponding FK for this relation
        if f'{prop_name}_id' in base_props:
            continue
        # Skip if already handled as a many-to-one (relation name matches)
        if prop_name in m2o_relation_names:
            continue
        # Skip if the corresponding FK is an outbound OTO
        if f'{prop_name}_id' in oto_fk_names:
            continue
        label_field = prop.get('x-labelField') or _get_first_label_field(target, schema)
        # x-relationName lets the YAML override the Prisma relation name when it differs
        # from the property name (e.g. checkup.judgement vs detail property checkup_judgment)
        relation_name = prop.get('x-relationName') or prop_name
        result.append({
            'prop_name': prop_name,
            'relation_name': relation_name,
            'target': target,
            'label_field': label_field,
            'label_field_is_date': _label_field_is_date(label_field, target, schema),
        })
    return result


def get_parent_relationships(parent_def: dict, schema: dict | None = None) -> list[dict]:
    """Returns selectable FK relationship metadata from a schema definition.
    Each entry: {prop_name, target, label_field, label_field_is_date, required}"""
    props = parent_def.get('properties', {})
    required = set(parent_def.get('required') or [])
    result = []
    for prop_name, prop in props.items():
        rel = prop.get('x-relationship')
        if not rel or rel.get('type') not in ('many-to-one', 'one-to-one') or not rel.get('target'):
            continue
        if prop_name == 'creator_id':
            continue
        target = rel['target']
        lf = rel.get('labelField', 'name')
        result.append({
            'prop_name': prop_name,
            'target': target,
            'label_field': lf,
            'label_field_is_date': _label_field_is_date(lf, target, schema) if schema else False,
            'required': prop_name in required,
        })
    return result
