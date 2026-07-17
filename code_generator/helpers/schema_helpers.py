"""Schema navigation utilities — port of helpers/schema-helpers.ts"""

import re

_DATE_FORMATS = frozenset({'date', 'date-time', 'time'})
_SYSTEM_FIELDS = frozenset({'id', 'created_at', 'updated_at', 'creator_id', 'updater_id'})


def is_string_prop(prop: dict) -> bool:
    t = prop.get('type')
    if isinstance(t, str):
        return t == 'string'
    if isinstance(t, list):
        return 'string' in t and all(v in ('string', 'null') for v in t)
    return False


def derive_text_fields(properties: dict) -> list[str]:
    """Auto-derive searchable text fields from entity properties.

    Excludes noise (id, FK, enum, CUID pattern, date/uri format, write-only)
    and per-field opt-outs (x-search: false). Shared by the pg_trgm/pg_bigm
    full-text search context (generate.py) and the per-entity
    searchXxxOptions autocomplete filter (build_context.py) so both derive
    the same set of human-readable text columns from a single rule.
    """
    result = []
    for field_name, prop in properties.items():
        if not isinstance(prop, dict):
            continue
        if not is_string_prop(prop):
            continue
        # id and explicit primary key
        if field_name == 'id' or prop.get('x-primary'):
            continue
        # FK fields: x-relationship annotation or *_id naming convention
        if prop.get('x-relationship') or field_name.endswith('_id'):
            continue
        # enum values (integer or string)
        if isinstance(prop.get('enum'), list):
            continue
        # CUID/ID pattern strings
        pattern = prop.get('pattern', '')
        if pattern and re.search(r'\^c\[a-z0-9\]', pattern):
            continue
        # Non-text formats
        if prop.get('format') in ('date', 'date-time', 'time', 'uri'):
            continue
        # Write-only fields (e.g. password, api_key)
        xc = prop.get('x-custom-component', {})
        if isinstance(xc, dict) and 'upsert' in (xc.get('target') or []):
            continue
        # Per-field opt-out
        if prop.get('x-search') is False:
            continue
        result.append(field_name)
    return result


def derive_searchable_relation_fields(properties: dict) -> list[dict]:
    """FK relation fields opted into cross-relation substring search.

    A property with `x-relationship.searchField: <name>` contributes a
    `{relation, field}` pair so the generated searchXxxOptions getter can
    additionally match rows by a field on the related entity (e.g. inventory
    matching by its product's name), via a one-hop Prisma nested `where`.
    Opt-in (schema-driven) — no relation is joined into search unless
    explicitly marked, so existing autocomplete behaviour is unaffected.
    """
    result = []
    for field_name, prop in properties.items():
        if not isinstance(prop, dict):
            continue
        rel = prop.get('x-relationship') or {}
        search_field = rel.get('searchField')
        if not search_field or not rel.get('target'):
            continue
        relation_name = field_name.removesuffix('_id') if field_name.endswith('_id') else field_name
        result.append({'relation': relation_name, 'field': search_field})
    return result


def _get_entity_base_props(entity: str, schema: dict) -> dict:
    """Returns the base (non-detail) properties for an entity, resolving allOf if needed."""
    defn = schema['definitions'].get(entity, {})
    if 'properties' in defn:
        return defn['properties']
    for item in defn.get('allOf', []):
        if 'properties' in item:
            return item['properties']
    return {}


def _label_field_is_date(label_field, target: str, schema: dict) -> bool:
    """Returns True if the label_field's first path resolves to a date/time field.

    `label_field` may be a single field name, a dotted path through outbound
    m2o / one-to-one relations, or a list of either. For the legacy callers
    that gate downstream behaviour on a single boolean (e.g. test helpers
    reading `dep.label_field_is_date`), True is returned when the FIRST path
    in the labelField ends on a date/time field.
    """
    # Local import to avoid a circular dependency between this module and
    # label_field — the label_field helper imports nothing from here.
    from helpers.label_field import first_label_format
    return first_label_format(label_field, target, schema) in _DATE_FORMATS


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


