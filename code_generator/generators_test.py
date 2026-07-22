"""
generators_test.py — Cypress E2E test code generation.

Builds Jinja2 template contexts for:
  - cypress/support/{entity}/helper.ts  (Prisma data population helpers)
  - cypress/e2e/{entity}.cy.ts          (E2E test spec)
  - cypress/support/generated-tasks.ts  (task registry for cypress.config.ts)
  - cypress/e2e/api/{entity}.cy.ts      (API test spec)
"""
import re

# Messages Fields namespace for enum label translation.
# Populated by set_messages_fields() before generating test specs.
_messages_fields: dict = {}


def set_messages_fields(fields: dict) -> None:
    """Register the Fields namespace from messages/en.json for enum label lookup."""
    global _messages_fields
    _messages_fields = fields


# Full message namespaces (e.g. DayOfWeek, ShiftStatus) for enum label lookup when
# a field declares x-enum-namespace. Populated by set_messages_namespaces().
_messages_ns: dict = {}


def set_messages_namespaces(messages: dict) -> None:
    """Register all message namespaces from messages/en.json for enum label lookup."""
    global _messages_ns
    _messages_ns = messages or {}


def _enum_ns_key(value) -> str:
    """Translation key for an enum value within its namespace.

    Must match the key FormUpsert/FormView emit (generators.py): a string label is
    lower-cased on its first character; numeric values are used verbatim.
    """
    s = str(value)
    if isinstance(value, str) and not s.lstrip('-').isdigit():
        return s[0].lower() + s[1:]
    return s


def _enum_label(field: dict, value) -> str:
    """Resolve the displayed label for an enum value, honoring x-enum-namespace.

    When the field declares a namespace, look the value up there (matching the
    rendered Autocomplete option label); otherwise fall back to the Fields key
    `<prop>_<value>` and finally the raw value.
    """
    ns = field.get('enum_namespace')
    if ns:
        return _messages_ns.get(ns, {}).get(_enum_ns_key(value), str(value))
    if _messages_fields:
        return _messages_fields.get(f"{field['prop_name']}_{value}", str(value))
    return str(value)

from helpers.naming import (
    to_camel_case, to_pascal_case, to_title_case, safe_var_name, singularize,
)
from helpers.schema_helpers import (
    filter_fields,
    get_parent_relationships,
    is_optional_fk_to_parent,
    get_flatten_rels,
    get_splittable_bridge_field,
    resolve_ledger_domain,
    get_internal_bridge_fk_prop_names,
    derive_text_fields,
)
from helpers.bridge_direction import get_new_form_bridge
from helpers.label_field import (
    build_label_expression, render_prisma_include, resolve_label_paths, relation_chain_targets,
    build_string_only_label_expression,
)
from build_context import _get_entity_options
from generate_types import extract_entities


def _readonly_field_names(model_def: dict) -> set[str]:
    """Fields marked read-only via x-readonly-fields (entity) or x-readonly (per field).

    Such fields render as non-editable text in the form, so UI tests must not try
    to fill or clear them (the helper would fail typing into a read-only input).
    """
    ro = set(model_def.get('x-readonly-fields') or [])
    ro |= {k for k, v in (model_def.get('properties') or {}).items()
           if isinstance(v, dict) and v.get('x-readonly')}
    return ro


def _safe_entity_opts(opts: list, schema: dict) -> list:
    """Return entity options filtered to prefer non-test entities.

    When an entity_select field's test data uses the same entity name as a
    record created by grantAllEntityPermissions (which creates one permission
    per ALL_ENTITIES entity for the Administrator role), the uniqueness
    constraint (name, role_id) causes test failures.  Picking an entity that
    is not a test entity avoids that conflict.
    """
    test_names = {e['parent'] for e in extract_entities(schema) if e['generate_config'].get('test')}
    safe = [o for o in opts if o['value'] not in test_names]
    return safe if safe else opts


# ---------------------------------------------------------------------------
# Child naming helpers (port of getChildNames from child-helpers.ts)
# ---------------------------------------------------------------------------

def get_child_names(child: dict) -> dict:
    property_name = child['property_name']
    var_name = safe_var_name(property_name)
    pascal_name = to_pascal_case(property_name)
    return {
        'var_name': var_name,
        'pascal_name': pascal_name,
        'singular_var_name': singularize(var_name),
        'singular_pascal_name': singularize(pascal_name),
        'title': to_title_case(property_name),
        'form_key': singularize(property_name),
        'columns_fn_name': f'use{to_pascal_case(property_name)}Columns',
    }


# ---------------------------------------------------------------------------
# Dependency resolution
# ---------------------------------------------------------------------------

def _get_primary_display_field_name(model_def: dict) -> str | None:
    """Returns the primary display field name from x-display.table, or None."""
    table = model_def.get('x-display', {}).get('table', [])
    for item in table:
        for field_name, cfg in item.items():
            if cfg.get('primary'):
                return field_name
    return None


def _get_base_properties(defn: dict) -> dict:
    if 'properties' in defn:
        return defn['properties']
    for item in defn.get('allOf', []):
        if 'properties' in item:
            return item['properties']
    return {}


def _seed_relation_label_value(
    target: str,
    label_field,
    label_field_is_date: bool,
    schema: dict,
    *,
    unique_index: int | None = None,
) -> str:
    """Expected UI label for a populated FK target.

    `label_field` may be a single field name, a dotted path through outbound
    m2o / one-to-one relations, or a list of either — mirroring what the UI
    renders via `formatLabelValue` / nested-relation access. List-form labels
    are concatenated with a single space, matching `build_label_expression`.

    Date-typed final fields are rendered as `YYYY-MM-DD` to match
    `formatLabelValue('date')` in `lib/_format.ts`. The legacy `M/D/YYYY` form
    (from `toLocaleDateString('en-US')`) was incorrect after the format
    change.
    """
    # Resolve every path so list-form labels concatenate to the same string the
    # UI displays; bare strings are handled too (single-element list).
    try:
        resolved = resolve_label_paths(label_field, target, schema)
    except ValueError:
        resolved = []
    if resolved:
        parts = []
        for r in resolved:
            parts.append(_seed_path_part(target, r, schema, unique_index=unique_index))
        return ' '.join(parts)

    # Fallback for callers that pass a missing/unknown label_field — keep the
    # date short-circuit working off the legacy boolean.
    if label_field_is_date:
        day = unique_index if unique_index is not None else 1
        return f'2025-01-{day:02d}'
    title = to_title_case(label_field) if isinstance(label_field, str) else 'Item'
    return f'Test {title} {unique_index}' if unique_index is not None else f'Test {title}'


def _seed_path_part(
    target: str,
    resolved_path: dict,
    schema: dict,
    *,
    unique_index: int | None,
) -> str:
    """Expected UI value of a single resolved labelField path on the target row.

    Mirrors `_get_dep_populate_fields` and `_seed_relation_label_value`'s old
    scalar branches, but now handles dotted paths (e.g. `patient_rel.patient.name`)
    by walking the relation chain to find the entity that owns the final field.
    """
    segments = resolved_path['segments']
    final_format = resolved_path['final_format']

    # Walk the relation chain FIRST — needed for nullable check below.
    cursor_entity = target
    for seg in segments[:-1]:
        rels = {}
        for prop_name, prop in _get_base_properties(schema['definitions'].get(cursor_entity, {})).items():
            if not isinstance(prop, dict):
                continue
            rel = prop.get('x-relationship') or {}
            if rel.get('type') in ('many-to-one', 'one-to-one', 'one-to-one_bridge'):
                key = prop_name.removesuffix('_id') if prop_name.endswith('_id') else prop_name
                rels[key] = rel.get('target')
        cursor_entity = rels.get(seg) or cursor_entity
    final_field = segments[-1]
    leaf_def = schema['definitions'].get(cursor_entity, {})
    label_prop = _get_base_properties(leaf_def).get(final_field, {})

    # nullable non-required field → not set by fixture → null → '' in UI.
    # Must run BEFORE format-specific early returns so nullable date fields
    # (e.g. expiration_date: type=[string,null], format=date, not in required)
    # return '' rather than a fabricated date string.
    leaf_required = set(leaf_def.get('required') or [])
    if final_field not in leaf_required:
        _ptype_raw = label_prop.get('type')
        _ptypes = _ptype_raw if isinstance(_ptype_raw, list) else ([_ptype_raw] if _ptype_raw else [])
        if 'null' in _ptypes:
            return ''

    # Dates: the UI formats with formatLabelValue → YYYY-MM-DD / HH:mm / YYYY-MM-DD HH:mm.
    # Only reached for required (non-nullable) date fields.
    if final_format == 'date':
        day = unique_index if unique_index is not None else 1
        return f'2025-01-{day:02d}'
    if final_format == 'time':
        return '09:00'
    if final_format == 'date-time':
        day = unique_index if unique_index is not None else 1
        return f'2025-01-{day:02d} 09:00'

    prop_type_raw = label_prop.get('type')
    prop_type = next((t for t in prop_type_raw if t != 'null'), None) if isinstance(prop_type_raw, list) else prop_type_raw

    if final_field == 'name':
        title = to_title_case(cursor_entity)
        return f'Test {title} {unique_index}' if unique_index is not None else f'Test {title}'
    if prop_type == 'string':
        title = to_title_case(final_field)
        return f'Test {title} {unique_index}' if unique_index is not None else f'Test {title}'
    if prop_type in ('integer', 'number'):
        return str(unique_index * 100) if unique_index is not None else str(label_prop.get('minimum', 0))
    if prop_type == 'boolean':
        return 'false'
    title = to_title_case(final_field)
    return f'Test {title} {unique_index}' if unique_index is not None else f'Test {title}'


def _get_dep_populate_fields(target: str, var_name: str, title: str, schema: dict) -> list[dict]:
    """Compute extra_required_fields for a dep record in populateDependencies.

    Uses title-based name (e.g. 'Test Parent', 'Test Assignee') and encodes
    user_account email/password so the template needs no user_account special-casing.
    """
    if target == 'user':
        return [
            {'prop_name': 'name', 'prisma_val': f"'Test {title}'", 'prisma_val_unique': f'`Test {title} ${{i}}`', 'prisma_val_second': f"'Test {title} 2'"},
            {'prop_name': 'email', 'prisma_val': f'`test-{var_name}-${{Date.now()}}@example.com`', 'prisma_val_unique': f'`test-{var_name}-${{Date.now()}}-${{i}}@example.com`', 'prisma_val_second': f'`test-{var_name}-${{Date.now()}}-2@example.com`'},
            {'prop_name': 'password', 'prisma_val': "'test-password'", 'prisma_val_unique': "'test-password'", 'prisma_val_second': "'test-password'"},
        ]
    dep_def = schema['definitions'].get(target)
    if not dep_def:
        return []
    props = dep_def.get('properties', {})
    required = set(dep_def.get('required') or [])
    rel_props = {r['prop_name'] for r in get_parent_relationships(dep_def)}
    oto_props = {
        k for k, v in props.items()
        if (v.get('x-relationship') or {}).get('type') in ('one-to-one', 'one-to-one_bridge')
    }
    # Also exclude inferred-internal FK fields (required _id → internal-only entity,
    # no x-relationship). These are handled by get_all_internal_fk_deps instead.
    _inferred_internal = set()
    for _pn, _pp in props.items():
        if not _pn.endswith('_id') or _pp.get('x-relationship') or _pn not in required:
            continue
        _it = _pn[:-3]
        if _it in (schema.get('definitions') or {}):
            _dtl = (schema.get('definitions') or {}).get(f'{_it}_detail', {})
            _g = _dtl.get('x-generate') or {}
            if _g and not any(_g.get(k) for k in ('api', 'test', 'list', 'view', 'new', 'edit', 'delete')):
                _inferred_internal.add(_pn)
    exclude = {'id', 'created_at', 'updated_at', 'creator_id', 'updater_id'} | rel_props | oto_props | _inferred_internal
    _entity_opts = _get_entity_options(schema)
    _first_entity_val = f"'{_entity_opts[0]['value']}'" if _entity_opts else "''"
    result = []
    for prop_name, prop in props.items():
        if prop_name not in required or prop_name in exclude:
            continue
        prop_type_raw = prop.get('type')
        actual = next((t for t in prop_type_raw if t != 'null'), None) if isinstance(prop_type_raw, list) else prop_type_raw
        fmt = prop.get('format')
        if prop_name == 'name':
            val = f"'Test {title}'"
            val_unique = f'`Test {title} ${{i}}`'
            val_second = f"'Test {title} 2'"
        elif actual == 'string' and prop.get('x-entity-select'):
            val = val_unique = val_second = _first_entity_val
        elif actual == 'string' and fmt == 'date':
            val = 'new Date(Date.UTC(2025, 0, 1)).toISOString()'
            val_unique = 'new Date(Date.UTC(2025, 0, i)).toISOString()'
            val_second = 'new Date(Date.UTC(2025, 0, 2)).toISOString()'
        elif actual == 'string' and fmt in ('date-time', 'time'):
            val = 'new Date(2025, 0, 1).toISOString()'
            val_unique = 'new Date(2025, 0, i).toISOString()'
            val_second = 'new Date(2025, 0, 2).toISOString()'
        elif actual == 'string':
            field_title = to_title_case(prop_name)
            # Deterministic, human-readable values. Dep-helper-call collisions
            # on @unique fields (e.g. product.code) are avoided at a different
            # layer: populateXxxDependencies is rendered idempotently by the
            # test_helper template (see `dep_lookup_field` / find-or-create).
            # Within a populate(N) loop, ${i} provides intra-loop uniqueness;
            # tests assert on the exact "Test X 1" / "Test X 2" form.
            val = f"'Test {field_title}'"
            val_unique = f'`Test {field_title} ${{i}}`'
            val_second = f"'Test {field_title} 2'"
        elif actual in ('integer', 'number'):
            mn = prop.get('minimum', 0)
            val = val_unique = str(mn)
            val_second = str(mn)
        elif actual == 'boolean':
            # Booleans must emit a literal `false` / `true`, not a string. The
            # previous fall-through produced `TEST-FOO-${Date.now()}` which
            # Prisma rejects with a type-mismatch error on required boolean
            # columns (e.g. medicine.continuous in dep populators).
            val = val_unique = val_second = 'false'
        else:
            val = f'`TEST-{prop_name.upper()}-${{Date.now()}}`'
            val_unique = f'`TEST-{prop_name.upper()}-${{Date.now()}}-${{i}}`'
            val_second = f'`TEST-{prop_name.upper()}-${{Date.now()}}-2`'
        result.append({'prop_name': prop_name, 'prisma_val': val, 'prisma_val_unique': val_unique, 'prisma_val_second': val_second})
    return result


def _get_dep_extra_required_fields(dep_target: str, schema: dict) -> list[dict]:
    """Return required non-system, non-name, non-FK fields for a dep entity.

    Used to emit extra required fields (e.g. code, price for product) when
    creating the dep record in populateDependencies().
    """
    dep_def = schema['definitions'].get(dep_target)
    if not dep_def:
        return []
    props = dep_def.get('properties', {})
    required = set(dep_def.get('required') or [])
    rel_props = {r['prop_name'] for r in get_parent_relationships(dep_def)}
    oto_props = {
        k for k, v in props.items()
        if (v.get('x-relationship') or {}).get('type') in ('one-to-one', 'one-to-one_bridge')
    }
    exclude = {'id', 'created_at', 'updated_at', 'creator_id', 'updater_id'} | rel_props | oto_props

    _entity_opts = _get_entity_options(schema)
    _first_entity_val = f"'{_entity_opts[0]['value']}'" if _entity_opts else "''"
    result = []
    for prop_name, prop in props.items():
        if prop_name not in required or prop_name in exclude:
            continue
        prop_type = prop.get('type')
        actual = next((t for t in prop_type if t != 'null'), None) if isinstance(prop_type, list) else prop_type
        fmt = prop.get('format')
        if prop_name == 'name':
            val = f"'Test {to_title_case(dep_target)}'"
            val_unique = f'`Test {to_title_case(dep_target)} ${{i}}`'
            val_second = f"'Test {to_title_case(dep_target)} 2'"
        elif actual == 'string' and prop.get('x-entity-select'):
            val = val_unique = val_second = _first_entity_val
        elif actual == 'string' and fmt == 'date':
            val = 'new Date(Date.UTC(2025, 0, 1)).toISOString()'
            val_unique = 'new Date(Date.UTC(2025, 0, i)).toISOString()'
            val_second = 'new Date(Date.UTC(2025, 0, 2)).toISOString()'
        elif actual == 'string' and fmt in ('date-time', 'time'):
            val = 'new Date(2025, 0, 1).toISOString()'
            val_unique = 'new Date(2025, 0, i).toISOString()'
            val_second = 'new Date(2025, 0, 2).toISOString()'
        elif actual == 'string':
            field_title = to_title_case(prop_name)
            val = f"'Test {field_title}'"
            val_unique = f'`Test {field_title} ${{i}}`'
            val_second = f"'Test {field_title} 2'"
        elif actual in ('integer', 'number'):
            mn = prop.get('minimum', 0)
            val = str(mn)
            val_unique = val
            val_second = val
        else:
            val = f'`TEST-{prop_name.upper()}-${{Date.now()}}`'
            val_unique = f'`TEST-{prop_name.upper()}-${{Date.now()}}-${{i}}`'
            val_second = f'`TEST-{prop_name.upper()}-${{Date.now()}}-2`'
        result.append({'prop_name': prop_name, 'prisma_val': val, 'prisma_val_unique': val_unique, 'prisma_val_second': val_second})
    return result


def resolve_dependencies(model_name: str, schema: dict) -> list[dict]:
    """Port of resolveDependencies().

    Returns list of {target, var_name, fk_deps} for all transitive FK
    dependencies (excluding user_account, self, updater_id, assignee_id).
    """
    visited: set[str] = set()
    result: list[dict] = []

    def _resolve(model: str) -> None:
        if model in visited:
            return
        visited.add(model)

        model_def = schema['definitions'].get(model)
        if not model_def or not model_def.get('properties'):
            return

        rels = get_parent_relationships(model_def)
        relevant = [
            r for r in rels
            if r['target'] != 'user'
            and r['target'] != model
            and r['prop_name'] != 'updater_id'
            and r['prop_name'] != 'assignee_id'
        ]

        for rel in relevant:
            _resolve(rel['target'])

        # A transitively-included dependency may itself have a required FK to
        # `user` beyond creator_id/updater_id (e.g. purchase_order.customer_id
        # when purchase_order is pulled in as a dep of purchase_per_item). The
        # top-level entity's own such FKs are handled separately in
        # helper_context's ua_dep_fields block, so this only needs to cover
        # entities reached via recursion (model != model_name) — otherwise
        # that create() call ends up missing a required column.
        user_fk_deps = []
        if model != model_name:
            for r in rels:
                if (r['target'] == 'user'
                        and r.get('required')
                        and r['prop_name'] not in ('creator_id', 'updater_id')):
                    prop_stem = re.sub(r'_id$', '', r['prop_name'])
                    var_name = to_camel_case(prop_stem)
                    if not any(d['target'] == 'user' and d['var_name'] == var_name for d in result):
                        result.append({
                            'target': 'user', 'var_name': var_name,
                            'title': to_title_case(prop_stem), 'fk_deps': [],
                        })
                    user_fk_deps.append({'prop_name': r['prop_name'], 'dep_var_name': var_name})

        if model != model_name and not any(d['target'] == model for d in result):
            fk_deps = [
                {'prop_name': r['prop_name'], 'dep_var_name': to_camel_case(r['target'])}
                for r in relevant
                if any(d['target'] == r['target'] for d in result)
            ] + user_fk_deps
            result.append({'target': model, 'var_name': to_camel_case(model), 'fk_deps': fk_deps})

    _resolve(model_name)
    return result


def get_entity_fk_deps(model_name: str, schema: dict, deps: list[dict]) -> list[dict]:
    """Port of getEntityFkDeps().

    Returns the direct FK deps of model_name that appear in the resolved deps list.
    """
    model_def = schema['definitions'].get(model_name)
    if not model_def:
        return []

    rels = get_parent_relationships(model_def)
    return [
        {'prop_name': r['prop_name'], 'dep_var_name': to_camel_case(r['target'])}
        for r in rels
        if r['target'] != 'user'
        and r['target'] != model_name
        and r['prop_name'] != 'updater_id'
        and r['prop_name'] != 'assignee_id'
        and any(d['target'] == r['target'] for d in deps)
    ]


def _entity_has_updater_id(entity_name: str, schema: dict) -> bool:
    """True if the entity has an updater_id field in the Prisma schema.

    Entities with user-facing pages (detail def with any x-generate flag true,
    or no x-generate = default all true) have updater_id. Leaf entities like
    `comment` (no _detail) or internal bridges (all x-generate false) do not.
    """
    detail_def = (schema.get('definitions') or {}).get(f'{entity_name}_detail', {})
    if not detail_def:
        return False
    gen = detail_def.get('x-generate') or {}
    return not gen or any(gen.get(k) for k in ('api', 'test', 'list', 'view', 'new', 'edit'))


