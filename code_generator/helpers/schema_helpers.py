"""Schema navigation utilities — port of helpers/schema-helpers.ts"""


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


def get_parent_relationships(parent_def: dict) -> list[dict]:
    """Returns many-to-one relationship metadata from a schema definition.
    Each entry: {prop_name, target, label_field, required}"""
    props = parent_def.get('properties', {})
    required = set(parent_def.get('required') or [])
    result = []
    for prop_name, prop in props.items():
        rel = prop.get('x-relationship')
        if not rel or rel.get('type') != 'many-to-one' or not rel.get('target'):
            continue
        if prop_name == 'creator_id':
            continue
        result.append({
            'prop_name': prop_name,
            'target': rel['target'],
            'label_field': rel.get('labelField', 'name'),
            'required': prop_name in required,
        })
    return result