def get_approval_lines_props(parent_def: dict, model: str, schema: dict) -> list[str]:
    """Embedded-line properties whose approvable_id must be pre-created before
    the parent create/update (nested-create can't back-fill a NOT NULL FK).

    Two independent schema signals feed this, and both need identical
    treatment (see docs/receiving-approval-backfill-design.md §5.2 — D2):
    - explicit `x-approval-lines: [prop, ...]` (e.g. receiving_receipt.lines)
    - `x-reservation` with `transaction.strategy: ledger_transaction` whose
      *lines entity itself declares `x-approval`* (e.g. purchase_order.items
      -> purchase_per_item) — its lines carry their own approvable per-line
      just like x-approval-lines children, so they're folded into the same
      list rather than duplicating the pre-create/post-create machinery.

      The x-approval gate matters: ledger_transaction is also used (in tests,
      and potentially future schemas) for reservation lines that carry no
      approval at all — those must NOT get approvable_id injected into a
      nested-create/update body that has no such column.
    """
    props = list(parent_def.get('x-approval-lines') or [])
    xres = parent_def.get('x-reservation') or {}
    if (xres.get('transaction') or {}).get('strategy') == 'ledger_transaction':
        lines_prop = xres.get('lines')
        if lines_prop and lines_prop not in props:
            detail_props = get_detail_properties(model, schema) or {}
            ref = ((detail_props.get(lines_prop) or {}).get('items') or {}).get('$ref', '')
            lines_entity = ref.rsplit('/', 1)[-1]
            if lines_entity and (schema.get('definitions', {}).get(lines_entity) or {}).get('x-approval'):
                props.append(lines_prop)
    return props


def get_splittable_bridge_field(entity_def: dict) -> str:
    """The property name on an x-splittable entity that holds its per-child
    ledger/reservation bridge FK (e.g. purchase_per_item / receiving_receipt_line's
    inventory_transactionable_id).

    Config-driven via x-splittable.bridgeField, defaulting to
    'inventory_transactionable_id' — the two current x-splittable entities
    reach this field through different parent-side mechanisms (purchase_order's
    x-reservation.transaction.strategy: ledger_transaction vs. receiving_receipt's
    plain x-approval-lines + receiving_receipt_line's own x-ledger-source), so
    there is no single reverse lookup that resolves it for both; the entity's
    own x-splittable config is the one place both agree to declare it (cmd_312
    Phase1, see queue/reports/subtask_312a_ashigaru3.yaml for why the more
    "principled" x-reservation reverse-lookup was rejected — it silently
    dropped the bridge for receiving_receipt_line, which has no x-reservation
    on its parent at all).
    """
    split_cfg = entity_def.get('x-splittable')
    split_dict = split_cfg if isinstance(split_cfg, dict) else {}
    return split_dict.get('bridgeField', 'inventory_transactionable_id')