def get_internal_one_to_one_fks(model_name: str, schema: dict) -> list[dict]:
    """Returns outbound bridge OTO FK fields on model_name.

    These are properties with x-relationship.type == 'one-to-one_bridge'
    (e.g. approvable_id, commentable_id). The target is a bridge model that
    the service creates automatically — test helpers must create these
    records directly rather than treating them as user-facing fields.
    """
    model_def = schema['definitions'].get(model_name, {})
    props = model_def.get('properties', {})
    required_fields = set(model_def.get('required', []))
    result = []
    for prop_name, prop in props.items():
        rel = prop.get('x-relationship')
        if not rel or rel.get('type') != 'one-to-one_bridge':
            continue
        target = rel.get('target')
        if not target or target == model_name:
            continue
        if not prop_name.endswith('_id'):
            continue
        # Only include required (non-nullable) FKs — optional FKs can be left null in test data
        if prop_name not in required_fields:
            continue
        var_name = to_camel_case(re.sub(r'_id$', '', prop_name))
        if target == 'user':
            create_data = (
                "{ name: 'Test User', "
                "email: `test-dep-user-${Date.now()}-${Math.random()}@example.com`, "
                "password: 'test-password', "
                "creator_id: testUser.id, "
                "updater_id: testUser.id }"
            )
        else:
            create_data = '{}'
        result.append({'prop_name': prop_name, 'target': target, 'var_name': var_name, 'create_data': create_data})
    return result


def get_all_internal_fk_deps(model_name: str, schema: dict) -> list[dict]:
    """Like get_internal_one_to_one_fks but also includes FK-on-parent bridge FKs.

    For bridge-child entities (x-bridge on entity def): adds {bridge_name}_id.
    For bridge-parent entities (entity appears in another entity's x-bridge.parents): adds {bridge_name}_id.
    """
    deps = list(get_internal_one_to_one_fks(model_name, schema))
    existing_props = {d['prop_name'] for d in deps}

    entity_def = schema.get('definitions', {}).get(model_name, {})
    # Bridge-child: x-bridge on the entity itself
    bridge = entity_def.get('x-bridge')
    if isinstance(bridge, dict) and bridge.get('name'):
        b_name = bridge['name']
        b_prop = f'{b_name}_id'
        if b_prop not in existing_props:
            deps.append({'prop_name': b_prop, 'target': b_name,
                         'var_name': to_camel_case(b_name), 'create_data': '{}',
                         'prisma_include_str': ''})
            existing_props.add(b_prop)

    # Bridge-parent: entity appears in another entity's x-bridge.parents list
    for _ename, _edef in schema.get('definitions', {}).items():
        if not isinstance(_edef, dict):
            continue
        _bridge = _edef.get('x-bridge')
        if not isinstance(_bridge, dict) or not _bridge.get('name'):
            continue
        _b_name = _bridge['name']
        _b_prop = f'{_b_name}_id'
        _is_parent = any(
            (p.get('target') if isinstance(p, dict) else None) == model_name
            for p in (_bridge.get('parents') or [])
        )
        if _is_parent and _b_prop not in existing_props:
            deps.append({'prop_name': _b_prop, 'target': _b_name,
                         'var_name': to_camel_case(_b_name), 'create_data': '{}',
                         'prisma_include_str': ''})
            existing_props.add(_b_prop)

    # Inferred FK: required _id field with no x-relationship whose stripped target
    # is an internal-only entity (all x-generate flags false in the _detail definition).
    # Example: comment.commentable_id has no x-relationship annotation but commentable
    # is internal-only — test helpers must create a real commentable row.
    for _prop_name, _prop in entity_def.get('properties', {}).items():
        if not _prop_name.endswith('_id') or _prop_name in existing_props:
            continue
        if _prop_name not in set(entity_def.get('required', [])):
            continue
        if _prop.get('x-relationship'):
            continue
        _inf_target = _prop_name[:-3]
        if _inf_target not in (schema.get('definitions') or {}):
            continue
        _detail = (schema.get('definitions') or {}).get(f'{_inf_target}_detail', {})
        _gen = _detail.get('x-generate') or {}
        if _gen and not any(_gen.get(k) for k in ('api', 'test', 'list', 'view', 'new', 'edit', 'delete')):
            deps.append({'prop_name': _prop_name, 'target': _inf_target,
                         'var_name': to_camel_case(_inf_target), 'create_data': '{}',
                         'prisma_include_str': ''})
            existing_props.add(_prop_name)

    return deps


# ---------------------------------------------------------------------------
# Field analysis
# ---------------------------------------------------------------------------

def get_field_metas(
    properties: dict,
    required_fields: list,
    relationships: list,
    fields_filter: list | None = None,
    entity_options: list | None = None,
) -> list[dict]:
    """Port of getFieldMetas().

    Returns list of FieldMeta dicts with keys:
      prop_name, label, category, required,
      enum_values, format, dep_target, min, max, entity_options
    """
    filtered = filter_fields(properties, fields_filter)
    # Exclude *able_id FKs with no x-relationship (system-managed internal bridge FKs,
    # e.g. inventory_transactionable_id). Mirrors form_view/column_def exclusions.
    _rel_prop_names = {r['prop_name'] for r in relationships}
    _bridge_fk_keys = {
        pn for pn in filtered
        if pn.endswith('able_id') and pn not in _rel_prop_names
    }
    exclude_keys = {'id', 'created_at', 'updated_at', 'creator_id', 'updater_id'} | _bridge_fk_keys
    metas = []

    for prop_name, prop in filtered.items():
        if prop_name in exclude_keys:
            continue

        base = {
            'prop_name': prop_name,
            'enum_values': None,
            'format': None,
            'dep_target': None,
            'dep_label_field': None,
            'dep_label_field_is_date': False,
            'min': None,
            'max': None,
            'entity_options': None,
        }

        rel = next((r for r in relationships if r['prop_name'] == prop_name), None)
        if rel:
            if rel['target'] == 'user':
                continue
            metas.append({
                **base,
                'label': to_title_case(re.sub(r'_id$', '', prop_name)),
                'category': 'autocomplete',
                'required': prop_name in required_fields,
                'dep_target': rel['target'],
                'dep_label_field': rel.get('label_field', 'name'),
                'dep_label_field_is_date': rel.get('label_field_is_date', False),
            })
            continue

        prop_type_raw = prop.get('type')
        if isinstance(prop_type_raw, list):
            prop_type = next((t for t in prop_type_raw if t != 'null'), None)
        else:
            prop_type = prop_type_raw
        fmt = prop.get('format')

        if prop_type == 'string' and fmt == 'uri':
            continue  # image/file field — skip
        elif prop_type == 'string' and fmt in ('date', 'date-time', 'time'):
            metas.append({
                **base,
                'label': to_title_case(prop_name),
                'category': 'datetime',
                'required': prop_name in required_fields,
                'format': fmt,
            })
        elif prop_type in ('integer', 'number'):
            if prop.get('enum'):
                # Integer field with string enum labels → rendered as Autocomplete select
                metas.append({
                    **base,
                    'label': to_title_case(prop_name),
                    'category': 'enum',
                    'required': prop_name in required_fields,
                    'enum_values': prop.get('enum'),
                    'enum_namespace': prop.get('x-enum-namespace'),
                })
            else:
                metas.append({
                    **base,
                    'label': to_title_case(prop_name),
                    'category': 'number',
                    'required': prop_name in required_fields,
                    'min': prop.get('minimum'),
                    'max': prop.get('maximum'),
                })
        elif prop_type == 'boolean':
            metas.append({
                **base,
                'label': to_title_case(prop_name),
                'category': 'boolean',
                'required': prop_name in required_fields,
            })
        elif prop_type == 'string' and prop.get('x-entity-select') and entity_options:
            metas.append({
                **base,
                'label': to_title_case(prop_name),
                'category': 'entity_select',
                'required': prop_name in required_fields,
                'entity_options': entity_options,
            })
        elif prop_type == 'string' and prop.get('enum'):
            metas.append({
                **base,
                'label': to_title_case(prop_name),
                'category': 'string_enum',
                'required': prop_name in required_fields,
                'enum_values': prop.get('enum'),
                'enum_namespace': prop.get('x-enum-namespace'),
            })
        else:
            metas.append({
                **base,
                'label': to_title_case(prop_name),
                'category': 'text',
                'required': prop_name in required_fields,
                'enum_values': prop.get('enum'),
            })

    return metas


def get_child_render_type(child: dict, schema: dict = None, parent_model_name: str = '') -> str:
    """Port of getChildRenderType()."""
    if child.get('file_type'):
        return 'file'
    rel = child.get('relationship') or {}
    if rel.get('type') == 'many-to-many':
        return 'editable-list-autocomplete'
    if child.get('output_type') == 'list':
        # Optional-FK reverse lists (e.g. children → parent_id) use connect semantics: autocomplete
        if schema is not None:
            child_def = schema['definitions'].get(child['name'], {})
            if is_optional_fk_to_parent(child_def, parent_model_name):
                return 'editable-list-autocomplete'
        return 'editable-list-text'
    if child.get('output_type') == 'comments':
        return 'comments'
    return 'datagrid'


def _child_system_managed_fk_excludes(child_def: dict) -> set[str]:
    """FK-shaped fields on a datagrid child that the UI never collects via plain
    text/select — the service sets them internally (reservation/split/approval
    flows). Excluding them keeps generated full-data e2e tests from calling
    fillDataGridRow with a literal string on a field that requires a real cuid
    (root cause: queue/reports/subtask_294a_gunshi.yaml failure_classification).

    - x-relationship.type == 'one-to-one_bridge' (e.g. approvable_id): the
      generic internal-bridge FK marker used throughout code_generator.
    - the reservation/ledger line-transactionable FK, config-driven via
      x-splittable.bridgeField (cmd_312 Phase1, see
      get_splittable_bridge_field). It intentionally carries no
      x-relationship (inventory_transactionable has no x-generate/pages —
      see build_context.py _child_bridge_excludes and generators.py
      line_txable_f), so — consistent with that existing by-name
      exclusion — it is matched by resolved field name here too.
    - 'parent_id' on x-splittable children (e.g. receiving_receipt_line): the
      self-FK to the pre-split parent row (see generate.py split inherited_fields
      exclusion list, which treats it the same way).
    """
    props = child_def.get('properties') or {}
    excludes = {
        prop_name for prop_name, prop in props.items()
        if isinstance(prop, dict) and (prop.get('x-relationship') or {}).get('type') == 'one-to-one_bridge'
    }
    _bridge_field = get_splittable_bridge_field(child_def)
    if _bridge_field in props:
        excludes.add(_bridge_field)
    if child_def.get('x-splittable') and 'parent_id' in props:
        excludes.add('parent_id')
    return excludes


def analyze_children(children: list, schema: dict, parent_model_name: str) -> list[dict]:
    """Port of analyzeChildren()."""
    result = []
    for child in children:
        render_type = get_child_render_type(child, schema, parent_model_name)
        if render_type == 'file':
            continue

        child_def = schema['definitions'].get(child['name'])
        if not child_def or not child_def.get('properties'):
            continue

        names = get_child_names(child)
        child_required = child_def.get('required') or []
        parent_fk_prop = f'{parent_model_name}_id'

        child_rels = get_parent_relationships(child_def, schema)
        exclude_keys = {'id', parent_fk_prop, 'order'} | _child_system_managed_fk_excludes(child_def)
        child_properties = {k: v for k, v in child_def['properties'].items() if k not in exclude_keys}

        fields = get_field_metas(child_properties, child_required, child_rels)

        result.append({
            'child': child,
            'names': names,
            'render_type': render_type,
            'fields': fields,
            'required_fields': [f for f in fields if f['required']],
            'optional_fields': [f for f in fields if not f['required']],
            'parent_fk_prop': parent_fk_prop,
        })
    return result


# ---------------------------------------------------------------------------
# Test data value generators
# ---------------------------------------------------------------------------

def prisma_value(field: dict, index: str, entity_title: str) -> str:
    """Generate a TypeScript expression for Prisma test data."""
    cat = field['category']
    prop_name = field['prop_name']

    if cat == 'text':
        if prop_name == 'name':
            return f'`{entity_title} ${{{index}}}`'
        if prop_name == 'email':
            # @unique on email columns means we need test-run-unique values.
            # `Date.now()` covers cross-run uniqueness; `${index}` covers
            # in-loop uniqueness.
            return f'`test-${{{index}}}-${{Date.now()}}@example.com`'
        if field.get('enum_values'):
            return f"'{field['enum_values'][0]}'"
        return f'`Test {field["label"]} ${{{index}}}`'

    elif cat == 'entity_select':
        options = field.get('entity_options') or []
        return f"'{options[0]['value']}'" if options else "''"

    elif cat == 'enum':
        # Integer enum: store integer index 0 (first option)
        return '0'

    elif cat == 'string_enum':
        first = next((v for v in (field.get('enum_values') or []) if v is not None), None)
        return f"'{first}'" if first is not None else 'null'

    elif cat == 'number':
        val = f'{index} * 100'
        mn = field.get('min')
        mx = field.get('max')
        if mn is not None and mx is not None:
            return f'Math.min({mx}, Math.max({mn}, {val}))'
        if mn is not None:
            return f'Math.max({mn}, {val})'
        return val

    elif cat == 'boolean':
        return f'{index} % 2 === 0'

    elif cat == 'datetime':
        fmt = field.get('format')
        if fmt == 'date':
            # Use UTC to avoid timezone shift: local midnight in e.g. JST would be stored as prev day
            return f'new Date(Date.UTC(2025, 0, {index})).toISOString()'
        if any(kw in prop_name for kw in ('end', 'logout', 'finish')):
            return f'new Date(2025, 0, {index}, 17, 0).toISOString()'
        return f'new Date(2025, 0, {index}, 9, 0).toISOString()'

    return ''  # autocomplete — handled via deps


def cypress_create_value(field: dict, entity_title: str) -> str:
    """Generate a Cypress create (first fill) value."""
    cat = field['category']
    prop_name = field['prop_name']

    if cat == 'text':
        if prop_name == 'name':
            return f'Test {entity_title}'
        if field.get('enum_values'):
            return field['enum_values'][0]
        return f'Test {field["label"]}'

    elif cat == 'entity_select':
        options = field.get('entity_options') or []
        return options[0]['label'] if options else ''

    elif cat in ('enum', 'string_enum'):
        values = field.get('enum_values') or []
        first = next((v for v in values if v is not None), None)
        if first is None:
            return ''
        if cat == 'enum':
            return _enum_label(field, first)
        return str(first)

    elif cat == 'number':
        val = 100
        mn = field.get('min')
        mx = field.get('max')
        if mn is not None:
            val = max(mn, val)
        if mx is not None:
            val = min(mx, val)
        return str(val)

    elif cat == 'boolean':
        return 'true'

    elif cat == 'datetime':
        fmt = field.get('format')
        if fmt == 'date':
            if any(kw in prop_name for kw in ('end', 'logout', 'finish')):
                return '01/16/2025'
            return '01/15/2025'
        if fmt == 'time':
            if any(kw in prop_name for kw in ('end', 'logout', 'finish')):
                return '05:00 PM'
            return '09:00 AM'
        if any(kw in prop_name for kw in ('end', 'logout', 'finish')):
            return '01/15/2025 05:00 PM'
        return '01/15/2025 09:00 AM'

    return ''  # autocomplete


def cypress_edit_value(field: dict, entity_title: str) -> str:
    """Generate a Cypress edit (updated) value."""
    cat = field['category']
    prop_name = field['prop_name']

    if cat == 'text':
        if prop_name == 'name':
            return f'Updated {entity_title}'
        enum_values = field.get('enum_values')
        if enum_values:
            return enum_values[1] if len(enum_values) > 1 else enum_values[0]
        return f'Updated {field["label"]}'

    elif cat == 'entity_select':
        options = field.get('entity_options') or []
        if len(options) > 1:
            return options[1]['label']
        return options[0]['label'] if options else ''

    elif cat in ('enum', 'string_enum'):
        values = [v for v in (field.get('enum_values') or []) if v is not None]
        raw = values[1] if len(values) > 1 else (values[0] if values else None)
        if raw is None:
            return ''
        if cat == 'enum':
            return _enum_label(field, raw)
        return str(raw)

    elif cat == 'number':
        val = 200
        mn = field.get('min')
        mx = field.get('max')
        if mn is not None:
            val = max(mn, val)
        if mx is not None:
            val = min(mx, val)
        return str(val)

    elif cat == 'boolean':
        return 'false'

    elif cat == 'datetime':
        fmt = field.get('format')
        if fmt == 'date':
            return '06/15/2025'
        if fmt == 'time':
            # `cy.fillTime` requires "HH:MM AM/PM" only — datetime format
            # would crash the helper. Mirror the create_value time branch.
            if any(kw in prop_name for kw in ('end', 'logout', 'finish')):
                return '06:00 PM'
            return '02:00 PM'
        if any(kw in prop_name for kw in ('end', 'logout', 'finish')):
            return '06/15/2025 06:00 PM'
        return '06/15/2025 02:00 PM'

    return ''  # autocomplete


def api_value(field: dict, entity_title: str) -> str:
    """Generate a value for API test request bodies (TypeScript literal string)."""
    cat = field['category']
    prop_name = field['prop_name']

    if cat == 'text':
        if field.get('format') == 'uri':
            return f"'https://example.com/test-{prop_name}'"
        if prop_name == 'name':
            return f"'Test {entity_title}'"
        if field.get('enum_values'):
            return f"'{field['enum_values'][0]}'"
        return f"'Test {field['label']}'"

    elif cat == 'entity_select':
        options = field.get('entity_options') or []
        return f"'{options[0]['value']}'" if options else "''"

    elif cat == 'enum':
        return '0'

    elif cat == 'string_enum':
        first = next((v for v in (field.get('enum_values') or []) if v is not None), None)
        return f"'{first}'" if first is not None else "''"

    elif cat == 'number':
        val = 100
        mn = field.get('min')
        mx = field.get('max')
        if mn is not None:
            val = max(mn, val)
        if mx is not None:
            val = min(mx, val)
        return str(val)

    elif cat == 'boolean':
        return 'true'

    elif cat == 'datetime':
        if any(kw in prop_name for kw in ('end', 'logout', 'finish')):
            return "'2025-01-15T17:00:00.000Z'"
        return "'2025-01-15T09:00:00.000Z'"

    return ''  # autocomplete


# ---------------------------------------------------------------------------
# Cypress command generators
# ---------------------------------------------------------------------------

def gen_fill_command(field: dict, value: str, indent: str) -> str:
    cat = field['category']
    label = field['label']
    if cat in ('text', 'number'):
        return f"{indent}cy.fillField('{label}', '{value}');"
    elif cat == 'datetime':
        fmt = field.get('format')
        if fmt == 'date':
            return f"{indent}cy.fillDate('{label}', '{value}');"
        elif fmt == 'time':
            return f"{indent}cy.fillTime('{label}', '{value}');"
        return f"{indent}cy.fillDateTime('{label}', '{value}');"
    elif cat == 'boolean':
        return f"{indent}cy.setCheckbox('{label}', {value});"
    elif cat in ('enum', 'entity_select'):
        return f"{indent}cy.selectAutocomplete('{label}', '{value}');"
    else:
        return f"{indent}cy.selectAutocomplete('{label}', '{value}');"


def gen_clear_command(field: dict, indent: str) -> str:
    cat = field['category']
    label = field['label']
    if cat in ('text', 'number'):
        return f"{indent}cy.clearField('{label}');"
    elif cat == 'datetime':
        return f"{indent}cy.clearDateTime('{label}');"
    elif cat == 'boolean':
        return f"{indent}cy.setCheckbox('{label}', false);"
    elif cat == 'enum':
        return f"{indent}cy.clearAutocomplete('{label}');"
    else:
        return f"{indent}cy.clearAutocomplete('{label}');"


def gen_assert_command(field: dict, value: str, indent: str) -> str:
    cat = field['category']
    label = field['label']
    if cat == 'boolean':
        return f"{indent}cy.setCheckbox('{label}', {value}); // verify checkbox state"
    else:
        return f"{indent}cy.checkField('{label}', '{value}');"


def gen_empty_assert_command(field: dict, indent: str) -> str:
    """Assert that a field is empty / cleared.

    Used after the 9.x.3 'remove flatten section' edit-and-save flow to verify
    that the inside-accordion fields render as empty when the form is reopened.
    For text/number/datetime/enum/autocomplete the input value should be ''.
    For booleans we assert the checkbox is not checked.
    """
    cat = field['category']
    label = field['label']
    if cat == 'boolean':
        return f"{indent}cy.setCheckbox('{label}', false); // verify checkbox cleared"
    return f"{indent}cy.checkField('{label}', '');"


def gen_fill_commands(
    fields: list, entity_title: str, indent: str, fk_dep_vars: dict | None = None,
    dep_search_info: dict | None = None,
) -> list[str]:
    """fk_dep_vars: optional {prop_name: dep_var_name} for prop-name-based dep var lookup.
    dep_search_info: optional {prop_name: {search_differs}} — when search_differs is
    True, the dep's labelField mixes non-string segments (e.g. date), so the test
    must type the string-only deps.X.searchName but still click deps.X.name (the
    full label rendered in the dropdown). See RC6 (cmd_323)."""
    lines = []
    for field in fields:
        if field.get('readonly'):
            continue  # read-only fields are non-editable in the form
        if field['category'] == 'autocomplete':
            dep_target = field.get('dep_target')
            if dep_target:
                dep_var = (fk_dep_vars or {}).get(field['prop_name']) or to_camel_case(dep_target)
                info = (dep_search_info or {}).get(field['prop_name'], {})
                if info.get('search_differs'):
                    lines.append(
                        f"{indent}cy.selectAutocomplete('{field['label']}', "
                        f"deps.{dep_var}.searchName, deps.{dep_var}.name);"
                    )
                else:
                    lines.append(f"{indent}cy.selectAutocomplete('{field['label']}', deps.{dep_var}.name);")
        else:
            value = cypress_create_value(field, entity_title)
            lines.append(gen_fill_command(field, value, indent))
    return lines


