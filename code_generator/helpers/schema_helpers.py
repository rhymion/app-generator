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
    """Return True if the child's FK to parent_model is nullable (optional relationship)."""
    for prop_def in child_def.get('properties', {}).values():
        rel = prop_def.get('x-relationship', {})
        if rel.get('target') == parent_model:
            t = prop_def.get('type')
            return isinstance(t, list) and 'null' in t
    return False  # FK not found or not nullable → treat as mandatory


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