def resolve_ledger_domain(schema: dict, domain_key: str) -> dict:
    """Resolve x-ledger-entities[domain_key] to {pool, ledger, transactionable}.

    OD-1 underlying idea: config required, no defaults. Raises ValueError if
    the domain or any of its required keys is not declared in the schema.
    """
    domains = schema.get('x-ledger-entities') or {}
    if domain_key not in domains:
        raise ValueError(f"x-ledger-entities.{domain_key!r} not declared in schema")
    domain = domains[domain_key]
    for required_key in ('pool', 'ledger', 'transactionable'):
        if required_key not in domain:
            raise ValueError(f"x-ledger-entities.{domain_key!r}.{required_key!r} is required")
    return {
        'pool': domain['pool'],
        'ledger': domain['ledger'],
        'transactionable': domain['transactionable'],
    }


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

    Excludes system fields and back-references to the parent. Arrays of
    `$ref` items are surfaced with `is_array: True` so the renderer can
    show them as a read-only list inline in the accordion (e.g., a
    `pre_check_detail.symptoms` array shown inside the `pre_check` section
    of `checkup`'s form).
    """
    fields = []
    for field_name, prop in target_props.items():
        if field_name in _SYSTEM_FIELDS:
            continue
        prop_type = prop.get('type')

        # Array of $ref → render as a read-only list of item labels.
        if prop_type == 'array':
            items = prop.get('items', {}) if isinstance(prop.get('items'), dict) else {}
            ref = items.get('$ref', '')
            if not ref:
                continue
            item_target = ref.split('/')[-1]
            fields.append({
                'name': field_name,
                'prop_type': 'array',
                'is_array': True,
                'item_target': item_target,
                'is_fk': False,
                'format': None,
                'nullable': True,
                'enum': None,
            })
            continue

        # Plain $ref to another entity (no `type`, no `x-relationship`).
        # In a *_detail extension, these typically point back at the parent
        # (e.g., pre_check_detail.checkup → "#/definitions/checkup") and
        # are self-evident in the parent's form. Skip them.
        if '$ref' in prop and not prop_type:
            ref_target = prop['$ref'].split('/')[-1]
            if ref_target == parent_model or ref_target == f'{parent_model}_detail':
                continue
            # Forward-reference to a different entity inside a detail
            # extension — out of scope for inline accordion rendering today.
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


def _get_flatten_target_props(target: str, schema: dict) -> dict:
    """Return displayable properties for a flatten target.

    Plain entity (`pre_check`): returns `properties`.
    Detail entity (`pre_check_detail` = allOf[base $ref, {properties}]):
        returns the *merge* of base.properties and the extension's
        properties so flatten rendering sees both the inherited fields
        (e.g., `ams_score` from `pre_check`) and the extension's added
        ones (e.g., `symptoms` array, `checkup` back-ref).

    Order in the merge: base first, then extension overrides — extension
    properties shadow same-name base properties, mirroring JSON Schema
    semantics for allOf merging.

    Compare with `_get_entity_base_props`, which only returns one block at
    a time (the first one it finds). That helper has callers that
    *deliberately* want just the base — keep it; flatten uses this one.
    """
    defn = schema['definitions'].get(target, {})
    if 'properties' in defn:
        return defn['properties']

    merged: dict = {}
    for item in defn.get('allOf', []):
        if '$ref' in item:
            base_target = item['$ref'].split('/')[-1]
            base_def = schema['definitions'].get(base_target, {})
            if 'properties' in base_def:
                merged = {**merged, **base_def['properties']}
            else:
                # Nested allOf (rare) — recurse one level.
                for nested in base_def.get('allOf', []):
                    if 'properties' in nested:
                        merged = {**merged, **nested['properties']}
        elif 'properties' in item:
            merged = {**merged, **item['properties']}
    return merged


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
        # Use the merged (base + detail) properties so a `_detail` target
        # surfaces both inherited scalar fields (ams_score) and the
        # extension's additions (symptoms array).
        target_props = _get_flatten_target_props(target, schema)
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


def find_fk_derivation_path(parent: str, parent_def: dict, target_q: str, schema: dict) -> dict | None:
    """Walk the parent's m2o/o2o FKs to find a way to derive a value of target_q's id.

    Used by the service generator when a flatten OTO target carries an external
    required FK (e.g. lifestyle has required `patient_id` while it lives flatten-
    inside `checkup`). The form does not ask the user for that FK — instead the
    service must derive it from data the parent already has.

    Walk depth = 2 (direct + one hop):
      * direct  : parent has its own m2o/o2o FK pointing to `target_q`.
      * one_hop : parent has FK to entity X, and X has a m2o/o2o FK to `target_q`.

    Returns dict {kind, parent_fk, parent_fk_var, intermediate, intermediate_fk}
    or None if no path exists. The caller emits the appropriate Prisma query
    against the resolved path.
    """
    parent_rels = get_parent_relationships(parent_def, schema)

    # Direct path — parent itself has an FK to target_q.
    for rel in parent_rels:
        if rel['target'] == target_q:
            return {
                'kind': 'direct',
                'parent_fk': rel['prop_name'],
                'intermediate': None,
                'intermediate_fk': None,
            }

    # One-hop path — parent → X → target_q.
    for rel in parent_rels:
        x_def = schema['definitions'].get(rel['target'], {})
        if not x_def:
            continue
        for x_rel in get_parent_relationships(x_def, schema):
            if x_rel['target'] == target_q:
                return {
                    'kind': 'one_hop',
                    'parent_fk': rel['prop_name'],
                    'intermediate': rel['target'],
                    'intermediate_fk': x_rel['prop_name'],
                }

    return None