def gen_assert_commands(
    fields: list,
    entity_title: str,
    indent: str,
    fk_dep_vars: dict | None = None,
    flatten_m2o_props: set | None = None,
    schema: dict | None = None,
) -> list[str]:
    """fk_dep_vars: optional {prop_name: dep_var_name} for prop-name-based dep var lookup.
    flatten_m2o_props: optional set of FK prop names whose target is rendered as a
    flatten Accordion in FormView. For those, the FK label (e.g. 'Patient Rel')
    is the Accordion title — not a TextField label — so a direct
    `cy.checkField('Patient Rel', ...)` cannot match. We instead open the
    accordion and assert on the inner label-field TextField (e.g. 'Patient No').
    """
    flatten_m2o_props = flatten_m2o_props or set()
    lines = []
    for field in fields:
        if field.get('readonly'):
            continue  # read-only fields aren't filled, so don't assert the edited value
        if field['category'] == 'autocomplete':
            dep_target = field.get('dep_target')
            if dep_target:
                # Use prop stem when available (e.g. parent_id → 'parent' → 'Test Parent')
                # so self-ref FKs get the right dep title rather than the entity title.
                # Must use snake_case prop stem (not camelCase dep_var) so to_title_case splits correctly.
                dep_var = (fk_dep_vars or {}).get(field['prop_name'])
                dep_label_field = field.get('dep_label_field')
                # Prefer the rich resolver (handles list-form labelField, dotted
                # paths, and the YYYY-MM-DD date format produced by formatLabelValue).
                if dep_label_field and dep_label_field != 'name' and schema is not None:
                    dep_title = _seed_relation_label_value(
                        dep_target,
                        dep_label_field,
                        field.get('dep_label_field_is_date', False),
                        schema,
                    )
                elif dep_var:
                    prop_stem = re.sub(r'_id$', '', field['prop_name'])
                    dep_title = f'Test {to_title_case(prop_stem)}'
                else:
                    dep_title = f'Test {to_title_case(dep_target)}'
                if field['prop_name'] in flatten_m2o_props:
                    inner_label_field = field.get('dep_label_field') or 'name'
                    # Inner label inside a flattened accordion is the literal field
                    # title — list-form label_field collapses to its first segment.
                    if isinstance(inner_label_field, list):
                        inner_label_field = inner_label_field[0] if inner_label_field else 'name'
                    inner_label = to_title_case(str(inner_label_field).split('.')[-1])
                    lines.append(f"{indent}cy.openAccordion('{field['label']}');")
                    lines.append(f"{indent}cy.checkField('{inner_label}', '{dep_title}');")
                else:
                    lines.append(f"{indent}cy.checkField('{field['label']}', '{dep_title}');")
        else:
            value = cypress_create_value(field, entity_title)
            lines.append(gen_assert_command(field, value, indent))
    return lines


# ---------------------------------------------------------------------------
# Child DataGrid object helpers
# ---------------------------------------------------------------------------

def _child_scalar_entries(fields: list, title: str, value_fn) -> list[str]:
    """Return JS object entries for scalar (non-autocomplete) datagrid child fields."""
    entries = []
    for field in fields:
        if field['category'] in ('autocomplete', 'enum'):
            continue
        value = value_fn(field, title)
        if field['category'] in ('boolean', 'number'):
            entries.append(f"{field['prop_name']}: {value}")
        else:
            entries.append(f"{field['prop_name']}: '{value}'")
    return entries


def gen_child_datagrid_object(child_meta: dict, action: str) -> str:
    """Generate fillDataGridRow object (scalar fields only; FK fields use selectDataGridSingleSelect)."""
    fields = child_meta['required_fields'] if action == 'create' else child_meta['fields']
    title = child_meta['names']['title']
    value_fn = cypress_create_value if action == 'create' else cypress_edit_value
    entries = _child_scalar_entries(fields, title, value_fn)
    return '{ ' + ', '.join(entries) + ' }'


def gen_child_full_datagrid_object(child_meta: dict) -> str:
    """Generate fillDataGridRow object for all fields (scalar only)."""
    entries = _child_scalar_entries(child_meta['fields'], child_meta['names']['title'], cypress_create_value)
    return '{ ' + ', '.join(entries) + ' }'


def gen_child_datagrid_fk_fields(fields: list, schema: dict | None = None) -> list[dict]:
    """Return [{field, label_code}] for FK (singleSelect) fields in a datagrid child.

    Uses prop-stem-based label so reference_id → 'Test Reference' (not 'Test Db Table').
    The parent FK (e.g. db_table_id) is already excluded from fields by analyze_children.

    `label_code` is a ready-to-embed JS expression (the template renders it
    unquoted): normally a quoted "Test X" string literal, but when the target's
    labelField is 'id' (no human-readable name field, e.g. inventory) the UI
    autocomplete option text is the row's raw id rather than a static
    placeholder, so we emit a runtime `deps.{stem}.id` reference instead. This
    relies on `deps` being in scope, which callers of this fn feed into
    has_child_fk_deps → has_deps, guaranteeing it whenever an FK field is present.
    """
    result = []
    for f in fields:
        if f['category'] != 'autocomplete' or not f.get('dep_target'):
            continue
        stem = re.sub(r'_id$', '', f['prop_name'])
        dep_label_field = f.get('dep_label_field')
        dep_target = f.get('dep_target')
        if dep_label_field == 'id':
            label_code = f'deps.{to_camel_case(stem)}.id'
        elif isinstance(dep_label_field, list) and schema is not None:
            raw = _seed_relation_label_value(dep_target, dep_label_field, False, schema)
            label_code = f"'{raw}'"
        else:
            label_code = f"'Test {to_title_case(stem)}'"
        result.append({'field': f['prop_name'], 'label_code': label_code})
    return result


def _compute_flatten_test_rels(parent: str, pascal: str, definition_key: str, schema: dict) -> list[dict]:
    """Compute flatten_test_rels: one entry per testable non-m2o flatten relation.

    Each entry contains Cypress fill/clear/assert commands and Prisma data for
    creating the child record in populate helpers.
    """
    parent_def = schema['definitions'].get(parent, {})
    flatten_rels_all = get_flatten_rels(parent, parent_def, schema)
    non_m2o_flatten = [r for r in flatten_rels_all if not r['is_m2o']]
    indent = '      '

    result = []
    for _flat in non_m2o_flatten:
        _target = _flat['target']
        _prop = _flat['prop_name']
        _non_fk_fields = [f for f in _flat['fields'] if not f.get('is_fk')]
        if not _non_fk_fields:
            continue

        # The flatten OTO target may carry external required FKs (e.g.
        # lifestyle.patient_id) that the form does not collect. The service
        # generator derives those values from the parent's own FK chain
        # (see find_fk_derivation_path), so the test always exercises the
        # inline-create path — there is no longer a separate "update-only"
        # category. _can_create_inline is kept True for every flatten OTO so
        # that 8.x.1 (create with section) and 9.x.1 (add to existing) are
        # generated for ALL of them.
        _can_create_inline = True

        _target_def = schema['definitions'].get(_target, {})
        # _is_optional_parent_fk is no longer used for test description wording
        # (we render a single phrase regardless), but the rel data still carries
        # it so future templates can branch if needed.
        _is_optional_parent_fk = is_optional_fk_to_parent(_target_def, parent)

        _title = to_title_case(_prop)
        _pascal_prop = to_pascal_case(_prop)

        # Convert flat fields to FieldMeta-compatible dicts for command generators
        _field_metas = []
        for f in _non_fk_fields:
            _ftype = f.get('prop_type', 'string')
            _ffmt = f.get('format')
            _fenum = f.get('enum')
            if _fenum:
                _cat = 'enum'
            elif _ftype in ('integer', 'number'):
                _cat = 'number'
            elif _ftype == 'string' and _ffmt in ('date', 'date-time', 'time'):
                _cat = 'datetime'
            elif _ftype == 'boolean':
                _cat = 'boolean'
            else:
                _cat = 'text'
            _field_metas.append({
                'prop_name': f['name'],
                'label': to_title_case(f['name']),
                'category': _cat,
                'required': not f.get('nullable', True),
                'enum_values': _fenum,
                'format': _ffmt,
                'dep_target': None,
                # Pull the schema's min/max so cypress_create_value picks a value
                # that fits the BaseNumberField cap. Without this, flatten fields
                # with a small max (e.g. lifestyle.quolity_of_sleep max: 10) get
                # the default '100' which the input clips to '10' on entry,
                # breaking the post-save assertion.
                'min': f.get('minimum'),
                'max': f.get('maximum'),
                'entity_options': None,
            })

        _has_required = any(m['required'] for m in _field_metas)
        _req_metas = [m for m in _field_metas if m['required']]

        _fill_cmds = [gen_fill_command(m, cypress_create_value(m, _title), indent) for m in _field_metas]
        _req_fill_cmds = [gen_fill_command(m, cypress_create_value(m, _title), indent) for m in _req_metas]
        _clear_cmds = [gen_clear_command(m, indent) for m in _field_metas]
        _assert_cmds = [gen_assert_command(m, cypress_create_value(m, _title), indent) for m in _field_metas]
        _empty_assert_cmds = [gen_empty_assert_command(m, indent) for m in _field_metas]

        # Partial fill: only the first required field (leaves others empty → validation fail)
        _partial_fill_cmds = []
        if _has_required:
            _first_req = _req_metas[0]
            _partial_fill_cmds = [gen_fill_command(_first_req, cypress_create_value(_first_req, _title), indent)]

        # Prisma data for populate helpers (non-FK non-nullable fields)
        _prisma_fields = []
        for f in _non_fk_fields:
            _ptype = f.get('prop_type', 'string')
            _pfmt = f.get('format')
            _penum = f.get('enum')
            if _penum:
                _pval = '0'
            elif _ptype in ('integer', 'number'):
                _pval = '0'
            elif _ptype == 'string' and _pfmt == 'date':
                _pval = 'new Date(Date.UTC(2025, 0, 1)).toISOString()'
            elif _ptype == 'string' and _pfmt in ('date-time', 'time'):
                _pval = 'new Date(2025, 0, 1).toISOString()'
            elif _ptype == 'boolean':
                _pval = 'false'
            else:
                _fname = f['name']
                _pval = f"'Test {to_title_case(_fname)}'"
            _prisma_fields.append({'name': f['name'], 'prisma_val': _pval, 'nullable': f.get('nullable', True)})

        # External FK fields needed to create the target record (e.g. lifestyle needs patient_id)
        _external_fk_fields = [
            {'name': f['name'], 'dep_var': to_camel_case(f.get('fk_target', ''))}
            for f in _flat['fields']
            if f.get('is_fk') and f.get('fk_target') and f.get('fk_target') != parent
        ]

        result.append({
            'title': _title,
            'pascal': _pascal_prop,
            'target': _target,
            'prop_name': _prop,
            'section_label': _title,
            'can_create_inline': _can_create_inline,
            'is_optional_parent_fk': _is_optional_parent_fk,
            'field_metas': _field_metas,
            'fill_cmds': _fill_cmds,
            'required_fill_cmds': _req_fill_cmds,
            'clear_cmds': _clear_cmds,
            'assert_cmds': _assert_cmds,
            'empty_assert_cmds': _empty_assert_cmds,
            'partial_fill_cmds': _partial_fill_cmds,
            'has_required': _has_required,
            'prisma_fields': _prisma_fields,
            'external_fk_fields': _external_fk_fields,
            'has_external_fks': bool(_external_fk_fields),
            'populate_with_task': f'db:populate{pascal}With{_pascal_prop}',
        })

    return result


# ---------------------------------------------------------------------------
# Context builders (Jinja2 template contexts)
# ---------------------------------------------------------------------------

def helper_context(
    parent: str,
    children: list,
    schema: dict,
    model_name: str,
    definition_key: str,
    generate_config: dict,
) -> dict:
    parent_def = schema['definitions'].get(model_name)
    if not parent_def or not parent_def.get('properties'):
        return {}

    title = to_title_case(parent)
    pascal = to_pascal_case(parent)
    properties = filter_fields(parent_def['properties'], generate_config.get('fields'))
    required_fields = parent_def.get('required') or []
    relationships = get_parent_relationships(parent_def, schema)
    entity_options = _get_entity_options(schema)
    fields = get_field_metas(properties, required_fields, relationships, generate_config.get('fields'), entity_options)
    # Detect outbound one-to-one FK fields (e.g. approvable_id on leave_request).
    # These are internal bridge records the service creates automatically — not user-facing.
    # Exclude from fill/assert commands and from prisma data field lists; handle separately.
    internal_fk_deps = get_all_internal_fk_deps(model_name, schema)
    internal_fk_prop_names = {d['prop_name'] for d in internal_fk_deps}
    fields = [f for f in fields if f['prop_name'] not in internal_fk_prop_names]

    # cmd_421 Domain 4 (M1, subtask_421i): mention field name resolution. Only
    # the commentable-bridge shape is supported here (comment_children direct-FK
    # shape has no populate helper of its own yet — see build_context.py's
    # _build_comment_actions/_build_comment_actions_bridge split for the two
    # shapes). Mirrors build_context.py's comment_has_mention detection: the
    # shared 'comment' model has an x-mention: true field AND this entity has
    # a one-to-one_bridge FK to 'commentable'.
    _h_commentable_fk = next((d for d in internal_fk_deps if d['target'] == 'commentable'), None)
    _h_comment_def = schema.get('definitions', {}).get('comment', {}) or {}
    _h_comment_mention_fields = [
        fn for fn, fp in (_h_comment_def.get('properties') or {}).items()
        if isinstance(fp, dict) and fp.get('x-mention') is True
    ]
    has_mention_comments = bool(_h_commentable_fk) and bool(_h_comment_mention_fields)
    commentable_fk_prop = _h_commentable_fk['prop_name'] if _h_commentable_fk else None
    mention_field_name = _h_comment_mention_fields[0] if _h_comment_mention_fields else None
    # Mark read-only fields: they stay in `fields` (so seed/prisma data still sets
    # required values) but UI fill/clear/assert commands skip them — the form renders
    # them non-editable, so typing into them would fail.
    _readonly_props = _readonly_field_names(parent_def)
    for _f in fields:
        _f['readonly'] = _f['prop_name'] in _readonly_props
    deps = resolve_dependencies(model_name, schema)
    entity_fk_deps = get_entity_fk_deps(model_name, schema, deps)

    # Bridge-child entity: inject first bridge parent as synthetic dep so that
    # populateXxxDependencies creates and returns a parent record (e.g. work).
    # This is needed because API tests POST with selectedParentType/selectedParentId,
    # and the helper must return the parent so the test can reference deps.<parent>.id.
    _h_bridge = parent_def.get('x-bridge') if parent_def else None
    if isinstance(_h_bridge, dict) and _h_bridge.get('name') and _h_bridge.get('parents'):
        _h_bp_list = _h_bridge.get('parents') or []
        _h_first_bp = _h_bp_list[0] if _h_bp_list else None
        _h_bp_target = (_h_first_bp.get('target') if isinstance(_h_first_bp, dict) else _h_first_bp) or None
        if _h_bp_target and not any(d['target'] == _h_bp_target for d in deps):
            for _td in resolve_dependencies(_h_bp_target, schema):
                if not any(d['target'] == _td['target'] for d in deps):
                    deps.append(_td)
            # Wire the parent's own required FKs (e.g. room.room_type_id) to the deps
            # just created above, and seed its required scalars — otherwise the parent
            # create in populateXxxDependencies omits mandatory columns.
            _h_bp_def = schema['definitions'].get(_h_bp_target, {})
            _h_bp_fk_deps = [
                {'prop_name': r['prop_name'], 'dep_var_name': to_camel_case(r['target'])}
                for r in get_parent_relationships(_h_bp_def, schema)
                if any(d['target'] == r['target'] for d in deps)
            ]
            deps.append({'target': _h_bp_target, 'var_name': to_camel_case(_h_bp_target),
                         'fk_deps': _h_bp_fk_deps, 'title': to_title_case(_h_bp_target),
                         'extra_required_fields': _get_dep_extra_required_fields(_h_bp_target, schema)})

    # Detect required selector one-to-one FK fields (e.g. pre_check.checkup_id).
    # These are reverse-parent FKs (FK in this model, parent in target) that must be created as deps
    # in populate helpers. Bridge OTOs are handled by internal_fk_deps and M2O by resolve_dependencies,
    # so this loop only covers the selector pattern (`type: one-to-one`) where the target is a
    # user-visible entity with its own pages.
    existing_fk_props = {fk['prop_name'] for fk in entity_fk_deps}
    for prop_name, prop in properties.items():
        rel = prop.get('x-relationship')
        if not rel or rel.get('type') != 'one-to-one':
            continue
        if not prop_name.endswith('_id'):
            continue
        if prop_name not in set(required_fields):
            continue
        oto_target = rel.get('target')
        if not oto_target or oto_target == model_name:
            continue
        if prop_name in existing_fk_props:
            continue
        oto_target_def = schema['definitions'].get(oto_target, {})
        # Add transitive deps of this target first
        for td in resolve_dependencies(oto_target, schema):
            if not any(d['target'] == td['target'] for d in deps):
                deps.append(td)
        # Add the target itself as a dep
        oto_var = to_camel_case(oto_target)
        if not any(d['var_name'] == oto_var for d in deps):
            oto_fk_deps = [
                {'prop_name': r['prop_name'], 'dep_var_name': to_camel_case(r['target'])}
                for r in get_parent_relationships(oto_target_def, schema)
                if any(d['target'] == r['target'] for d in deps)
            ]
            deps.append({'target': oto_target, 'var_name': oto_var, 'fk_deps': oto_fk_deps,
                         'title': to_title_case(oto_target), 'extra_required_fields': []})
        # Map the FK prop to this dep
        entity_fk_deps.append({'prop_name': prop_name, 'dep_var_name': oto_var})
        # Update the field metadata so the template treats this as an autocomplete (FK) field
        for f in fields:
            if f['prop_name'] == prop_name:
                f['category'] = 'autocomplete'
                f['dep_var_name'] = oto_var
                break

    # Split same-target deps into prop-stem deps when multiple FK fields point to the same target.
    # Mirrors user_account handling: each FK field gets its own dep with a prop-stem var name.
    # e.g. approver_role_id + requestor_role_id → both point to 'role'
    # → creates 'approverRole' dep and 'requestorRole' dep instead of a single 'role' dep.
    target_to_fk_rels: dict[str, list] = {}
    for r in relationships:
        if (r['target'] not in ('user', model_name)
                and r['prop_name'] not in ('updater_id', 'assignee_id')):
            target_to_fk_rels.setdefault(r['target'], []).append(r)
    multi_fk_targets = {t: rels for t, rels in target_to_fk_rels.items() if len(rels) > 1}
    for target, fk_rels in multi_fk_targets.items():
        # Capture original dep's fk_deps before removing it — split prop-stem
        # deps must inherit them so create() calls include required FK columns.
        _orig_dep = next((d for d in deps if d['target'] == target), None)
        _orig_fk_deps = _orig_dep.get('fk_deps', []) if _orig_dep else []
        # Remove the single target-based dep and its entity_fk_deps entries
        deps = [d for d in deps if d['target'] != target]
        entity_fk_deps = [d for d in entity_fk_deps if d['dep_var_name'] != to_camel_case(target)]
        # Add per-prop-stem deps and entity_fk_deps entries
        for r in fk_rels:
            prop_stem = re.sub(r'_id$', '', r['prop_name'])
            var_name = to_camel_case(prop_stem)
            title = to_title_case(prop_stem)
            if not any(d['var_name'] == var_name for d in deps):
                deps.append({'target': target, 'var_name': var_name, 'title': title, 'fk_deps': _orig_fk_deps})
            entity_fk_deps.append({'prop_name': r['prop_name'], 'dep_var_name': var_name})

    # Handle single-FK non-standard prop names (e.g. work_creator_id → creator).
    # When prop_stem != target name, rename the dep's var_name/title to prop_stem-based
    # so helper and spec use consistent variable names (spec already uses prop_stem via fk_dep_vars).
    # Keep an alias {old_target_var: new_prop_var} for the return object so callers using
    # the target-name key (e.g. deps.creator) still work via destructuring alias.
    single_fk_target_aliases: dict[str, str] = {}
    for target, fk_rels in target_to_fk_rels.items():
        if target in multi_fk_targets or len(fk_rels) != 1:
            continue
        r = fk_rels[0]
        prop_stem = re.sub(r'_id$', '', r['prop_name'])
        new_var = to_camel_case(prop_stem)
        old_var = to_camel_case(target)
        if new_var == old_var:
            continue
        single_fk_target_aliases[old_var] = new_var
        new_title = to_title_case(prop_stem)
        for dep in deps:
            if dep['target'] == target and dep.get('var_name') == old_var and 'title' not in dep:
                dep['var_name'] = new_var
                dep['_title_override'] = new_title
        for fk in entity_fk_deps:
            if fk.get('dep_var_name') == old_var and fk['prop_name'] == r['prop_name']:
                fk['dep_var_name'] = new_var
        for dep in deps:
            for nested_fk in dep.get('fk_deps', []):
                if nested_fk.get('dep_var_name') == old_var:
                    nested_fk['dep_var_name'] = new_var

    # Note: read-only fields stay in these lists so seed/prisma create data includes
    # their required values; the fill/clear/assert command builders skip them.
    required_field_metas = [f for f in fields if f['required']]
    optional_field_metas = [f for f in fields if not f['required']]

    child_metas = analyze_children(children, schema, model_name)
    datagrid_children = [c for c in child_metas if c['render_type'] == 'datagrid']
    comment_children_meta = [c for c in child_metas if c['render_type'] == 'comments']

    # Detect primary display field (for needs_second on FK primary deps)
    primary_field_name_h = _get_primary_display_field_name(parent_def)
    primary_is_fk_h = bool(
        primary_field_name_h
        and f'{primary_field_name_h}_id' in (parent_def.get('properties') or {})
    )
    primary_fk_dep_target = primary_field_name_h if primary_is_fk_h else None

    # Extend deps to include FK deps needed by datagrid children
    # (e.g. purchase_per_item needs product, but parent purchase_order doesn't)
    # Also handles self-ref child FKs (e.g. field.reference_id → db_table) using prop-stem var names.
    # Note: parent FK (e.g. db_table_id) is already excluded from child_meta['fields'] by analyze_children.
    for child_meta in datagrid_children:
        for field in child_meta['fields']:
            target = field.get('dep_target')
            if field['category'] == 'autocomplete' and target and target != 'user':
                prop_stem = re.sub(r'_id$', '', field['prop_name'])
                var_name = to_camel_case(prop_stem)
                if not any(d['var_name'] == var_name for d in deps):
                    # Bring in the target's own transitive deps first (e.g. inventory → product),
                    # then wire its required FK fields that are now resolvable — otherwise the
                    # dep's own create() call in populateXxxDependencies omits mandatory FK columns.
                    for td in resolve_dependencies(target, schema):
                        if not any(d['target'] == td['target'] for d in deps):
                            deps.append(td)
                    target_def = schema['definitions'].get(target, {})
                    target_fk_deps = [
                        {'prop_name': r['prop_name'], 'dep_var_name': to_camel_case(r['target'])}
                        for r in get_parent_relationships(target_def, schema)
                        if any(d['target'] == r['target'] for d in deps)
                    ]
                    deps.append({'target': target, 'var_name': var_name, 'title': to_title_case(prop_stem), 'fk_deps': target_fk_deps})

    # Collect ALL user_account FK fields (required and optional) as separate deps.
    # ua_dep_fields: required only (for populateData); ua_dep_fields_full: all (for populateFullData).
    ua_dep_fields = []
    ua_dep_fields_full = []
    for r in relationships:
        if (r['target'] == 'user'
                and r['prop_name'] not in ('creator_id', 'updater_id')):
            prop_stem = re.sub(r'_id$', '', r['prop_name'])
            var_name = to_camel_case(prop_stem)
            deps.append({'target': 'user', 'var_name': var_name, 'title': to_title_case(prop_stem), 'fk_deps': []})
            entity_fk_deps.append({'prop_name': r['prop_name'], 'dep_var_name': var_name})
            ua_dep_fields_full.append({'prop_name': r['prop_name'], 'dep_var_name': var_name})
            if r['prop_name'] in required_fields:
                ua_dep_fields.append({'prop_name': r['prop_name'], 'dep_var_name': var_name})

    # Add self-referential FK deps using prop-stem var_names (e.g. parent_id → var 'parent')
    for r in relationships:
        if r['target'] == model_name and r['prop_name'] not in ('updater_id',):
            prop_stem = re.sub(r'_id$', '', r['prop_name'])
            var_name = to_camel_case(prop_stem)
            fk_prop_to_dep_var = {fk['prop_name']: fk['dep_var_name'] for fk in entity_fk_deps}
            self_ref_fk_deps = [
                {'prop_name': rel['prop_name'], 'dep_var_name': fk_prop_to_dep_var[rel['prop_name']]}
                for rel in relationships
                if rel.get('required')
                and rel['target'] not in (model_name, 'user')
                and rel['prop_name'] in fk_prop_to_dep_var
            ]
            if not any(d['var_name'] == var_name for d in deps):
                deps.append({
                    'target': model_name,
                    'var_name': var_name,
                    'title': to_title_case(prop_stem),
                    'fk_deps': self_ref_fk_deps,
                })
            entity_fk_deps.append({'prop_name': r['prop_name'], 'dep_var_name': var_name})

    # Add editable-list-autocomplete children as deps only for self-ref children.
    # External children (both optional-FK reverse and M2M) are populated separately
    # via db:populate{Target} — do NOT add them as dependencies here.
    list_child_metas = [c for c in child_metas if c['render_type'] == 'editable-list-autocomplete']
    for child_meta in list_child_metas:
        rel = child_meta['child'].get('relationship') or {}
        rel_target = rel.get('target', '') or child_meta['child']['name']
        if not rel_target:
            continue
        # Skip all external children — only self-ref belong in populateDependencies
        if rel_target != model_name:
            continue
        prop_name = child_meta['child']['property_name']
        var_name = to_camel_case(prop_name)
        title_str = to_title_case(prop_name)
        if not any(d['var_name'] == var_name for d in deps):
            # Compute fk_deps: required FK fields on this model that reference already-known non-self deps.
            # These are needed to create a valid self-ref record (e.g. approval_flow needs approver_role_id).
            # Use entity_fk_deps for the correct prop→var mapping (handles multi-FK-same-target splits).
            fk_prop_to_dep_var = {fk['prop_name']: fk['dep_var_name'] for fk in entity_fk_deps}
            self_ref_fk_deps = [
                {'prop_name': r['prop_name'], 'dep_var_name': fk_prop_to_dep_var[r['prop_name']]}
                for r in relationships
                if r.get('required') and r['target'] != model_name and r['target'] != 'user'
                and r['prop_name'] in fk_prop_to_dep_var
            ]
            # label_field key is snake_case in the extracted entity relationship dict
            label_field = rel.get('label_field', 'name')
            deps.append({
                'target': rel_target,
                'var_name': var_name,
                'title': title_str,
                'fk_deps': self_ref_fk_deps,
                'label_field': label_field,
            })

    # Enrich deps with extra_required_fields, has_user_accounts, needs_second.
    # All dep types (regular, user_account, self-ref, m2m) are handled uniformly.
    # Deps from resolve_dependencies have no 'title' key; direct deps (UA, self-ref, m2m)
    # have 'title' pre-set. Only transitive deps can have needs_second=True.
    rel_by_prop = {r['prop_name']: r for r in relationships}
    dep_label_info_by_var = {
        fk['dep_var_name']: rel_by_prop.get(fk['prop_name'])
        for fk in entity_fk_deps
        if rel_by_prop.get(fk['prop_name'])
    }
    enriched_deps = []
    for dep in deps:
        is_direct = 'title' in dep  # UA / self-ref / m2m deps added directly
        title_str = dep.get('_title_override') or dep.get('title') or to_title_case(dep['target'])
        dep_def = schema['definitions'].get(dep['target'] + '_detail', {})
        x_rels = dep_def.get('x-relationships', {})
        dep_label_info = dep_label_info_by_var.get(dep['var_name'])
        extra_required_fields = _get_dep_populate_fields(dep['target'], dep['var_name'], title_str, schema)
        # Idempotency hook for `populateXxxDependencies`: if the dep target has
        # a deterministic `name` value (the common case — every required-`name`
        # entity emits `name: 'Test <Title>'`), the template uses
        # findFirst({where: {name}}) ?? create(...) so calling the helper twice
        # in the same test (parent populator + child populator) does not
        # duplicate the row and trip @unique constraints (e.g. product.code).
        # Bridges without a `name` field (commentable, approvable) skip this
        # path — they have no unique constraints, so plain create is safe.
        name_ef = next((f for f in extra_required_fields if f['prop_name'] == 'name'), None)
        lookup_field = 'name' if name_ef else None
        lookup_value = name_ef['prisma_val'] if name_ef else None
        lookup_value_second = name_ef['prisma_val_second'] if name_ef else None
        # Per-iteration lookup value (`Test X ${i}`) used by populateXxxData's
        # find-or-create on the primary FK. Closes the cross-helper
        # collision where deps create `Test X 2` and populate(2) would then
        # try to create another `Test X 2` and trip @unique (e.g.
        # product.code). When the row already exists, the iteration re-uses
        # it; otherwise it creates a fresh one. Same lookup field as deps
        # (`name`) so the two helpers see the same row.
        lookup_value_unique = name_ef['prisma_val_unique'] if name_ef else None
        label_field = dep_label_info.get('label_field', 'name') if dep_label_info else dep.get('label_field', 'name')
        label_field_is_date = dep_label_info.get('label_field_is_date', False) if dep_label_info else dep.get('label_field_is_date', False)
        # Pre-compute the TS expression and Prisma include so the template
        # doesn't have to splice list-form labelField (which would break:
        # `record.['a', 'b']` is invalid TS). The expression is rooted at
        # `<var>Record` / `<var>2Record` so it can be inlined verbatim.
        label_expression = ''
        label_expression_second = ''
        prisma_include_str = ''
        label_has_format = False
        # search_label_expression: the string-only subset of label_expression that
        # a Cypress test should TYPE into an autocomplete's search box (the server
        # only searches string fields — date/enum/number segments never match).
        # search_differs is False when the full label is already string-only, in
        # which case callers keep using deps.X.name for both search and click.
        search_label_expression = ''
        search_label_expression_second = ''
        search_differs = False
        if label_field and label_field != 'name':
            built = build_label_expression(
                f'{dep["var_name"]}Record', label_field, dep['target'], schema,
            )
            label_expression = built['expression']
            label_has_format = built['has_format']
            prisma_include_str = render_prisma_include(built['prisma_include'])
            built_second = build_label_expression(
                f'{dep["var_name"]}2Record', label_field, dep['target'], schema,
            )
            label_expression_second = built_second['expression']

            search_label_expression = build_string_only_label_expression(
                f'{dep["var_name"]}Record', label_field, dep['target'], schema,
            )
            search_differs = bool(search_label_expression and search_label_expression != label_expression)
            if not search_label_expression:
                # S1c-1 fallback: all segments non-string (not present in current
                # schema) — keep searching by the full label (pre-fix behavior).
                search_label_expression = label_expression
                search_differs = False
            search_label_expression_second = build_string_only_label_expression(
                f'{dep["var_name"]}2Record', label_field, dep['target'], schema,
            ) or label_expression_second
        enriched_deps.append({
            **dep,
            'title': title_str,
            'has_user_accounts': x_rels.get('users', {}).get('target') == 'user',
            'extra_required_fields': extra_required_fields,
            'label_field': label_field,
            'label_field_is_date': label_field_is_date,
            'label_expression': label_expression,
            'label_expression_second': label_expression_second,
            'search_label_expression': search_label_expression,
            'search_label_expression_second': search_label_expression_second,
            'search_differs': search_differs,
            'prisma_include_str': prisma_include_str,
            'label_has_format': label_has_format,
            # needs_second only for transitive (non-direct) deps matching primary FK target
            'needs_second': not is_direct and dep['target'] == primary_fk_dep_target,
            # one-to-one FK pre-creates needed when creating this dep record (e.g. commentable_id)
            'internal_fk_deps': get_all_internal_fk_deps(dep['target'], schema),
            'lookup_field': lookup_field,
            'lookup_value': lookup_value,
            'lookup_value_second': lookup_value_second,
            'lookup_value_unique': lookup_value_unique,
            # True if dep entity has updater_id (user-visible entities do; leaf/bridge entities may not)
            'has_updater_id': _entity_has_updater_id(dep['target'], schema),
        })

    # Separate self-ref deps (target == model) from non-self deps for _createBaseDeps() split.
    non_self_deps = [d for d in enriched_deps if d['target'] != model_name]
    self_ref_deps = [d for d in enriched_deps if d['target'] == model_name]
    has_self_ref_deps = bool(self_ref_deps)

    # When a self-ref record's uniqueness is keyed partly on a required fk_dep
    # (e.g. approval_flow's @@unique([entity_name, approver_role_id])), 2+
    # self-ref deps (e.g. precededBy/followedBy) that reference the SAME
    # non-self dep instance for that fk collide on create(). Give every
    # self-ref dep after the first its own distinct instance of any fk_dep it
    # shares with an earlier self-ref dep, reusing the existing needs_second
    # ('{{var_name}}2') mechanism (mirrors fce403d's approverRole/approverRole2
    # split for setup{{pascal}}ApprovalFlow).
    non_self_deps_by_var = {d['var_name']: d for d in non_self_deps}
    seen_self_ref_fk_vars = set()
    for s_dep in self_ref_deps:
        for fk in s_dep['fk_deps']:
            dep_var = fk['dep_var_name']
            if dep_var in seen_self_ref_fk_vars:
                fk['dep_var_name'] = f'{dep_var}2'
                nd = non_self_deps_by_var.get(dep_var)
                if nd is not None:
                    nd['needs_second'] = True
            else:
                seen_self_ref_fk_vars.add(dep_var)

    # A multi-FK-target alias (e.g. `role: approverRole`, built below purely so
    # API/UI test bodies can write `deps.role.id`) must never resolve to a dep
    # already consumed above by a self-ref record: a test body that creates its
    # OWN new record via the alias would then collide with that self-ref
    # record's identical unique-key value. Give the alias its own always-fresh,
    # never-self-ref-consumed instance instead of reusing one.
    alias_fresh_var_map = {}
    for _target, _fk_rels in multi_fk_targets.items():
        _req_rel = next((r for r in _fk_rels if r.get('required')), _fk_rels[0])
        _alias_var = to_camel_case(re.sub(r'_id$', '', _req_rel['prop_name']))
        if _alias_var in seen_self_ref_fk_vars and _alias_var in non_self_deps_by_var:
            _src_dep = non_self_deps_by_var[_alias_var]
            _fresh_var = f'{_alias_var}Alias'
            _fresh_title = f"{_src_dep['title']} Alias"
            _fresh_dep = {
                **_src_dep,
                'var_name': _fresh_var,
                'title': _fresh_title,
                'needs_second': False,
                'extra_required_fields': _get_dep_populate_fields(_target, _fresh_var, _fresh_title, schema),
                'lookup_value': f"'Test {_fresh_title}'",
                'lookup_value_second': f"'Test {_fresh_title} 2'",
            }
            non_self_deps.append(_fresh_dep)
            enriched_deps.append(_fresh_dep)
            non_self_deps_by_var[_fresh_var] = _fresh_dep
            alias_fresh_var_map[_alias_var] = _fresh_var

    # Compute deps_return including second instances for FK primary deps.
    # For non_self_deps_return (used in _createBaseDeps return), also include target-name aliases
    # for any multi-FK-target split (e.g. role: approverRole) so API tests using deps.role.id still work.
    deps_return_parts = []
    non_self_deps_return_parts = []
    for dep in enriched_deps:
        deps_return_parts.append(dep['var_name'])
        if dep.get('needs_second'):
            deps_return_parts.append(f"{dep['var_name']}2")
    for dep in non_self_deps:
        non_self_deps_return_parts.append(dep['var_name'])
        if dep.get('needs_second'):
            non_self_deps_return_parts.append(f"{dep['var_name']}2")
    # Add target-name aliases for multi-FK-target splits
    for target, fk_rels in multi_fk_targets.items():
        alias_key = to_camel_case(target)
        # Use the first required rel's prop-stem as the alias value, or first rel if none required
        req_rel = next((r for r in fk_rels if r.get('required')), fk_rels[0])
        alias_var = to_camel_case(re.sub(r'_id$', '', req_rel['prop_name']))
        alias_var = alias_fresh_var_map.get(alias_var, alias_var)
        if alias_key != alias_var:
            if alias_key not in non_self_deps_return_parts:
                non_self_deps_return_parts.append(f'{alias_key}: {alias_var}')
            if alias_key not in [p.split(':')[0].strip() for p in deps_return_parts]:
                deps_return_parts.append(f'{alias_key}: {alias_var}')
    # Add target-name aliases for single-FK non-standard renames (e.g. creator: workCreator).
    # This allows callers to use either deps.workCreator or deps.creator interchangeably.
    existing_return_keys = {p.split(':')[0].strip() for p in deps_return_parts}
    existing_non_self_keys = {p.split(':')[0].strip() for p in non_self_deps_return_parts}
    for old_var, new_var in single_fk_target_aliases.items():
        if old_var not in existing_return_keys:
            deps_return_parts.append(f'{old_var}: {new_var}')
            existing_return_keys.add(old_var)
        if old_var not in existing_non_self_keys:
            non_self_deps_return_parts.append(f'{old_var}: {new_var}')
            existing_non_self_keys.add(old_var)
    deps_return = ', '.join(deps_return_parts)
    non_self_deps_return = ', '.join(non_self_deps_return_parts)

    def _enrich_field_prisma(field: dict, entity_title: str) -> dict:
        f = dict(field)
        if f['category'] == 'autocomplete':
            dep = next((d for d in entity_fk_deps if d['prop_name'] == f['prop_name']), None)
            f['dep_var_name'] = dep['dep_var_name'] if dep else None
            f['prisma_val'] = None
            f['prisma_val_fixed'] = None
        else:
            f['prisma_val'] = prisma_value(f, 'i', entity_title)
            f['prisma_val_fixed'] = prisma_value(f, '1', entity_title)
            f['dep_var_name'] = None
        return f

    required_fields_prisma = [_enrich_field_prisma(f, title) for f in required_field_metas]
    all_fields_prisma = [_enrich_field_prisma(f, title) for f in fields]

    enriched_datagrid_children = []
    for child_meta in datagrid_children:
        child_name = child_meta['child']['name']
        child_pascal = to_pascal_case(child_name)
        child_title = to_title_case(child_name)
        child_def = schema['definitions'].get(child_name, {})
        has_fk_deps = False
        child_fields_prisma = []
        for f in child_meta['fields']:
            target = f.get('dep_target')
            if f['category'] == 'autocomplete' and target and target != 'user':
                # Use prop-stem var name so self-ref FKs (e.g. reference_id → db_table)
                # get their own dep (e.g. deps.reference) distinct from the parent itself.
                prop_stem = re.sub(r'_id$', '', f['prop_name'])
                dep_var = to_camel_case(prop_stem)
                has_fk_deps = True
                child_fields_prisma.append({**f, 'prisma_val': f'deps.{dep_var}.id'})
            else:
                child_fields_prisma.append({**f, 'prisma_val': prisma_value(f, 'i', child_title)})
        # Required internal bridge FKs on the child itself (e.g. approvable_id) —
        # same nested-create pattern as populate{{pascal}}Data's own internal_fk_deps,
        # otherwise this "add child to existing parent" helper omits a required column.
        child_internal_fk_deps = get_all_internal_fk_deps(child_name, schema)
        enriched_datagrid_children.append({
            'model_name': child_name,
            'pascal': child_pascal,
            'parent_fk_prop': child_meta['parent_fk_prop'],
            'has_order': bool(child_def.get('properties', {}).get('order')),
            'fields_prisma': child_fields_prisma,
            'has_fk_deps': has_fk_deps,
            'internal_fk_deps': child_internal_fk_deps,
            'needs_test_user': any(d['target'] == 'user' for d in child_internal_fk_deps),
        })

    enriched_comment_children = []
    for child_meta in comment_children_meta:
        child_name = child_meta['child']['name']
        enriched_comment_children.append({
            'model_name': child_name,
            'pascal': to_pascal_case(child_name),
            'parent_fk_prop': child_meta['parent_fk_prop'],
        })

    primary_fk_dep = next((d for d in enriched_deps if d.get('needs_second')), None)
    # Also detect when the primary display FK is a user_account field.
    # In that case the dep var_name equals to_camel_case(primary_field_name_h).
    if primary_fk_dep is None and primary_is_fk_h and primary_fk_dep_target == 'user':
        primary_ua_var = to_camel_case(primary_field_name_h)
        primary_fk_dep = next(
            (d for d in enriched_deps
             if d['target'] == 'user' and d['var_name'] == primary_ua_var),
            None,
        )
    if primary_fk_dep is not None:
        primary_fk_dep = {**primary_fk_dep, 'is_user_account': primary_fk_dep['target'] == 'user'}

    # When the primary display FK is optional (nullable), it won't appear in
    # required_fields_prisma, so populateData creates records without it and
    # item.room is null → the formatted field is '' → DataGrid shows the entity's
    # own ID instead of the display value. Force-inject it so the template emits
    # `room_id: roomItem.id` and the list view shows the correct display value.
    if primary_fk_dep is not None and not primary_fk_dep.get('is_user_account'):
        _pfk_var = primary_fk_dep['var_name']
        _pfk_prop = next(
            (fk['prop_name'] for fk in entity_fk_deps if fk['dep_var_name'] == _pfk_var),
            None,
        )
        if _pfk_prop:
            _already_required = any(f['prop_name'] == _pfk_prop for f in required_fields_prisma)
            if not _already_required:
                _pfk_field = next(
                    (f for f in all_fields_prisma if f['prop_name'] == _pfk_prop),
                    None,
                )
                if _pfk_field:
                    required_fields_prisma.append(_pfk_field)

    # populateData needs deps when there are required FK fields not covered by per-iteration creation.
    primary_fk_dep_var = primary_fk_dep['var_name'] if primary_fk_dep else None
    primary_fk_is_ua = primary_fk_dep is not None and primary_fk_dep.get('is_user_account', False)
    primary_fk_ua_dep_var = primary_fk_dep_var if primary_fk_is_ua else None
    non_primary_ua_dep_fields = [f for f in ua_dep_fields if f['dep_var_name'] != primary_fk_ua_dep_var]
    needs_deps_in_populate = (
        bool(non_primary_ua_dep_fields)
        or any(
            f['category'] == 'autocomplete' and f['dep_var_name'] and f['dep_var_name'] != primary_fk_dep_var
            for f in required_fields_prisma
        )
        # Also needed when the primary FK dep itself has FK deps (e.g. patient_rel needs patient + clinic).
        # Without this, the template generates deps.X.id references without defining deps.
        or bool(primary_fk_dep and primary_fk_dep.get('fk_deps'))
    )
    # populateFullData also needs deps when there are any UA FK fields or optional FK fields
    needs_deps_in_populate_full = bool(ua_dep_fields_full) or any(
        f['category'] == 'autocomplete' and f.get('dep_var_name')
        for f in all_fields_prisma
    )

    has_approvable = any(d['target'] == 'approvable' for d in internal_fk_deps)

    flatten_test_rels = _compute_flatten_test_rels(parent, pascal, definition_key, schema)

    # Fields required by Prisma but hidden from the UI via x-generate.fields filter.
    # These must still be included in prisma.create() populate calls.
    _visible_prop_names = set(properties.keys())
    _SYSTEM_PROPS = {'id', 'creator_id', 'updater_id', 'created_at', 'updated_at'}
    _fields_filter = generate_config.get('fields') or []
    extra_prisma_fields = []
    if _fields_filter:
        _all_parent_props = parent_def.get('properties') or {}
        for _prop_name in sorted(parent_def.get('required') or []):
            if _prop_name in _SYSTEM_PROPS or _prop_name in _visible_prop_names:
                continue
            _prop = _all_parent_props.get(_prop_name)
            if not _prop:
                continue
            _fake_field = {'category': 'text', 'prop_name': _prop_name, 'label': to_title_case(_prop_name)}
            extra_prisma_fields.append({'prop_name': _prop_name, 'prisma_val': prisma_value(_fake_field, 'i', title)})
    # Include required URI-format fields skipped by get_field_metas (e.g. bookmark.url).
    # These are mandatory in Prisma but treated as image/file fields in the UI — populate
    # helpers need a valid URL string so the insert succeeds.
    _covered_props = (
        internal_fk_prop_names
        | {f['prop_name'] for f in required_fields_prisma}
        | {f['prop_name'] for f in extra_prisma_fields}
        | _SYSTEM_PROPS
    )
    _all_parent_props_for_uri = parent_def.get('properties') or {}
    for _prop_name in sorted(parent_def.get('required') or []):
        if _prop_name in _covered_props:
            continue
        _prop = _all_parent_props_for_uri.get(_prop_name)
        if _prop and _prop.get('format') == 'uri':
            extra_prisma_fields.append({
                'prop_name': _prop_name,
                'prisma_val': f'`https://example.com/{model_name}/${{i}}`',
            })

    # Detect count-mode reservation WITH lines: populateDependencies must seed the pool entity
    # so that create tests (2.1, 2.2) can allocate inventory without hitting InsufficientPoolCapacityError.
    reservation_lines_pool_seed = None
    _xres_h = parent_def.get('x-reservation')
    if (_xres_h and isinstance(_xres_h, dict)
            and _xres_h.get('mode') == 'count'
            and _xres_h.get('lines')):
        _pool_cfg_h = _xres_h.get('pool', {})
        _request_cfg_h = _xres_h.get('request', {})
        # OD-1: strategy: ledger_transaction resolves pool.entity via
        # transaction.ledgerDomain instead of declaring it directly.
        _pool_entity_h = _pool_cfg_h.get('entity')
        if not _pool_entity_h:
            _domain_key_h = (_xres_h.get('transaction') or {}).get('ledgerDomain')
            if _domain_key_h:
                _pool_entity_h = resolve_ledger_domain(schema, _domain_key_h)['pool']
        _pool_qty_h = _pool_cfg_h.get('quantityField', 'quantity')
        _criteria_h = _request_cfg_h.get('criteria', {})
        _crit_pool_field_h = next(iter(_criteria_h.keys()), None)
        if _pool_entity_h and _crit_pool_field_h:
            _pool_def_h = schema.get('definitions', {}).get(_pool_entity_h, {})
            _pool_crit_prop_h = _pool_def_h.get('properties', {}).get(_crit_pool_field_h, {})
            _pool_fk_target_h = (_pool_crit_prop_h.get('x-relationship') or {}).get('target', '')
            _pool_fk_dep_var_h = next(
                (d['var_name'] for d in enriched_deps if d['target'] == _pool_fk_target_h),
                None
            )
            if _pool_fk_dep_var_h:
                reservation_lines_pool_seed = {
                    'pool_entity': _pool_entity_h,
                    'pool_qty_field': _pool_qty_h,
                    'criteria_pool_field': _crit_pool_field_h,
                    'pool_fk_dep_var': _pool_fk_dep_var_h,
                }

    # Detect count-mode reservation WITHOUT lines: populateDependencies must seed the pool entity
    # even when the entity has no FK deps (e.g. supply_request → supply_pool).
    reservation_nolines_pool_seed = None
    if (_xres_h and isinstance(_xres_h, dict)
            and _xres_h.get('mode') == 'count'
            and not _xres_h.get('lines')):
        _pool_cfg_nolines = _xres_h.get('pool', {})
        _pool_entity_nolines = _pool_cfg_nolines.get('entity')
        _pool_qty_nolines = _pool_cfg_nolines.get('quantityField', 'quantity')
        if _pool_entity_nolines:
            _pool_def_nolines = schema.get('definitions', {}).get(_pool_entity_nolines, {})
            _pool_has_name_nolines = 'name' in (_pool_def_nolines.get('properties') or {})
            reservation_nolines_pool_seed = {
                'pool_entity': _pool_entity_nolines,
                'pool_qty_field': _pool_qty_nolines,
                'has_name': _pool_has_name_nolines,
                'pool_title': to_title_case(_pool_entity_nolines),
            }

    return {
        'pascal': pascal,
        'title': title,
        'model_name': model_name,
        'deps': enriched_deps,
        'deps_return': deps_return,
        'non_self_deps': non_self_deps,
        'self_ref_deps': self_ref_deps,
        'has_self_ref_deps': has_self_ref_deps,
        'non_self_deps_return': non_self_deps_return,
        'has_parent_deps': bool(entity_fk_deps) or bool(ua_dep_fields),
        'needs_deps_in_populate': needs_deps_in_populate,
        'needs_deps_in_populate_full': needs_deps_in_populate_full,
        'ua_dep_fields': ua_dep_fields,
        'ua_dep_fields_full': ua_dep_fields_full,
        'required_fields_prisma': required_fields_prisma,
        'all_fields_prisma': all_fields_prisma,
        'extra_prisma_fields': extra_prisma_fields,
        'has_optional': bool(optional_field_metas),
        'datagrid_children': enriched_datagrid_children,
        'comment_children': enriched_comment_children,
        'primary_fk_dep': primary_fk_dep,
        'internal_fk_deps': internal_fk_deps,
        'has_approvable': has_approvable,
        'flatten_test_rels': flatten_test_rels,
        # If any dep label expression resolves a date/time field, the helper
        # must import formatLabelValue so the rendered name matches the UI.
        'needs_format_label_value': any(d.get('label_has_format') for d in enriched_deps),
        'reservation_lines_pool_seed': reservation_lines_pool_seed,
        'reservation_nolines_pool_seed': reservation_nolines_pool_seed,
        # cmd_421 Domain 4 (M1)
        'has_mention_comments': has_mention_comments,
        'commentable_fk_prop': commentable_fk_prop,
        'mention_field_name': mention_field_name,
    }


def spec_context(
    parent: str,
    children: list,
    schema: dict,
    model_name: str,
    definition_key: str,
    generate_config: dict,
    test_entity_count: int | None = None,
) -> dict:
    parent_def = schema['definitions'].get(model_name)
    if not parent_def or not parent_def.get('properties'):
        return {}

    title = to_title_case(parent)
    pascal = to_pascal_case(parent)
    properties = filter_fields(parent_def['properties'], generate_config.get('fields'))
    required_fields = parent_def.get('required') or []
    relationships = get_parent_relationships(parent_def, schema)
    entity_options = _get_entity_options(schema)
    fields = get_field_metas(properties, required_fields, relationships, generate_config.get('fields'), entity_options)
    # Exclude outbound one-to-one FK fields (internal bridge records, not user-facing).
    _internal_fk_prop_names = {d['prop_name'] for d in get_internal_one_to_one_fks(model_name, schema)}
    fields = [f for f in fields if f['prop_name'] not in _internal_fk_prop_names]
    # Mark read-only fields: kept in `fields` for seed/prisma data, skipped by UI
    # fill/clear/assert commands (the form renders them non-editable).
    _readonly_props = _readonly_field_names(parent_def)
    for _f in fields:
        _f['readonly'] = _f['prop_name'] in _readonly_props
    deps = resolve_dependencies(model_name, schema)

    # Collect ALL user_account FK fields (required and optional) for fill/assert commands.
    # req_ua_spec: required only (for section 2.1, 5.x); all_ua_spec: all (for section 2.2)
    req_ua_spec = []
    all_ua_spec = []
    for r in relationships:
        if r['target'] == 'user' and r['prop_name'] not in ('creator_id', 'updater_id'):
            var_name = to_camel_case(re.sub(r'_id$', '', r['prop_name']))
            field_label = to_title_case(re.sub(r'_id$', '', r['prop_name']))
            entry = {
                'prop_name': r['prop_name'],
                'dep_var_name': var_name,
                'label': field_label,
                'dep_name': f'Test {field_label}',
            }
            all_ua_spec.append(entry)
            if r['prop_name'] in required_fields:
                req_ua_spec.append(entry)
    ua_dep_fields_spec = req_ua_spec  # kept for template backward-compat

    # Build fk_dep_vars: {prop_name: dep_var_name} for all non-UA FK relationships.
    # Uses prop-stem-based var_names so self-ref FKs get e.g. 'parent' not 'procedure'.
    fk_dep_vars = {}
    for r in relationships:
        if r['target'] != 'user' and r['prop_name'] not in ('creator_id', 'updater_id'):
            prop_stem = re.sub(r'_id$', '', r['prop_name'])
            fk_dep_vars[r['prop_name']] = to_camel_case(prop_stem)

    # dep_search_info: {prop_name: {search_differs}} — mirrors the same
    # label_field-derived computation helper_context() does per dep, so
    # gen_fill_commands() knows (independently of helper_context, which builds
    # a different template) whether to type deps.X.searchName instead of
    # deps.X.name. See RC6 (cmd_323): non-string labelField segments (e.g.
    # expiration_date) aren't searchable server-side.
    dep_search_info = {}
    for r in relationships:
        if r['target'] == 'user' or r['prop_name'] in ('creator_id', 'updater_id'):
            continue
        dep_var = fk_dep_vars.get(r['prop_name'])
        if not dep_var:
            continue
        label_field = r.get('label_field', 'name')
        search_differs = False
        if label_field and label_field != 'name':
            item_var = f'{dep_var}Record'
            label_expr = build_label_expression(item_var, label_field, r['target'], schema)['expression']
            search_expr = build_string_only_label_expression(item_var, label_field, r['target'], schema)
            search_differs = bool(search_expr and search_expr != label_expr)
        dep_search_info[r['prop_name']] = {'search_differs': search_differs}

    child_metas = analyze_children(children, schema, model_name)
    list_autocomplete_children = [c for c in child_metas if c['render_type'] == 'editable-list-autocomplete']

    # Include self-referential FK deps and m2m self-ref children in has_deps
    if not any(d['target'] == model_name for d in deps):
        # Self-ref FK fields
        for r in relationships:
            if r['target'] == model_name and r['prop_name'] not in ('updater_id',):
                deps.append({'target': model_name, 'var_name': to_camel_case(model_name)})
                break
    # m2m self-ref autocomplete children also need deps
    has_m2m_self_ref = any(
        (c['child'].get('relationship') or {}).get('target') == model_name
        for c in list_autocomplete_children
    )
    if has_m2m_self_ref and not any(d['target'] == model_name for d in deps):
        deps.append({'target': model_name, 'var_name': to_camel_case(model_name)})

    datagrid_children = [c for c in child_metas if c['render_type'] == 'datagrid']
    # Datagrid children may have FK deps not on the parent (e.g. field.reference_id → db_table)
    has_child_fk_deps = any(
        f['category'] == 'autocomplete' and f.get('dep_target') and f.get('dep_target') != 'user'
        for c in datagrid_children
        for f in c['fields']
    )
    has_deps = bool(deps) or bool(all_ua_spec) or has_child_fk_deps

    # Count-mode reservation WITHOUT lines: Create tests must call populateDependencies
    # to seed the pool entity even when the entity has no FK deps.
    _xres_spec = parent_def.get('x-reservation')
    _has_nolines_reservation = (
        bool(_xres_spec)
        and isinstance(_xres_spec, dict)
        and _xres_spec.get('mode') == 'count'
        and not _xres_spec.get('lines')
        and bool((_xres_spec.get('pool') or {}).get('entity'))
    )
    needs_pool_for_create = _has_nolines_reservation and not has_deps

    # Note: read-only fields stay in these lists so seed/prisma create data includes
    # their required values; the fill/clear/assert command builders skip them.
    required_field_metas = [f for f in fields if f['required']]
    optional_field_metas = [f for f in fields if not f['required']]
    # Fail-edit/clear target must be a user-editable required field (not read-only).
    non_autocomplete_required = [
        f for f in required_field_metas
        if f['category'] != 'autocomplete' and not f.get('readonly')
    ]
    # Only include editable-list-autocomplete (optional-FK reverse lists).
    # editable-list-text children have a required FK to the parent, so the product
    # UI does not show Add/remove management on the parent form — skip them in tests.
    list_children = [c for c in child_metas if c['render_type'] == 'editable-list-autocomplete']
    comment_children = [c for c in child_metas if c['render_type'] == 'comments']

    can_list   = generate_config.get('list', True)
    can_new    = generate_config.get('new', True)
    can_edit   = generate_config.get('edit', True)
    can_delete = generate_config.get('delete', True)
    can_view   = generate_config.get('view', True)

    # Indentation for .then((deps) => {}) wrapper in sections 2 and 5
    I = '        ' if (has_deps or needs_pool_for_create) else '      '

    # Pre-compute fill/assert command lists (indent already baked in), with fk_dep_vars.
    # flatten_m2o_fk_props: FK props on this model whose related-entity Detail
    # was tagged x-outputType: flatten. The FormView renders those as MUI
    # Accordions (entity-level title in <Typography>, inner fields as
    # TextFields), not as a single TextField with the FK label. View-page
    # assertions must navigate into the accordion to a real <label>.
    flatten_m2o_props_view = {
        f"{r['prop_name']}_id"
        for r in get_flatten_rels(parent, parent_def, schema)
        if r['is_m2o']
    }
    required_fill_cmds = gen_fill_commands(required_field_metas, title, I, fk_dep_vars, dep_search_info)
    all_fill_cmds = gen_fill_commands(fields, title, I, fk_dep_vars, dep_search_info)
    required_assert_cmds_no_bool = gen_assert_commands(
        [f for f in required_field_metas if f['category'] != 'boolean'], title, I, fk_dep_vars,
        flatten_m2o_props=flatten_m2o_props_view, schema=schema)
    all_assert_cmds_no_bool = gen_assert_commands(
        [f for f in fields if f['category'] != 'boolean'], title, I, fk_dep_vars,
        flatten_m2o_props=flatten_m2o_props_view, schema=schema)

    # Append user_account FK fill/assert commands (required UA for req_cmds; all UA for all_cmds)
    for ua in req_ua_spec:
        required_fill_cmds.append(f"{I}cy.selectAutocomplete('{ua['label']}', deps.{ua['dep_var_name']}.name);")
        required_assert_cmds_no_bool.append(f"{I}cy.checkField('{ua['label']}', '{ua['dep_name']}');")
    for ua in all_ua_spec:
        all_fill_cmds.append(f"{I}cy.selectAutocomplete('{ua['label']}', deps.{ua['dep_var_name']}.name);")
        all_assert_cmds_no_bool.append(f"{I}cy.checkField('{ua['label']}', '{ua['dep_name']}');")

    # Compute list identifiers based on primary display field.
    # Priority: FK primary → explicit non-name primary → name → fallback.
    prim = _get_primary_display_field_name(parent_def)
    prim_is_fk = bool(prim and f'{prim}_id' in (parent_def.get('properties') or {}))
    has_name = any(f['prop_name'] == 'name' for f in fields)
    prim_meta = next((f for f in fields if f['prop_name'] == prim), None) if prim else None
    # Default values; overridden in branches where the primary FK is rendered
    # as a flatten Accordion (see prim_is_fk + flatten branch below).
    check_field_use_accordion = False
    check_field_inner_label = None
    check_field_skip = False

    if prim_is_fk:
        primary_rel = next((r for r in relationships if r['prop_name'] == f'{prim}_id'), None)
        dep_title = to_title_case(prim)
        list_id_1 = _seed_relation_label_value(
            primary_rel['target'],
            primary_rel.get('label_field', 'name'),
            primary_rel.get('label_field_is_date', False),
            schema,
            unique_index=1,
        ) if primary_rel else f'Test {dep_title} 1'
        list_id_is_unique = True
        after_create_id = None
        after_create_id_is_expr = True
        primary_dep_var_for_list = to_camel_case(prim)
        list_id_updated = _seed_relation_label_value(
            primary_rel['target'],
            primary_rel.get('label_field', 'name'),
            primary_rel.get('label_field_is_date', False),
            schema,
            unique_index=2,
        ) if primary_rel else list_id_1
        has_edit_primary = True
        edit_field_label = dep_title
        edit_update_value = list_id_updated
        check_field_label = dep_title
        check_field_value_1 = list_id_1
        check_field_updated = list_id_updated
        # When the primary FK is rendered as a flatten Accordion in FormView,
        # the FK label is on AccordionSummary's <Typography> — not a TextField
        # <label>. The view-page assertions for sections 3.1 / 3.3 must drill
        # into the inner label-field TextField.
        if f'{prim}_id' in flatten_m2o_props_view and primary_rel:
            check_field_use_accordion = True
            inner = primary_rel.get('label_field', 'name')
            # List-form label collapses to the leaf of its first path so the
            # inner TextField label rendered by FormView is matched exactly.
            if isinstance(inner, list):
                inner = inner[0] if inner else 'name'
            check_field_inner_label = to_title_case(str(inner).split('.')[-1])
        else:
            check_field_use_accordion = False
            check_field_inner_label = None
    elif prim and prim != 'name' and prim_meta:
        # Explicit non-name primary field (e.g., product.code or entity_name).
        # Link in the list is on this column, so use it for all click navigation.
        lbl = prim_meta.get('label', to_title_case(prim))
        if prim_meta.get('category') == 'entity_select':
            opts = prim_meta.get('entity_options') or []
            # first_val: use opts[0] — always visible (present in grantAllEntityPermissions data)
            # second_val: use first safe (non-test) option to avoid rename conflict in test 3.3
            first_val   = opts[0]['value'] if opts else ''
            first_label = opts[0]['label'] if opts else ''
            safe = _safe_entity_opts(opts, schema)
            safe_excl_first = [o for o in safe if o['value'] != first_val]
            second_val   = safe_excl_first[0]['value'] if safe_excl_first else (opts[1]['value'] if len(opts) > 1 else first_val)
            second_label = safe_excl_first[0]['label'] if safe_excl_first else (opts[1]['label'] if len(opts) > 1 else first_label)
            list_id_1 = first_val
            list_id_is_unique = False
            after_create_id = first_val
            after_create_id_is_expr = False
            primary_dep_var_for_list = None
            list_id_updated = second_val
            has_edit_primary = True
            edit_field_label = lbl
            edit_update_value = second_label
            check_field_label = lbl
            check_field_value_1 = first_label
            check_field_updated = second_label
        elif prim_meta.get('category') == 'enum':
            # Integer enum primary (e.g. plan.tier = [free, premium, vip])
            raw_vals = [str(v) for v in (prim_meta.get('enum_values') or [])]
            prim_prop = prim_meta.get('prop_name', prim or '')
            if _messages_fields:
                enum_labels = [_messages_fields.get(f'{prim_prop}_{v}', v) for v in raw_vals]
            else:
                enum_labels = raw_vals
            list_id_1 = enum_labels[0] if enum_labels else f'Test {lbl} 1'
            list_id_is_unique = False
            after_create_id = enum_labels[0] if enum_labels else f'Test {lbl}'
            after_create_id_is_expr = False
            primary_dep_var_for_list = None
            list_id_updated = (enum_labels[1] if len(enum_labels) > 1 else enum_labels[0]) if enum_labels else list_id_1
            has_edit_primary = True
            edit_field_label = lbl
            edit_update_value = list_id_updated
            check_field_label = lbl
            check_field_value_1 = list_id_1
            check_field_updated = list_id_updated
        elif prim_meta.get('category') == 'number':
            _first_val = cypress_create_value(prim_meta, title)   # '100'
            _edit_val  = cypress_edit_value(prim_meta, title)     # '200'
            list_id_1 = _first_val
            list_id_is_unique = True
            after_create_id = _first_val
            after_create_id_is_expr = False
            primary_dep_var_for_list = None
            list_id_updated = _edit_val
            has_edit_primary = True
            edit_field_label = lbl
            edit_update_value = _edit_val
            check_field_label = lbl
            check_field_value_1 = _first_val
            check_field_updated = _edit_val
        else:
            list_id_1 = f'Test {lbl} 1'
            list_id_is_unique = True
            after_create_id = cypress_create_value(prim_meta, title)
            after_create_id_is_expr = False
            primary_dep_var_for_list = None
            list_id_updated = f'Updated {lbl}'
            has_edit_primary = True
            edit_field_label = lbl
            edit_update_value = f'Updated {lbl}'
            check_field_label = lbl
            check_field_value_1 = list_id_1
            check_field_updated = list_id_updated
    elif has_name:
        name_meta = next((f for f in fields if f['prop_name'] == 'name'), None)
        if name_meta and name_meta.get('category') == 'entity_select':
            opts = name_meta.get('entity_options') or []
            # first_val: use opts[0] — always visible (present in grantAllEntityPermissions data)
            # second_val: use first safe (non-test) option to avoid rename conflict in test 3.3
            first_val   = opts[0]['value'] if opts else ''
            first_label = opts[0]['label'] if opts else ''
            safe = _safe_entity_opts(opts, schema)
            safe_excl_first = [o for o in safe if o['value'] != first_val]
            second_val   = safe_excl_first[0]['value'] if safe_excl_first else (opts[1]['value'] if len(opts) > 1 else first_val)
            second_label = safe_excl_first[0]['label'] if safe_excl_first else (opts[1]['label'] if len(opts) > 1 else first_label)
            list_id_1 = first_val
            list_id_is_unique = False
            after_create_id = first_val
            after_create_id_is_expr = False
            primary_dep_var_for_list = None
            list_id_updated = second_val
            has_edit_primary = True
            edit_field_label = 'Name'
            edit_update_value = second_label
            check_field_label = 'Name'
            check_field_value_1 = first_label
            check_field_updated = second_label
        else:
            list_id_1 = f'{title} 1'
            list_id_is_unique = True
            after_create_id = f'Test {title}'
            after_create_id_is_expr = False
            primary_dep_var_for_list = None
            list_id_updated = f'Updated {title}'
            has_edit_primary = True
            edit_field_label = 'Name'
            edit_update_value = f'Updated {title}'
            check_field_label = 'Name'
            check_field_value_1 = f'{title} 1'
            check_field_updated = f'Updated {title}'
    else:
        # Check if prim is a virtual column (not in properties, no prim_meta)
        _props_vc = parent_def.get('properties') or {}
        _prim_is_virtual = (prim and prim_meta is None and not prim_is_fk
                            and prim not in _props_vc and f'{prim}_id' not in _props_vc)
        _is_creator_virtual = prim == 'created_by' or 'creator_id' in _props_vc
        if _prim_is_virtual and _is_creator_virtual:
            # Virtual column resolved from creator (testUser.name = 'Test User')
            list_id_1 = 'Test User'
            list_id_is_unique = False
            after_create_id = 'Test User'
            after_create_id_is_expr = False
            primary_dep_var_for_list = None
            list_id_updated = 'Test User'
            has_edit_primary = False
            edit_field_label = None
            edit_update_value = None
            check_field_label = to_title_case(prim) if prim else 'Name'
            check_field_value_1 = 'Test User'
            check_field_updated = 'Test User'
            check_field_skip = True  # created_by is list-only virtual; not in FormView
        else:
            list_id_1 = f'{title} 1'
            list_id_is_unique = True
            after_create_id = f'Test {title}'
            after_create_id_is_expr = False
            primary_dep_var_for_list = None
            list_id_updated = f'Updated {title}'
            has_edit_primary = True
            edit_field_label = 'Name'
            edit_update_value = f'Updated {title}'
            check_field_label = 'Name'
            check_field_value_1 = f'{title} 1'
            check_field_updated = f'Updated {title}'

    # detail_required: which children are required in the parent form
    detail_def = schema['definitions'].get(definition_key, {})
    detail_required: list = list(detail_def.get('required') or [])
    for item in detail_def.get('allOf', []):
        if item.get('required'):
            detail_required.extend(item['required'])

    # Datagrid children data
    datagrid_children_data = []
    for child_meta in datagrid_children:
        child_name = child_meta['child']['name']
        fk_create_fields = gen_child_datagrid_fk_fields(child_meta['required_fields'], schema)
        fk_full_fields = gen_child_datagrid_fk_fields(child_meta['fields'], schema)
        datagrid_children_data.append({
            'title': child_meta['names']['title'],
            'pascal': to_pascal_case(child_name),
            'is_required_in_parent': child_meta['child']['property_name'] in detail_required,
            'create_obj': gen_child_datagrid_object(child_meta, 'create'),
            'full_create_obj': gen_child_full_datagrid_object(child_meta),
            'fk_create_fields': fk_create_fields,
            'fk_full_fields': fk_full_fields,
        })

    # List children data
    list_children_data = []
    for child_meta in list_children:
        rel = child_meta['child'].get('relationship') or {}
        rel_target = rel.get('target', '') or child_meta['child']['name']
        prop_name = child_meta['child']['property_name']
        # Self-ref autocomplete children (m2m or optional-FK reverse) use deps.{var}.name
        is_self_ref_autocomplete = (child_meta['render_type'] == 'editable-list-autocomplete'
                                    and rel_target == model_name)
        dep_var_name = to_camel_case(prop_name) if is_self_ref_autocomplete else None
        # Compute expected autocomplete label for seed index 1
        # name fields: seed uses `${entity_title} ${i}` → 'Character 1' for character
        # other string fields: seed uses `Test ${field_title} ${i}` → 'Test Title 1' for music.title
        _ac_lf = rel.get('label_field', 'name') or 'name'
        if not rel_target:
            _ac_label_1 = ''
        elif _ac_lf == 'name':
            _ac_label_1 = f'{to_title_case(rel_target)} 1'
        else:
            _ac_label_1 = f'Test {to_title_case(_ac_lf)} 1'
        list_children_data.append({
            'singular_pascal': child_meta['names']['singular_pascal_name'],
            'title': child_meta['names']['title'],
            'render_type': child_meta['render_type'],
            'rel_target': rel_target,
            'rel_target_title': to_title_case(rel_target) if rel_target else '',
            'target_pascal': to_pascal_case(rel_target) if rel_target else '',
            'is_external_target': bool(rel_target and rel_target != model_name),
            'dep_var_name': dep_var_name,
            'label_field': _ac_lf,
            'autocomplete_seed_label_1': _ac_label_1,
        })

    # Comment children data
    comment_children_data = []
    for child_meta in comment_children:
        child_name = child_meta['child']['name']
        comment_children_data.append({
            'title': child_meta['names']['title'],
            'pascal': to_pascal_case(child_name),
        })

    # Section 3.1: optional fill commands (8-space indent)
    # When deps are available, include optional autocomplete fields too; otherwise omit them.
    use_deps_in_3_1 = has_deps and (can_list is not False)
    opt_fill_cmds_3_1_non_ac = [
        gen_fill_command(f, cypress_create_value(f, title), '        ')
        for f in optional_field_metas
        if f['category'] != 'autocomplete' and not f.get('readonly')
    ]
    opt_fill_cmds_3_1_ac = gen_fill_commands(
        [f for f in optional_field_metas if f['category'] == 'autocomplete'],
        title, '        ', fk_dep_vars, dep_search_info,
    ) if use_deps_in_3_1 else []
    # Optional UA FK fields (excluded from field_metas; appended separately via all_ua_spec)
    opt_ua_spec = [ua for ua in all_ua_spec if ua['prop_name'] not in required_fields]
    opt_fill_cmds_3_1_ua = [
        f"        cy.selectAutocomplete('{ua['label']}', deps.{ua['dep_var_name']}.name);"
        for ua in opt_ua_spec
    ] if use_deps_in_3_1 else []
    opt_fill_cmds_3_1 = opt_fill_cmds_3_1_non_ac + opt_fill_cmds_3_1_ac + opt_fill_cmds_3_1_ua

    # Section 3.2: optional clear commands (8-space indent, non-autocomplete only)
    opt_clear_cmds_3_2 = [
        gen_clear_command(f, '        ')
        for f in optional_field_metas
        if f['category'] != 'autocomplete' and not f.get('readonly')
    ]

    # Section 3.3: primary field edit command
    use_deps_in_3_3 = False
    # If the primary field is a FK the form renders an autocomplete picker, and the
    # populate() helper creates a fresh target row per index — so we need at least
    # two rows in the DB for the test to switch from "Test X 1" to "Test X 2".
    populate_count_3_3 = 2 if prim_is_fk else 1
    if has_edit_primary and edit_field_label and edit_update_value:
        prim_edit_meta = next(
            (f for f in fields if f.get('label') == edit_field_label), None
        )
        if prim_edit_meta and prim_edit_meta.get('category') in ('entity_select', 'autocomplete', 'enum'):
            if prim_edit_meta.get('category') == 'enum':
                # In edit mode the enum Autocomplete already has a value selected;
                # clear it first so selectAutocomplete can open the dropdown cleanly.
                edit_primary_cmd = (
                    f"        cy.clearAutocomplete('{edit_field_label}');\n"
                    f"        cy.selectAutocomplete('{edit_field_label}', '{edit_update_value}');"
                )
            else:
                edit_primary_cmd = f"        cy.selectAutocomplete('{edit_field_label}', '{edit_update_value}');"
            use_deps_in_3_3 = prim_edit_meta.get('category') == 'autocomplete' and has_deps
        elif prim_is_fk:
            # User-account primary FKs (and any other primary FK that
            # `get_field_metas` filters out of `fields`) miss the lookup above
            # but still render as autocomplete pickers in the form. Use
            # selectAutocomplete and rely on populate_count_3_3==2 to ensure
            # the "Test X 2" target row exists.
            edit_primary_cmd = f"        cy.selectAutocomplete('{edit_field_label}', '{edit_update_value}');"
        else:
            edit_primary_cmd = f"        cy.clearAndFillField('{edit_field_label}', '{edit_update_value}');"
    else:
        edit_primary_cmd = None

    # Section 3.3: edit value for first non-autocomplete optional field
    edit_fill_cmd_3_3 = None
    if optional_field_metas:
        first_opt = next(
            (f for f in optional_field_metas
             if f['category'] != 'autocomplete' and not f.get('readonly')),
            None,
        )
        if first_opt is not None:
            edit_fill_cmd_3_3 = gen_fill_command(first_opt, cypress_edit_value(first_opt, title), '        ')

    # Section 5.1: fill all required fields except one
    fail_create_5_1 = None
    if required_field_metas:
        primary_required_fk = next(
            (f for f in required_field_metas if f['category'] == 'autocomplete' and f['label'] == to_title_case(prim or '')),
            None,
        ) if prim_is_fk else None
        field_to_skip = next(
            (f for f in non_autocomplete_required if f['prop_name'] == 'name'),
            primary_required_fk or (non_autocomplete_required[0] if non_autocomplete_required else required_field_metas[0]),
        )
        fields_to_fill_5_1 = [f for f in required_field_metas if f['prop_name'] != field_to_skip['prop_name']]
        fail_create_5_1 = {'fill_cmds': gen_fill_commands(fields_to_fill_5_1, title, I, dep_search_info=dep_search_info)}

    # Section 5.2: missing scalar required child field; 5.3: missing FK required child field
    fail_create_5_2_scalar = None
    fail_create_5_2_fk = None
    children_with_required = [c for c in datagrid_children if c['required_fields']]
    if children_with_required:
        test_child = children_with_required[0]
        req_child_fields = test_child['required_fields']
        child_title = test_child['names']['title']
        scalar_required = [f for f in req_child_fields if f['category'] != 'autocomplete']
        fk_required = [f for f in req_child_fields if f['category'] == 'autocomplete']

        # 5.2: add child with all FK fields selected but one scalar field missing
        if scalar_required:
            skip_scalar = scalar_required[0]
            partial_scalar = [f for f in scalar_required if f['prop_name'] != skip_scalar['prop_name']]
            entries = _child_scalar_entries(partial_scalar, child_title, cypress_create_value)
            fail_create_5_2_scalar = {
                'title': child_title,
                'partial_obj': ('{ ' + ', '.join(entries) + ' }') if entries else None,
                'fk_fields': gen_child_datagrid_fk_fields(fk_required, schema),
                'fill_cmds': gen_fill_commands(required_field_metas, title, I, dep_search_info=dep_search_info),
            }

        # 5.3: add child with all scalar fields filled but no FK selection
        if fk_required:
            entries = _child_scalar_entries(scalar_required, child_title, cypress_create_value)
            fail_create_5_2_fk = {
                'title': child_title,
                'partial_obj': ('{ ' + ', '.join(entries) + ' }') if entries else None,
                'fill_cmds': gen_fill_commands(required_field_metas, title, I, dep_search_info=dep_search_info),
            }

    # Section 6.1: clear a required field
    fail_edit_6_1 = None
    if required_field_metas:
        primary_required_fk = next(
            (f for f in required_field_metas if f['category'] == 'autocomplete' and f['label'] == to_title_case(prim or '')),
            None,
        ) if prim_is_fk else None
        field_to_clear = next(
            (f for f in non_autocomplete_required if f['prop_name'] == 'name'),
            primary_required_fk or (non_autocomplete_required[0] if non_autocomplete_required else required_field_metas[0]),
        )
        fail_edit_6_1 = {
        'clear_cmd': gen_clear_command(field_to_clear, '      '),
        'clear_cmd_nested': gen_clear_command(field_to_clear, '        '),
    }

    # Section 6.2: clear a non-FK required child field (singleSelect cannot be cleared via input)
    fail_edit_6_2 = None
    children_with_req = [c for c in datagrid_children if c['required_fields']]
    if children_with_req:
        test_child = children_with_req[0]
        child_field_to_clear = next(
            (f for f in test_child['required_fields'] if f['category'] != 'autocomplete'),
            None,
        )
        if child_field_to_clear:
            fail_edit_6_2 = {
                'child_pascal': to_pascal_case(test_child['child']['name']),
                'field_prop_name': child_field_to_clear['prop_name'],
            }

    # Count records pre-created by db:seed + db:grantAllPermissions.
    # role: 1 Administrator role; permission: 1 per test entity (ALL_ENTITIES); user: 1 test user.
    if parent == 'role':
        seed_count = 1
    elif parent == 'permission':
        seed_count = test_entity_count if test_entity_count is not None else 0
    elif parent == 'user':
        seed_count = 1
    else:
        seed_count = 0

    return {
        'parent': parent,
        'pascal': pascal,
        'title': title,
        'model_name': model_name,
        'can_list': can_list,
        'can_new': can_new,
        'can_edit': can_edit,
        'can_delete': can_delete,
        'can_view': can_view,
        'has_deps': has_deps,
        'needs_pool_for_create': needs_pool_for_create,
        'has_optional': bool(optional_field_metas),
        'has_children': bool(child_metas),
        'has_datagrid_children': bool(datagrid_children),
        'has_datagrid_fk_children': any(c['fk_create_fields'] or c['fk_full_fields'] for c in datagrid_children_data),
        'I': I,
        'required_fill_cmds': required_fill_cmds,
        'all_fill_cmds': all_fill_cmds,
        'required_assert_cmds_no_bool': required_assert_cmds_no_bool,
        'all_assert_cmds_no_bool': all_assert_cmds_no_bool,
        'datagrid_children_data': datagrid_children_data,
        'list_children_data': list_children_data,
        'comment_children_data': comment_children_data,
        'use_deps_in_3_1': use_deps_in_3_1,
        'opt_fill_cmds_3_1': opt_fill_cmds_3_1,
        'opt_clear_cmds_3_2': opt_clear_cmds_3_2,
        'use_deps_in_3_3': use_deps_in_3_3,
        'populate_count_3_3': populate_count_3_3,
        'edit_primary_cmd': edit_primary_cmd,
        'edit_fill_cmd_3_3': edit_fill_cmd_3_3,
        'fail_create_5_1': fail_create_5_1,
        'fail_create_5_2_scalar': fail_create_5_2_scalar,
        'fail_create_5_2_fk': fail_create_5_2_fk,
        'fail_edit_6_1': fail_edit_6_1,
        'fail_edit_6_2': fail_edit_6_2,
        # List identifiers
        'list_id_1': list_id_1,
        'list_id_is_unique': list_id_is_unique,
        'after_create_id': after_create_id,
        'after_create_id_is_expr': after_create_id_is_expr,
        'primary_dep_var_for_list': primary_dep_var_for_list,
        'list_id_updated': list_id_updated,
        'has_edit_primary': has_edit_primary,
        'edit_field_label': edit_field_label,
        'edit_update_value': edit_update_value,
        'check_field_label': check_field_label,
        'check_field_value_1': check_field_value_1,
        'check_field_updated': check_field_updated,
        'check_field_use_accordion': check_field_use_accordion,
        'check_field_inner_label': check_field_inner_label,
        'check_field_skip': check_field_skip,
        'has_approvable': any(d['target'] == 'approvable' for d in get_internal_one_to_one_fks(model_name, schema)),
        'flatten_test_rels': _compute_flatten_test_rels(parent, pascal, definition_key, schema),
        'seed_count': seed_count,
        'bridge_child_ir': get_new_form_bridge(schema.get('definitions', {}).get(model_name, {})),
    }


def tasks_registry_context(entities: list, schema: dict) -> dict:
    """Build context for the generated-tasks.ts registry template.

    `entities` is a list of dicts: {parent, model_name, children}.
    """
    enriched_entities = []
    # The fallback `db:populateUser` task at the bottom of the registry only
    # fires when the `user` entity is *not* in the test loop (i.e. user_detail
    # has `test: false`). When user_detail.test: true, the standard
    # per-entity loop emits `db:populateUser` from `entity.pascal` — emitting
    # the hardcoded one too would produce a duplicate-identifier TS error.
    user_in_entities = any(e.get('parent') == 'user' for e in entities)
    has_user_account_populate = False
    # cmd_421 Domain 4 (M1): schema-wide constant — does the shared 'comment'
    # model have an x-mention: true field at all. Combined per-entity below
    # with a one-to-one_bridge FK to 'commentable' (mirrors helper_context).
    _reg_comment_def = schema.get('definitions', {}).get('comment', {}) or {}
    _reg_comment_has_mention_field = any(
        isinstance(fp, dict) and fp.get('x-mention') is True
        for fp in (_reg_comment_def.get('properties') or {}).values()
    )
    for entity in entities:
        parent = entity['parent']
        pascal = to_pascal_case(parent)
        child_metas = analyze_children(entity['children'], schema, entity['model_name'])
        datagrid_children = [c for c in child_metas if c['render_type'] == 'datagrid']
        list_children = [c for c in child_metas if c['render_type'] in ('editable-list-autocomplete', 'editable-list-text')]
        comment_children_registry = [c for c in child_metas if c['render_type'] == 'comments']
        for lc in list_children:
            rel = lc['child'].get('relationship') or {}
            if rel.get('target') == 'user':
                has_user_account_populate = True
        has_approvable = any(
            d['target'] == 'approvable'
            for d in get_internal_one_to_one_fks(entity['model_name'], schema)
        )
        definition_key = entity.get('definition_key', f'{parent}_detail')
        flatten_test_rels = _compute_flatten_test_rels(parent, pascal, definition_key, schema)
        _xres = (schema.get('definitions', {}).get(parent) or {}).get('x-reservation', {})
        has_reservation = bool(_xres and _xres.get('mode') == 'count')
        has_mention_comments = _reg_comment_has_mention_field and any(
            d['target'] == 'commentable'
            for d in get_internal_one_to_one_fks(entity['model_name'], schema)
        )
        enriched_entities.append({
            'parent': parent,
            'pascal': pascal,
            'helper_path': f'./{parent}/helper',
            'reservation_helper_path': f'./{parent}/reservation_gen_helper',
            'datagrid_children': [
                {'pascal': to_pascal_case(c['child']['name'])}
                for c in datagrid_children
            ],
            'comment_children': [
                {'pascal': to_pascal_case(c['child']['name'])}
                for c in comment_children_registry
            ],
            'has_approvable': has_approvable,
            'has_reservation': has_reservation,
            'has_mention_comments': has_mention_comments,
            'flatten_test_rels': flatten_test_rels,
        })
    if user_in_entities:
        has_user_account_populate = False
    return {'entities': enriched_entities, 'has_user_account_populate': has_user_account_populate}


def api_spec_context(
    parent: str,
    children: list,
    schema: dict,
    model_name: str | None = None,
    definition_key: str | None = None,
    generate_config: dict | None = None,
    test_entity_count: int | None = None,
) -> dict:
    model = model_name or parent
    parent_pascal = to_pascal_case(parent)
    title = to_title_case(parent)
    api_path = f'/api/{parent}'

    model_def = schema['definitions'].get(model)
    if not model_def:
        return {}

    gen_cfg = generate_config or {}
    filtered_props = filter_fields(model_def.get('properties') or {}, gen_cfg.get('fields'))
    relationships = get_parent_relationships({**model_def, 'properties': filtered_props}, schema)

    # is_searchable (cmd_421 Domain 5): whether this entity actually participates
    # in the global full-text search index (lib/search/helpers.ts), so the API
    # e2e template can assert per-entity data surfaces via /api/search. Mirrors
    # the is_search + text_fields derivation in generate.py's search_entities
    # loop exactly — same x-generator.search.default_scope / x-audit / explicit
    # x-generate.search precedence, and the same "no derivable text_fields ⇒
    # not searchable" fallback — so this flag never claims searchability that
    # generate.py's search-context build would itself skip.
    _api_detail_def = schema['definitions'].get(definition_key or f'{parent}_detail', {}) or {}
    _api_is_audited = bool(
        _api_detail_def.get('x-audit') is True
        or model_def.get('x-audit') is True
    )
    _api_search_default_scope = (schema.get('x-generator', {}).get('search', {}) or {}).get(
        'default_scope', 'opt_in'
    )
    _api_x_generate_raw = _api_detail_def.get('x-generate') or model_def.get('x-generate') or {}
    _api_explicit_search = _api_x_generate_raw.get('search')
    if _api_search_default_scope == 'all':
        if _api_is_audited and _api_explicit_search is None:
            is_searchable = False
        else:
            is_searchable = _api_explicit_search is not False
    else:  # opt_in
        is_searchable = _api_explicit_search is True
    search_sample_field = None
    search_sample_field_required = False
    if is_searchable:
        _api_xsearch = _api_detail_def.get('x-search') or {}
        _api_text_fields = _api_xsearch.get('text_fields') or derive_text_fields(model_def.get('properties') or {})
        if not _api_text_fields:
            is_searchable = False
        elif _api_xsearch.get('org_id_field') == 'id':
            # Self-referential org scope (e.g. the organization entity itself):
            # a freshly created row via db:populate<Entity> belongs to a
            # different org than the test user's own, so it structurally can
            # never surface in that user's search results regardless of the
            # search feature working correctly — N10 would fail by
            # construction rather than signal a real coverage gap.
            is_searchable = False
        else:
            search_sample_field = _api_text_fields[0]
            # db:populate<Entity> (the base task, used everywhere else in this
            # file) only sets required fields. When the chosen text field is
            # optional, that task leaves it null, so `records[0].<field>` is
            # null and the search query becomes a nonsense "null" string —
            # N10 fails by fixture-incompleteness, not a real coverage gap
            # (found on inventory/inventory_adjustment against the true
            # 94-entity schema: lot_number/reason are both optional and left
            # unset by the base populate helper). db:populate<Entity>Full
            # always sets every field (required + optional — see
            # ua_dep_fields_full above), so fall back to it here whenever the
            # sample field isn't required.
            search_sample_field_required = search_sample_field in (model_def.get('required') or [])

    # CSV Export (Phase 1) test context: org-scoping + x-import-key column presence.
    has_org_rel = any(r['target'] == 'organization' for r in relationships)
    should_filter_by_org = has_org_rel and model not in ('organization', 'user')
    _import_key_raw = model_def.get('x-import-key') or []
    import_key_fields = [f for f in _import_key_raw if '.' not in f]
    has_import_key = bool(_import_key_raw)

    # cmd_421 N11-N13: import eligibility gate for the CSV import round-trip
    # tests. Mirrors build_context.py's "single place" gate (殿留保 cmd_328)
    # exactly — is_primary_entity AND has_import_key AND import:true AND
    # (new:true OR edit:true) — since this test context is built by a
    # separate function and must re-derive the flag rather than reuse it.
    # import_can_update alone (not import_eligible) gates N11-N13 because the
    # round-trip technique (export an existing row, re-import it) always
    # re-matches that row by its natural key and so always exercises the
    # UPDATE branch, never CREATE — an import_eligible-but-create-only entity
    # (edit:false) would fail these tests for a structural reason unrelated
    # to any real defect.
    _api_is_primary_entity = (parent == model)
    _api_import_flag = gen_cfg.get('import', True)
    _api_can_create = gen_cfg.get('new', True) is not False
    _api_can_update = gen_cfg.get('edit', True) is not False
    import_eligible = (
        _api_is_primary_entity and has_import_key and _api_import_flag
        and (_api_can_create or _api_can_update)
    )
    import_can_update = import_eligible and _api_can_update

    # cmd_324 V1: explicit export-column allowlist + FK flatten metadata for
    # the CSV export tests (N4/N6/N7). Mirrors the equivalent computation in
    # build_context.py (used by getters.ts.jinja2 / api_export_route.ts.jinja2)
    # — this test context is built by a separate function, so the allowlist
    # must be re-derived here rather than reused.
    _api_oto_prop_names = {
        r['prop_name'] for r in relationships
        if (filtered_props.get(r['prop_name'], {}).get('x-relationship') or {}).get('type') == 'one-to-one'
    }
    _api_parent_rels_raw = [r for r in relationships if r['prop_name'] not in _api_oto_prop_names]
    _api_parent_rels = [
        {**r, 'relation_name': r['prop_name'].removesuffix('_id')}
        for r in _api_parent_rels_raw
    ]
    x_relationships_list = [
        {
            'field': r['relation_name'],
            'display_col': f"{r['relation_name']}_{r['label_field']}",
            'label_field': r['label_field'],
        }
        for r in _api_parent_rels
        if isinstance(r['label_field'], str) and '.' not in r['label_field']
    ]

    _EXPORT_SYSTEM_FIELDS = {
        'id', 'created_at', 'updated_at', 'creator_id', 'updater_id',
        'organization_id', 'tenant_id',
    }
    # cmd_420: also exclude FKs to internal bridge models (approvable_id,
    # inventory_transactionable_id, ...) — mirrors the build_context.py fix,
    # see get_internal_bridge_fk_prop_names() docstring for why
    # _api_parent_rels_raw alone misses them.
    _api_internal_bridge_fk_names = get_internal_bridge_fk_prop_names(model_def, schema)
    _api_fk_prop_names = {r['prop_name'] for r in _api_parent_rels_raw} | _api_internal_bridge_fk_names
    _export_candidates = gen_cfg.get('fields') or list(model_def.get('properties', {}).keys())

    # cmd_421 N9: the internal-bridge-FK subset of _api_fk_prop_names — these
    # columns are excluded from export_scalar_fields below precisely because
    # they're internal plumbing (approvable_id, inventory_transactionable_id,
    # ...), and N9 asserts that exclusion explicitly rather than only
    # implicitly via the N6 allowlist-equality check.
    exportable_bridge_fk_names = sorted(_api_internal_bridge_fk_names)
    has_exportable_bridge_fks = bool(exportable_bridge_fk_names)

    # cmd_421 Domain 4 (M1, subtask_421i): x-mention name resolution after
    # save. Mirrors build_context.py's comment_has_mention detection exactly
    # (the shared 'comment' model has an x-mention: true field AND this
    # entity has a one-to-one_bridge FK to 'commentable') — this test context
    # is built by a separate function so it must be re-derived here rather
    # than reused. Only the commentable-bridge shape is covered: the
    # comment_children direct-FK shape has no test populate helper of its
    # own yet (helper_context has the same scope note).
    _api_commentable_fk = next(
        (d for d in get_internal_one_to_one_fks(model, schema) if d['target'] == 'commentable'),
        None,
    )
    _api_comment_def = schema.get('definitions', {}).get('comment', {}) or {}
    _api_comment_mention_fields = [
        fn for fn, fp in (_api_comment_def.get('properties') or {}).items()
        if isinstance(fp, dict) and fp.get('x-mention') is True
    ]
    has_mention_comments = bool(_api_commentable_fk) and bool(_api_comment_mention_fields)
    commentable_rel_name = _api_commentable_fk['var_name'] if _api_commentable_fk else None
    mention_field_name = _api_comment_mention_fields[0] if _api_comment_mention_fields else None

    def _is_export_scalar(_prop: dict) -> bool:
        _ptype = _prop.get('type')
        if isinstance(_ptype, list):  # nullable scalar, e.g. ['string', 'null']
            return True
        return _ptype in ('string', 'integer', 'number', 'boolean')

    export_scalar_fields = [
        f for f in _export_candidates
        if f not in _EXPORT_SYSTEM_FIELDS
        and f not in _api_fk_prop_names
        and f in model_def.get('properties', {})
        and _is_export_scalar(model_def['properties'][f])
    ]
    # NOTE: x-import-key UNION intentionally not applied — see cmd_324 SA-1.
    export_import_key_fields = [f for f in import_key_fields if f in export_scalar_fields]

    required_fields_list = model_def.get('required') or []
    _api_entity_options = _get_entity_options(schema)
    all_field_metas = get_field_metas(filtered_props, required_fields_list, relationships, gen_cfg.get('fields'), _api_entity_options)
    # Exclude outbound one-to-one FK fields (internal bridge records — service creates them automatically).
    _api_internal_fk_prop_names = {d['prop_name'] for d in get_internal_one_to_one_fks(model, schema)}
    all_field_metas = [f for f in all_field_metas if f['prop_name'] not in _api_internal_fk_prop_names]
    # Re-add required uri-format fields excluded by get_field_metas (e.g. bookmark.url).
    # The uri skip in get_field_metas is for UI rendering; API tests must include them.
    _existing_meta_props = {f['prop_name'] for f in all_field_metas}
    for _pn, _pp in filtered_props.items():
        if _pn not in required_fields_list or _pn in _existing_meta_props:
            continue
        if _pp.get('format') == 'uri':
            all_field_metas.append({
                'prop_name': _pn,
                'label': to_title_case(_pn),
                'category': 'text',
                'required': True,
                'format': 'uri',
            })

    deps = resolve_dependencies(model, schema)
    entity_fk_deps = get_entity_fk_deps(model, schema, deps)

    child_metas = analyze_children(children, schema, model)
    api_child_metas = [c for c in child_metas if c['render_type'] != 'file']

    put_body_props = [
        k for k in filtered_props
        if k not in ('id', 'created_at', 'updated_at', 'creator_id')
        and k not in _api_internal_fk_prop_names
    ]

    # Collect readonly fields (x-readonly-fields entity-level OR x-readonly per-field).
    _ro_from_entity: set[str] = set(model_def.get('x-readonly-fields') or [])
    _ro_from_props: set[str] = {
        fn for fn, fp in (model_def.get('properties') or {}).items()
        if isinstance(fp, dict) and fp.get('x-readonly')
    }
    readonly_fields: list[str] = sorted(_ro_from_entity | _ro_from_props)

    # Primary display field detection
    primary_field_name = _get_primary_display_field_name(model_def)
    primary_is_fk = bool(
        primary_field_name
        and f'{primary_field_name}_id' in (model_def.get('properties') or {})
    )
    primary_dep_var = to_camel_case(primary_field_name) if primary_is_fk else None

    # Detect if primary FK target is user_account (per-iteration creation in populateData)
    primary_fk_rel = next(
        (r for r in relationships if r['prop_name'] == f'{primary_field_name}_id'),
        None,
    ) if primary_is_fk else None
    primary_fk_is_ua = primary_is_fk and bool(primary_fk_rel) and primary_fk_rel['target'] == 'user'

    # User_account FK fields required by the entity (e.g. customer_id)
    ua_fk_fields_for_api = [
        {'prop_name': r['prop_name'], 'var_name': to_camel_case(re.sub(r'_id$', '', r['prop_name']))}
        for r in relationships
        if r['target'] == 'user'
        and r['prop_name'] in required_fields_list
        and r['prop_name'] not in ('creator_id', 'updater_id')
    ]

    # Bridge-child entity: detect x-bridge so we can inject selectedParentType/Id
    # into API test POST bodies. The first bridge parent is used as the dep.
    _api_model_def_raw = schema['definitions'].get(model, {})
    _api_bridge_cfg = _api_model_def_raw.get('x-bridge')
    _api_bridge_first_parent: str | None = None
    if isinstance(_api_bridge_cfg, dict) and _api_bridge_cfg.get('parents'):
        _bp = (_api_bridge_cfg.get('parents') or [None])[0]
        _api_bridge_first_parent = (_bp.get('target') if isinstance(_bp, dict) else _bp) or None
    _bridge_first_parent_var = to_camel_case(_api_bridge_first_parent) if _api_bridge_first_parent else None

    has_deps = bool(entity_fk_deps) or bool(ua_fk_fields_for_api) or bool(_api_bridge_first_parent)

    I = '        ' if has_deps else '      '

    # When primary FK is user_account, find a non-FK field to use for PUT update validation
    ua_update_field = None
    ua_update_expr = None
    if primary_fk_is_ua:
        candidates = [
            f for f in all_field_metas
            if f['prop_name'] in put_body_props
            and f['category'] in ('enum', 'number')
            and f['prop_name'] not in ('creator_id', 'updater_id')
        ]
        for f in candidates:
            if f['category'] == 'enum':
                ua_update_field = f
                n = len(f['enum_values'])
                ua_update_expr = f'(records[0].{f["prop_name"]} + 1) % {n}'
                break
        if not ua_update_field:
            for f in candidates:
                if f['category'] == 'number' and f.get('max') is not None:
                    ua_update_field = f
                    mn = f.get('min', 0)
                    if mn == 0:
                        ua_update_expr = f'(records[0].{f["prop_name"]} + 1) % {f["max"] + 1}'
                    else:
                        ua_update_expr = f'Math.min({f["max"]}, records[0].{f["prop_name"]} + 1)'
                    break
        if not ua_update_field and candidates:
            ua_update_field = candidates[0]
            ua_update_expr = f'records[0].{candidates[0]["prop_name"]} + 100'

    # Compute assertions for 3.1 and 4.1 based on primary display field
    # Fallback: use 'name' field if no x-display primary is set
    has_name_field = any(f['prop_name'] == 'name' for f in all_field_metas)
    if primary_fk_is_ua and ua_update_field:
        assert_create = f'expect(getRes.body.{primary_field_name}.id).to.eq(deps.{primary_dep_var}.id);'
        assert_update = f'expect(getRes.body.{ua_update_field["prop_name"]}).to.eq({ua_update_expr});'
    elif primary_fk_is_ua:
        # user_account primary FK but no updatable scalar — can verify create but not update via UA name
        assert_create = f'expect(getRes.body.{primary_field_name}.id).to.eq(deps.{primary_dep_var}.id);'
        assert_update = 'expect(getRes.body.id).to.eq(records[0].id);'
    elif primary_is_fk:
        assert_create = f'expect(getRes.body.{primary_field_name}.id).to.eq(deps.{primary_dep_var}.id);'
        assert_update = f'expect(getRes.body.{primary_field_name}.id).to.eq(deps.{primary_dep_var}2.id);'
    elif primary_field_name:
        primary_meta = next((f for f in all_field_metas if f['prop_name'] == primary_field_name), None)
        if primary_meta:
            create_val = api_value(primary_meta, title)
            assert_create = f"expect(getRes.body.{primary_field_name}).to.eq({create_val});"
            if primary_meta.get('category') == 'entity_select':
                _opts = primary_meta.get('entity_options') or []
                _upd = f"'{_opts[1]['value']}'" if len(_opts) > 1 else create_val
                assert_update = f"expect(getRes.body.{primary_field_name}).to.eq({_upd});"
            elif primary_meta.get('category') == 'enum':
                _evals = [v for v in (primary_meta.get('enum_values') or []) if v is not None]
                _idx = 1 if len(_evals) > 1 else 0
                assert_update = f"expect(getRes.body.{primary_field_name}).to.eq({_idx});"
            elif primary_meta.get('category') == 'string_enum':
                _evals = [v for v in (primary_meta.get('enum_values') or []) if v is not None]
                _upd = f"'{_evals[1]}'" if len(_evals) > 1 else (f"'{_evals[0]}'" if _evals else "''")
                assert_update = f"expect(getRes.body.{primary_field_name}).to.eq({_upd});"
            else:
                update_label = primary_meta.get('label', to_title_case(primary_field_name))
                assert_update = f"expect(getRes.body.{primary_field_name}).to.eq('Updated {update_label}');"
        else:
            assert_create = 'expect(getRes.body.id).to.exist;'
            assert_update = 'expect(getRes.body.id).to.eq(records[0].id);'
    elif has_name_field:
        name_meta_api = next((f for f in all_field_metas if f['prop_name'] == 'name'), None)
        if name_meta_api and name_meta_api.get('category') == 'entity_select':
            _opts = name_meta_api.get('entity_options') or []
            _create_val = api_value(name_meta_api, title)
            _update_val = f"'{_opts[1]['value']}'" if len(_opts) > 1 else _create_val
            assert_create = f"expect(getRes.body.name).to.eq({_create_val});"
            assert_update = f"expect(getRes.body.name).to.eq({_update_val});"
        else:
            assert_create = f"expect(getRes.body.name).to.eq('Test {title}');"
            assert_update = f"expect(getRes.body.name).to.eq('Updated {title}');"
    else:
        assert_create = 'expect(getRes.body.id).to.exist;'
        assert_update = 'expect(getRes.body.id).to.eq(records[0].id);'

    # For the name-fallback case, _put_body_impl also needs to change 'name'
    has_name_fallback = has_name_field and not primary_field_name and not primary_is_fk

    # 5.1: choose which required non-autocomplete field to omit
    non_ac_required = [f for f in all_field_metas if f['required'] and f['category'] != 'autocomplete']
    required_autocomplete = [f for f in all_field_metas if f['required'] and f['category'] == 'autocomplete']
    field_to_skip_5_1 = None
    if non_ac_required:
        field_to_skip_5_1 = next(
            (f['prop_name'] for f in non_ac_required if f['prop_name'] == 'name'),
            non_ac_required[0]['prop_name'],
        )
    elif required_autocomplete:
        primary_required_fk = next(
            (f for f in required_autocomplete if primary_is_fk and f['prop_name'] == f'{primary_field_name}_id'),
            required_autocomplete[0],
        )
        field_to_skip_5_1 = primary_required_fk['prop_name']
    elif ua_fk_fields_for_api:
        field_to_skip_5_1 = ua_fk_fields_for_api[0]['prop_name']

    def _post_body_impl(skip_field: str | None, indent: str) -> list[str]:
        out = []
        for field in all_field_metas:
            if not field['required']:
                continue
            if field['prop_name'] == skip_field:
                continue
            if field['category'] == 'autocomplete':
                dep = next((d for d in entity_fk_deps if d['prop_name'] == field['prop_name']), None)
                if dep:
                    out.append(f"{indent}{field['prop_name']}: deps.{dep['dep_var_name']}.id,")
            else:
                out.append(f"{indent}{field['prop_name']}: {api_value(field, title)},")
        # When the primary display FK is optional, the loop above skips it, but
        # assert_create references getRes.body.<field>.id — include it so the
        # assertion can resolve. Skipped only if it's the explicit skip_field.
        if primary_is_fk and not primary_fk_is_ua:
            _pfk_prop = f'{primary_field_name}_id'
            _already_in = any(ln.strip().startswith(f'{_pfk_prop}:') for ln in out)
            if not _already_in and skip_field != _pfk_prop:
                _pfk_dep = next((d for d in entity_fk_deps if d['prop_name'] == _pfk_prop), None)
                if _pfk_dep:
                    out.append(f"{indent}{_pfk_prop}: deps.{primary_dep_var}.id,")
        for ua in ua_fk_fields_for_api:
            if ua['prop_name'] != skip_field:
                out.append(f"{indent}{ua['prop_name']}: deps.{ua['var_name']}.id,")
        if _api_bridge_first_parent and _bridge_first_parent_var:
            out.append(f"{indent}selectedParentType: '{_api_bridge_first_parent}',")
            out.append(f"{indent}selectedParentId: deps.{_bridge_first_parent_var}.id,")
        for c in api_child_metas:
            out.append(f"{indent}{c['child']['property_name']}: [],")
        return out

    def _put_body_impl(indent: str) -> list[str]:
        out = []
        for prop in put_body_props:
            if primary_is_fk and not primary_fk_is_ua and prop == f'{primary_field_name}_id':
                out.append(f"{indent}{prop}: deps.{primary_dep_var}2.id,")
            elif primary_fk_is_ua and ua_update_field and prop == ua_update_field['prop_name']:
                out.append(f"{indent}{prop}: {ua_update_expr},")
            elif not primary_is_fk and primary_field_name and prop == primary_field_name:
                primary_meta = next((f for f in all_field_metas if f['prop_name'] == prop), None)
                if primary_meta and primary_meta.get('category') == 'entity_select':
                    _opts = primary_meta.get('entity_options') or []
                    _v = f"'{_opts[1]['value']}'" if len(_opts) > 1 else api_value(primary_meta, title)
                    out.append(f"{indent}{prop}: {_v},")
                elif primary_meta and primary_meta.get('category') == 'enum':
                    # Integer enum: use second index (1) as the update integer value
                    _evals = [v for v in (primary_meta.get('enum_values') or []) if v is not None]
                    _idx = 1 if len(_evals) > 1 else 0
                    out.append(f"{indent}{prop}: {_idx},")
                elif primary_meta and primary_meta.get('category') == 'string_enum':
                    _evals = [v for v in (primary_meta.get('enum_values') or []) if v is not None]
                    _v = f"'{_evals[1]}'" if len(_evals) > 1 else (f"'{_evals[0]}'" if _evals else "''")
                    out.append(f"{indent}{prop}: {_v},")
                else:
                    update_label = primary_meta.get('label', to_title_case(prop)) if primary_meta else to_title_case(prop)
                    out.append(f"{indent}{prop}: 'Updated {update_label}',")
            elif has_name_fallback and prop == 'name':
                nm = next((f for f in all_field_metas if f['prop_name'] == 'name'), None)
                if nm and nm.get('category') == 'entity_select':
                    _opts = nm.get('entity_options') or []
                    _v = f"'{_opts[1]['value']}'" if len(_opts) > 1 else api_value(nm, title)
                    out.append(f"{indent}name: {_v},")
                else:
                    out.append(f"{indent}name: 'Updated {title}',")
            else:
                out.append(f"{indent}{prop}: records[0].{prop},")
        for c in api_child_metas:
            out.append(f"{indent}{c['child']['property_name']}: [],")
        return out

    def _put_body_ro_zero_impl(indent: str) -> list[str]:
        """PUT body for readonly preservation test: excludes readonly fields entirely,
        uses original.{prop} for all others (simulating correct form behavior where
        readOnly fields are not submitted).  Verifies readonly fields are not accidentally
        cleared or overwritten by a legitimate PUT update."""
        out = []
        readonly_set = set(readonly_fields)
        for prop in put_body_props:
            if prop not in readonly_set:
                out.append(f"{indent}{prop}: original.{prop},")
        for c in api_child_metas:
            out.append(f"{indent}{c['child']['property_name']}: [],")
        return out

    has_approvable = any(d['target'] == 'approvable' for d in get_internal_one_to_one_fks(model, schema))
    _x_approval = model_def.get('x-approval')
    entity_on_rejected = _x_approval.get('on_rejected') if _x_approval else None
    entity_on_rejected_terminal = bool((_x_approval or {}).get('on_rejected', {}).get('terminal', False))

    # Detect count-mode reservation without lines: POST tests must seed the pool entity first.
    _xres_def = model_def.get('x-reservation')
    _reservation_count_pool_pascal = None
    if (_xres_def and isinstance(_xres_def, dict)
            and _xres_def.get('mode') == 'count'
            and not _xres_def.get('lines')):
        _pool_entity = (_xres_def.get('pool') or {}).get('entity')
        if _pool_entity:
            _reservation_count_pool_pascal = to_pascal_case(_pool_entity)

    # Count items pre-created by db:seed + db:grantAllPermissions so that
    # generated tests can adjust expected row counts accordingly.
    # - role:       grantAllPermissions creates 1 Administrator role
    # - permission: grantAllPermissions creates 1 permission per test entity (ALL_ENTITIES)
    # - user:       seedTestDatabase creates 1 test user
    if parent == 'role':
        seed_count = 1
    elif parent == 'permission':
        seed_count = test_entity_count if test_entity_count is not None else 0
    elif parent == 'user':
        seed_count = 1
    else:
        seed_count = 0

    return {
        'parent': parent,
        'pascal': parent_pascal,
        'title': title,
        'model': model,
        'api_path': api_path,
        'has_deps': has_deps,
        'primary_is_fk': primary_is_fk,
        'primary_fk_is_ua': primary_fk_is_ua,
        'can_list': gen_cfg.get('list', True) is not False,
        'can_view': gen_cfg.get('view', True) is not False,
        'can_new': gen_cfg.get('new', True) is not False,
        'can_edit': gen_cfg.get('edit', True) is not False,
        'can_delete': gen_cfg.get('delete', True) is not False,
        'can_export': gen_cfg.get('export', True) is not False,   # cmd_330
        'seed_count': seed_count,
        'I': I,
        'I7': I,  # same indentation level as I for section 7
        'assert_create': assert_create,
        'assert_update': assert_update,
        'post_body_create': _post_body_impl(None, f'{I}    '),
        'post_body_missing_field': _post_body_impl(field_to_skip_5_1, f'{I}    '),
        'put_body_update': _put_body_impl('            '),
        'put_body_update_fk': _put_body_impl('              '),
        'i7_post_body': _post_body_impl(None, f'{I}      '),
        # Bulk test bodies — two extra spaces of indent (inside array item `{`)
        'bulk_post_body_valid':   _post_body_impl(None,               f'{I}      '),
        'bulk_post_body_invalid': _post_body_impl(field_to_skip_5_1, f'{I}      '),
        # Bulk PUT: non-FK inside one `.then((records)=>`, FK inside two `.then` blocks
        'bulk_put_body_valid':    _put_body_impl('              '),   # 14 spaces
        'bulk_put_body_valid_fk': _put_body_impl('                '), # 16 spaces
        'has_approvable': has_approvable,
        'entity_on_rejected': entity_on_rejected,
        'entity_on_rejected_terminal': entity_on_rejected_terminal,
        'reservation_count_pool_pascal': _reservation_count_pool_pascal,
        # CSV Export (Phase 1) test context
        'should_filter_by_org': should_filter_by_org,
        'has_import_key': has_import_key,
        'import_key_fields': import_key_fields,
        # CSV Import round-trip (cmd_421 N11-N13)
        'import_eligible': import_eligible,
        'import_can_update': import_can_update,
        # CSV Export (cmd_324 V1) test context
        'export_scalar_fields': export_scalar_fields,
        'export_import_key_fields': export_import_key_fields,
        'x_relationships_list': x_relationships_list,
        'readonly_fields': readonly_fields,
        'put_body_readonly_zero': _put_body_ro_zero_impl('            '),
        # CSV Export (cmd_421 N9): internal bridge FK exclusion
        'has_exportable_bridge_fks': has_exportable_bridge_fks,
        'exportable_bridge_fk_names': exportable_bridge_fk_names,
        # Search coverage (cmd_421 Domain 5)
        'is_searchable': is_searchable,
        'search_sample_field': search_sample_field,
        'search_sample_field_required': search_sample_field_required,
        # Mention field name resolution (cmd_421 Domain 4, M1)
        'has_mention_comments': has_mention_comments,
        'commentable_rel_name': commentable_rel_name,
        'mention_field_name': mention_field_name,
    }


# ---------------------------------------------------------------------------
# db-helpers.ts context
# ---------------------------------------------------------------------------

def db_helpers_context(schema: dict, test_entity_names: list[str] | None = None) -> dict:
    """Build context for cypress/support/db-helpers.ts.

    Determines the correct deletion order for all Prisma models by:
    1. Extracting base entities (type: object with id, not *_detail/*_input).
    2. Building an FK dependency graph from x-relationship fields.
    3. Adding an implicit dependency on user_account for every other entity
       (all models reference it via creator_id/updater_id even when not in schema).
    4. Grouping into deletion waves so that all dependents of an entity are
       deleted before the entity itself.

    test_entity_names: sorted list of entity names for which test specs are generated.
    These seed ALL_ENTITIES in the template — the permission grant set must at least
    cover the test-spec entity set so non-base entities (e.g. settingX variants of
    xxxxx_xxxxx) are always included. It is additionally widened (below) to include
    any entity that is only ever reached as an x-relationship labelField hop (e.g.
    `location` via `inventory`'s `location.name` label) — such entities have no test
    spec of their own (x-generate.test: false) but still require read permission at
    runtime for autocomplete label lookups.
    """
    defs = schema['definitions']

    # Entities used as x-bridge.name targets are internal junction tables whose
    # Prisma model is declared in a separate file (bridge_additions.prisma) that
    # is NOT loaded by prisma.config.ts. Excluding them prevents
    # prisma.<bridge>.deleteMany() calls that would fail at runtime.
    xbridge_table_names: set[str] = set()
    for defn in defs.values():
        bridge_name = (defn.get('x-bridge') or {}).get('name')
        if bridge_name:
            xbridge_table_names.add(bridge_name)

    # --- Collect base entities ---
    base_entities: dict[str, dict] = {}
    for key, defn in defs.items():
        if key.endswith('_detail') or key.endswith('_input'):
            continue
        if key in xbridge_table_names:
            continue
        if defn.get('type') == 'object' and 'id' in defn.get('properties', {}):
            base_entities[key] = defn

    # --- Build FK dependency graph (entity -> set of entities it references) ---
    deps: dict[str, set[str]] = {}
    for name, defn in base_entities.items():
        fk_targets: set[str] = set()
        for prop_name, prop in defn.get('properties', {}).items():
            rel = prop.get('x-relationship', {})
            if rel.get('type') in ('many-to-one', 'one-to-one', 'one-to-one_bridge'):
                # Explicit x-relationship annotation — bridge OTO is included so the
                # bridge row's deletion ordering is correct relative to its parent.
                target = rel.get('target')
                if target and target in base_entities and target != name:
                    fk_targets.add(target)
            elif prop_name.endswith('_id') and prop_name not in ('id', 'creator_id', 'updater_id') and not rel:
                # Infer FK from _id suffix when no x-relationship is present
                # e.g. bug_id in bug_comment → bug
                inferred = prop_name[:-3]
                if inferred in base_entities and inferred != name:
                    fk_targets.add(inferred)
        # All entities implicitly reference user_account via creator_id/updater_id
        if name != 'user' and 'user' in base_entities:
            fk_targets.add('user')
        deps[name] = fk_targets

    # --- Add synthetic FK deps from new-form x-bridge (FK-on-parent pattern) ---
    # Each parent entity of a new-form bridge carries {bridge_name}_id (FK to bridge),
    # but this FK is synthetic (not in json_schema.yaml properties). Add it to deps
    # so the deletion order is correct: parents must be deleted before the bridge model.
    for name, defn in base_entities.items():
        bridge = defn.get('x-bridge')
        if not isinstance(bridge, dict) or not bridge.get('name'):
            continue
        bridge_name = bridge['name']
        if bridge_name not in base_entities:
            continue
        for parent_entry in (bridge.get('parents') or []):
            parent_target = parent_entry.get('target') if isinstance(parent_entry, dict) else None
            if parent_target and parent_target in base_entities and parent_target != name:
                deps[parent_target].add(bridge_name)

    # --- Compute reverse deps: entity -> set of entities that depend on it ---
    reverse_deps: dict[str, set[str]] = {name: set() for name in base_entities}
    for name, dep_set in deps.items():
        for dep in dep_set:
            if dep in reverse_deps:
                reverse_deps[dep].add(name)

    # --- Group into deletion waves (BFS from leaves) ---
    assigned: set[str] = set()
    remaining: set[str] = set(base_entities.keys())
    levels: list[list[str]] = []

    while remaining:
        wave = sorted(
            name for name in remaining
            if all(d in assigned for d in reverse_deps[name])
        )
        if not wave:
            # Cycle detected — add remaining in sorted order to avoid infinite loop
            wave = sorted(remaining)
        levels.append(wave)
        for name in wave:
            assigned.add(name)
            remaining.remove(name)

    # System tables: not in json_schema.yaml definitions, but have FK constraints
    # that block user.deleteMany(). audit_log uses onDelete: Restrict — must be
    # deleted before user rows. mfa_recovery_code is Cascade but explicit ordering
    # avoids any partial-delete race during test reset.
    system_first = [t for t in ['audit_log', 'mfa_recovery_code'] if t not in base_entities]
    if system_first:
        levels.insert(0, system_first)

    # --- Widen the permission-grant entity set with labelField hop targets ---
    # An entity with x-generate.test: false has no test spec of its own but may
    # still be reached as an intermediate hop while rendering another entity's
    # autocomplete label (e.g. inventory_movement -> inventory -> location via
    # `location.name`). Those hops need read permission at runtime even though
    # they're never the primary subject of a generated spec.
    def _has_api(entity: str) -> bool:
        gen_defn = defs.get(f'{entity}_detail', defs.get(entity, {}))
        return bool(gen_defn.get('x-generate', {}).get('api'))

    labelfield_entities: set[str] = set()
    for name, defn in base_entities.items():
        for prop in defn.get('properties', {}).values():
            rel = prop.get('x-relationship', {})
            rel_target = rel.get('target')
            # one-to-one_bridge FKs (e.g. approvable_id) are always rendered as a
            # plain column, never a client-side autocomplete (build_context.py
            # excludes them from writable form fields) — no separate API read
            # call is ever made for their labelField, so they're excluded here.
            if rel.get('type') not in ('many-to-one', 'one-to-one'):
                continue
            if rel_target and rel_target in base_entities and rel.get('labelField'):
                labelfield_entities |= relation_chain_targets(rel['labelField'], rel_target, schema)
    # Only entities with a live generated API route are ever subject to a
    # requirePermission() check — entities with x-generate.api: false (e.g.
    # approvable, commentable) or no x-generate at all (internal-only, e.g.
    # comment) have no route to call and so need no permission grant.
    labelfield_entities = {e for e in labelfield_entities if e in base_entities and _has_api(e)}

    all_permission_entities = set(test_entity_names or []) | labelfield_entities

    return {
        'deletion_levels': levels,
        'test_entity_names': sorted(all_permission_entities),
    }


# ---------------------------------------------------------------------------
# x-reservation context builders (Phase 1: count mode)
# ---------------------------------------------------------------------------

def _reservation_base(entity: str, schema: dict, children: list) -> dict | None:
    """Extract base reservation context from x-reservation config. Returns None if not count mode."""
    defs = schema.get('definitions', {})
    entity_def = defs.get(entity, {})
    x_res = entity_def.get('x-reservation', {})
    if not x_res or x_res.get('mode') != 'count' or not x_res.get('lines'):
        return None

    pool_cfg    = x_res.get('pool', {})
    request_cfg = x_res.get('request', {})
    result_cfg  = x_res.get('result', {})
    policy_cfg  = x_res.get('policy', {})

    # OD-1: strategy: ledger_transaction entities resolve pool.entity via
    # transaction.ledgerDomain (x-ledger-entities) instead of declaring it
    # directly on x-reservation.pool.
    pool_entity = pool_cfg.get('entity', '')
    if not pool_entity:
        _domain_key = (x_res.get('transaction') or {}).get('ledgerDomain')
        if _domain_key:
            pool_entity = resolve_ledger_domain(schema, _domain_key)['pool']
    pool_def    = defs.get(pool_entity, {})
    pool_props  = pool_def.get('properties', {})

    # criteria (first entry only for Phase 1)
    criteria = request_cfg.get('criteria', {})
    criteria_pool_field = next(iter(criteria.keys()), 'id')
    criteria_item_field = next(iter(criteria.values()), 'id')

    # FK target for the pool criteria field (e.g. product_id → product)
    pool_criteria_prop = pool_props.get(criteria_pool_field, {})
    pool_fk_entity = (pool_criteria_prop.get('x-relationship') or {}).get('target', '')

    # orderBy fields
    orderby_raw = policy_cfg.get('orderBy', [])
    orderby_fields = []
    for ob in orderby_raw:
        for field, direction in ob.items():
            prop      = pool_props.get(field, {})
            prop_type = prop.get('type', '')
            is_nullable = isinstance(prop_type, list) and 'null' in prop_type
            is_date     = prop.get('format') == 'date'
            null_last   = 'nulls_last' in direction
            # Prisma orderBy direction (strip nulls_last/nulls_first suffix)
            prisma_direction = 'asc' if direction.startswith('asc') else 'desc'
            orderby_fields.append({
                'field': field,
                'direction': direction,
                'is_date': is_date,
                'is_nullable': is_nullable,
                'null_last': null_last,
                'prisma_direction': prisma_direction,
            })

    # Sortable fields (for seed helper parameters): exclude 'id' (auto-assigned)
    orderby_sortable = [f for f in orderby_fields if f['field'] != 'id']

    # Compute seed values for sortable fields across test scenarios
    def _seed_val(f: dict, scenario: str) -> str:
        if f['field'] == 'lot_number':
            vals = {'multi_row1': "'LOT-A'", 'multi_row2': "'LOT-B'",
                    'orderby_row1': "'LOT-A'", 'orderby_row2': "'LOT-B'", 'orderby_row3': "'LOT-C'"}
            return vals.get(scenario, 'null' if f['is_nullable'] else "''")
        if f['is_date']:
            if 'null' in scenario:
                return 'null'
            date_vals = {'multi_row1': "'2027-01-01'", 'multi_row2': "'2027-06-01'",
                         'orderby_row1': "'2027-01-01'", 'orderby_row2': "'2027-06-01'",
                         'orderby_row3': 'null' if f['is_nullable'] else "'2027-12-01'"}
            return date_vals.get(scenario, 'null' if f['is_nullable'] else "'2027-01-01'")
        if f['is_nullable']:
            return 'null'
        return "''"

    for f in orderby_sortable:
        f['seed_multi_row1']    = _seed_val(f, 'multi_row1')
        f['seed_multi_row2']    = _seed_val(f, 'multi_row2')
        f['seed_orderby_row1']  = _seed_val(f, 'orderby_row1')
        f['seed_orderby_row2']  = _seed_val(f, 'orderby_row2')
        f['seed_orderby_row3']  = _seed_val(f, 'orderby_row3')

    # Parent entity fields
    entity_props     = entity_def.get('properties', {})
    parent_req_fields = [f for f in (entity_def.get('required') or []) if f not in ('id',)]
    parent_fk_field  = None
    parent_fk_entity = None
    parent_str_field = None
    for field in parent_req_fields:
        prop = entity_props.get(field, {})
        rel  = prop.get('x-relationship', {})
        if rel and not parent_fk_field:
            parent_fk_field  = field
            parent_fk_entity = rel.get('target', 'user')
        elif not rel and not parent_str_field:
            parent_str_field = field

    # lines entity from children list
    lines_prop   = x_res.get('lines', '')
    lines_entity = next((c['name'] for c in children if c.get('property_name') == lines_prop), None)

    # orderBy description for spec comment
    orderby_desc = ' → '.join(
        f"{f['field']} {f['direction']}" for f in orderby_fields
    )

    return {
        'entity':             entity,
        'pascal':             to_pascal_case(entity),
        'api_path':           f'/api/{entity}',
        'pool_entity':        pool_entity,
        'pool_fk_entity':     pool_fk_entity,
        'pool_fk_pascal':     to_pascal_case(pool_fk_entity),
        # All one-to-one_bridge FKs on the pool FK entity (e.g. product) — explicit
        # (attachable) AND injected bridge-parent FKs (noteable). The helper must
        # create each bridge row and set its <bridge>_id, or the create rejects.
        'pool_fk_bridge_otos': get_all_internal_fk_deps(pool_fk_entity, schema) if pool_fk_entity else [],
        'pool_qty_field':     pool_cfg.get('quantityField', 'quantity'),
        'pool_res_field':     pool_cfg.get('reservedField', 'reserved_quantity'),
        'alloc_entity':       result_cfg.get('allocationEntity', ''),
        'parent_field':       result_cfg.get('parentField', ''),
        'line_field':         result_cfg.get('lineField', ''),
        'pool_field':         result_cfg.get('poolField', ''),
        'alloc_qty_field':    result_cfg.get('quantityField', 'quantity'),
        'lines_entity':       lines_entity,
        'lines_prop':         lines_prop,
        'req_qty_field':      request_cfg.get('quantityField', 'quantity'),
        'criteria_pool_field': criteria_pool_field,
        'criteria_item_field': criteria_item_field,
        'pool_fk_entity':     pool_fk_entity,
        'parent_fk_field':    parent_fk_field,
        'parent_fk_entity':   parent_fk_entity or 'user',
        'parent_str_field':   parent_str_field,
        'orderby_fields':     orderby_fields,
        'orderby_sortable':   orderby_sortable,
        'orderby_desc':       orderby_desc,
        'has_actions':        bool(x_res.get('actions')),
        'reservation_actions': [
            {'name': name, 'type': defn.get('type', name)}
            for name, defn in (x_res.get('actions') or {}).items()
            if isinstance(defn, dict)
        ],
        'alloc_status_field': list((x_res.get('actions') or {}).values())[0].get('statusField', 'status')
            if x_res.get('actions') else 'status',
        'alloc_remaining_field': list((x_res.get('actions') or {}).values())[0].get('remainingField', 'remaining_quantity')
            if x_res.get('actions') else 'remaining_quantity',
    }


def reservation_helper_context(entity: str, schema: dict, children: list) -> dict:
    """Build Jinja2 context for test_reservation_helper.ts.jinja2."""
    ctx = _reservation_base(entity, schema, children)
    return ctx or {}


def reservation_spec_context(entity: str, schema: dict, children: list) -> dict:
    """Build Jinja2 context for test_reservation_spec.cy.ts.jinja2."""
    ctx = _reservation_base(entity, schema, children)
    return ctx or {}
