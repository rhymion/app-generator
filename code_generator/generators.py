"""
generators.py — Per-generator context extension functions.

Each function takes the base context dict (from build_context) and returns
an extended dict with the generator-specific computed strings that templates
need.  This keeps complex Python logic out of Jinja2.
"""

from helpers.naming import (
    to_camel_case, to_pascal_case, to_pascal_case_from_var, to_title_case,
    safe_var_name, singularize,
)
from helpers.type_mapping import get_ts_type
from helpers.schema_helpers import (
    get_parent_relationships,
    get_parent_fk_props,
    find_fk_derivation_path,
    get_detail_properties,
    get_approval_lines_props,
    resolve_ledger_domain,
    get_entity_properties,
)


def _raw_def(entity_name: str, schema: dict) -> dict:
    """Resolve a bare/view model name to its raw entity dict — scalar/FK
    properties, x-readonly-fields, x-gdpr-mode, x-display etc. all live on
    the raw ('__'-prefixed) entity, not the view. Falls back to the bare
    view for entities with no raw counterpart (e.g. 'setting', which
    proxies the 'user' view instead of having its own raw twin)."""
    defs = schema.get('definitions', {})
    return defs.get(f'__{entity_name}', {}) or defs.get(entity_name, {})
from helpers.label_field import (
    build_label_expression,
    first_label_format,
    first_label_path,
    render_prisma_include,
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _get_actual_type(defn: dict) -> str | None:
    t = defn.get('type')
    return next((x for x in t if x != 'null'), None) if isinstance(t, list) else t


def _is_nullable(defn: dict) -> bool:
    t = defn.get('type')
    return isinstance(t, list) and 'null' in t


def _enum_value_literal(defn: dict, label) -> str:
    """Return the TS literal for an enum `label` of property `defn`.

    Integer/number enums persist the ordinal index, so a string label like
    'reserved' is emitted as its position in the enum list (e.g. 0). Numeric
    labels pass through unchanged. String enums (or non-enum fields) keep the
    quoted string. This mirrors the value Prisma stores so generated code
    typechecks against the client.
    """
    if isinstance(label, bool):
        return 'true' if label else 'false'
    actual = _get_actual_type(defn or {})
    enum_vals = (defn or {}).get('enum')
    if actual in ('integer', 'number') and isinstance(enum_vals, list):
        if isinstance(label, (int, float)):
            return str(int(label))
        s = str(label)
        if s.lstrip('-').isdigit():
            return s
        if s in enum_vals:
            return str(enum_vals.index(s))
        return '0'  # unknown label for an int enum — keep numeric so it compiles
    if isinstance(label, (int, float)):
        return str(int(label))
    return f"'{label}'"


def _status_prop_defn(schema: dict | None, entity: str, field: str) -> dict:
    """Look up the property definition for <entity>.<field> (empty dict if absent)."""
    if not schema:
        return {}
    return (_raw_def(entity, schema).get('properties', {}) or {}).get(field) or {}


def _has_string_labels(enum_values) -> bool:
    return any(isinstance(v, str) and not str(v).lstrip('-').isdigit() for v in (enum_values or []))


def _native_enum_ns(prop: dict) -> str | None:
    """i18n namespace for a nativeEnum (`_prisma_native_enum_type`) field:
    x-enum-namespace if set, else the Prisma enum block name itself."""
    native_type = prop.get('_prisma_native_enum_type')
    if not native_type:
        return None
    return prop.get('x-enum-namespace') or native_type


def _native_enum_key(v) -> str:
    """camelCase message key for a nativeEnum value. Prisma enum members are
    PascalCase (e.g. 'TerminalRejected'), so this lowercases only the first
    character, mirroring the existing x-enum-namespace int-enum convention."""
    s = str(v)
    return s[0].lower() + s[1:] if s else s


def _int_enum_option(v, i: int) -> str:
    if isinstance(v, (int, float)):
        return f"{{ value: {int(v)}, label: '{v}' }}"
    try:
        float(str(v))
        return f"{{ value: {v}, label: '{v}' }}"
    except ValueError:
        return f"{{ value: {i}, label: '{v}' }}"


# ---------------------------------------------------------------------------
# chart getters / page_chart
# ---------------------------------------------------------------------------

def build_dashboard_catalog(schema: dict) -> list[dict]:
    """Catalog of dashboardable entities + their groupable fields.

    An entity is dashboardable when its base definition declares
    `x-display.dashboard: true`. A field is groupable when it is one of:
      - a many-to-one FK (each FK value becomes a series, labelled via
        the relationship's labelField on the target);
      - an integer or string with an `enum` (each enum label is a category —
        covers both legacy int-enum and Prisma nativeEnum string fields);
      - a boolean (Yes / No);
      - an integer or number without enum (numeric filter range);
      - a string with format 'date' or 'date-time' (datetime range filter).

    Entities with no groupable field are dropped — there is nothing
    meaningful to chart, and exposing them would surface an empty picker.
    """
    from helpers.naming import to_title_case
    catalog = []
    for entity_name, defn in schema['definitions'].items():
        if not entity_name.startswith('__') or entity_name.endswith('_input'):
            continue
        entity_name = entity_name[2:]
        xdisplay = defn.get('x-display') or {}
        if not (isinstance(xdisplay, dict) and xdisplay.get('dashboard')):
            continue
        groupable = []
        for prop_name, prop in (defn.get('properties') or {}).items():
            if prop_name in ('id', 'created_at', 'updated_at'):
                continue
            rel = prop.get('x-relationship') or {}
            if rel.get('type') == 'many-to-one' and rel.get('target'):
                stem = prop_name[:-3] if prop_name.endswith('_id') else prop_name
                label_field = rel.get('labelField', 'name')
                # v1 supports string labelField only; fall back to 'name' for list labels
                if not isinstance(label_field, str):
                    label_field = 'name'
                groupable.append({
                    'name': prop_name,
                    'label': to_title_case(stem),
                    'kind': 'fk',
                    'fk_target': rel['target'],
                    'fk_label_field': label_field,
                })
                continue
            actual = _get_actual_type(prop)
            if actual == 'boolean':
                groupable.append({
                    'name': prop_name,
                    'label': to_title_case(prop_name),
                    'kind': 'boolean',
                })
            elif actual in ('integer', 'string') and isinstance(prop.get('enum'), list):
                groupable.append({
                    'name': prop_name,
                    'label': to_title_case(prop_name),
                    'kind': 'enum',
                    'enum_values': [str(v) for v in prop['enum']],
                })
            elif actual in ('integer', 'number') and not isinstance(prop.get('enum'), list):
                groupable.append({
                    'name': prop_name,
                    'label': to_title_case(prop_name),
                    'kind': 'number',
                })
            elif actual == 'string' and prop.get('format') in ('date', 'date-time'):
                groupable.append({
                    'name': prop_name,
                    'label': to_title_case(prop_name),
                    'kind': 'datetime',
                    'datetime_format': prop['format'],
                })
        # creator_id/updater_id are Prisma-only audit fields (not in json_schema.yaml),
        # so they must be appended explicitly for all dashboardable entities.
        groupable.extend([
            {'name': 'creator_id', 'label': 'Creator', 'kind': 'fk', 'fk_target': 'user', 'fk_label_field': 'name'},
            {'name': 'updater_id', 'label': 'Updater', 'kind': 'fk', 'fk_target': 'user', 'fk_label_field': 'name'},
        ])
        if not groupable:
            continue
        catalog.append({
            'name': entity_name,
            'label': to_title_case(entity_name),
            'groupable_fields': groupable,
        })
    return catalog


def build_attachable_owners(schema: dict) -> list[dict]:
    """Entities that own the polymorphic `attachable` bridge.

    The attachable bridge is shared storage — any base entity that declares
    an `attachable_id` field with `x-relationship.target: attachable`
    becomes an owner. The generator templates lib/attachment/actions.ts
    (creator check + revalidate paths) need this list at runtime so each
    owner contributes a branch to the `select` clause and a path-revalidate
    call.

    Returns owner descriptors keyed on the Prisma model name (the back
    reference on `attachable`, e.g. `attachable.resource`), plus
    `has_assignee` (whether the owner declares an `assignee_id` property) so
    the template can select it for item-level permission resolution. Entries
    are sorted by name for deterministic generator output.
    """
    owners = []
    seen = set()
    for entity_name, defn in (schema.get('definitions') or {}).items():
        # View / input variants aren't owners — only the raw entity holds
        # the FK field. Walking the raw entities is enough.
        if not entity_name.startswith('__') or entity_name.endswith('_input'):
            continue
        entity_name = entity_name[2:]
        if entity_name in seen:
            continue
        properties = defn.get('properties') or {}
        for prop_name, prop in properties.items():
            if prop_name != 'attachable_id':
                continue
            rel = prop.get('x-relationship') or {}
            if rel.get('type') != 'one-to-one_bridge':
                continue
            if rel.get('target') != 'attachable':
                continue
            owners.append({'name': entity_name, 'has_assignee': 'assignee_id' in properties})
            seen.add(entity_name)
            break
    owners.sort(key=lambda o: o['name'])
    return owners


def attachment_type_ts(schema: dict) -> str:
    """TS type for the `type` param of lib/attachment/actions.ts's
    setAttachmentsForBridge(). Mirrors attachment.type's actual field type
    (plain `number` by default, or the nativeEnum literal union once
    attachment.type has been migrated to a Prisma enum) so the hand-off
    from the generic bridge action to `prisma.attachment.create/findMany`
    type-checks without a cast.
    """
    prop = ((schema.get('definitions') or {}).get('attachment') or {}).get('properties', {}).get('type')
    if not prop:
        return 'number'
    return get_ts_type(prop)


def reaction_type_ts(schema: dict) -> str:
    """TS type for the `type` param threaded through the comment-reactions
    feature (toggle server action, toggle API route, CommentReactionSummary /
    reactionCounts / myReactionTypes). Mirrors reaction.type's actual field
    type (plain `number` by default, or the nativeEnum literal union once
    reaction.type has been migrated to a Prisma enum) so hand-offs to
    prisma.reaction.create/findUnique/groupBy type-check without a cast.
    """
    prop = ((schema.get('definitions') or {}).get('reaction') or {}).get('properties', {}).get('type')
    if not prop:
        return 'number'
    return get_ts_type(prop)


def chart_context(ctx: dict, schema: dict) -> dict:
    chart_cfg = ctx.get('chart_cfg')
    if not chart_cfg:
        return {}

    model      = ctx['model']
    model_def  = ctx['model_def']
    row_by     = chart_cfg['row_by']
    start_field = chart_cfg.get('start_field', 'start_time')
    end_field   = chart_cfg.get('end_field', 'end_time')
    span        = chart_cfg.get('span', 'week')

    props = model_def.get('properties', {})
    fk_field    = f'{row_by}_id'
    label_field = 'name'
    for prop_name, prop in props.items():
        rel = prop.get('x-relationship', {})
        if rel.get('target') == row_by:
            fk_field    = prop_name
            label_field = rel.get('labelField', 'name')
            break

    exclude = {fk_field, start_field, end_field, 'id', 'created_at', 'updated_at', 'creator_id'}
    required = set(model_def.get('required') or [])
    extra_fields   = []
    extra_selects  = []
    tooltip_prop   = ''

    for field_name, prop in props.items():
        if field_name in exclude or field_name not in required:
            continue
        actual = _get_actual_type(prop)
        enum_vals = prop.get('enum')
        if actual == 'string':
            extra_fields.append({'name': field_name, 'ts_type': 'string'})
            extra_selects.append(f'{field_name}: item.{field_name},')
            if not tooltip_prop:
                tooltip_prop = f'item.{field_name}'
        elif actual in ('integer', 'number') and isinstance(enum_vals, list) and _has_string_labels(enum_vals):
            extra_fields.append({'name': field_name, 'ts_type': 'number'})
            extra_selects.append(f'{field_name}: item.{field_name},')
            if not tooltip_prop:
                labels = ', '.join(f"'{v}'" for v in enum_vals)
                tooltip_prop = f"([{labels}] as const)[item.{field_name} as number] ?? String(item.{field_name})"

    # parseFnBody per span
    if span == 'week':
        parse_fn_body = (
            "  if (dateStr && /^\\d{4}-\\d{2}-\\d{2}$/.test(dateStr)) {\n"
            "    const d = new Date(dateStr);\n"
            "    if (!isNaN(d.getTime())) return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));\n"
            "  }\n"
            "  const now = new Date();\n"
            "  const dow = now.getUTCDay();\n"
            "  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));"
        )
        query_range_code = (
            "  const DAY_MS = 86400000;\n"
            "  const queryStart = new Date(periodStart.getTime() - DAY_MS);\n"
            "  const queryEnd   = new Date(periodStart.getTime() + 8 * DAY_MS);"
        )
    elif span == 'month':
        parse_fn_body = (
            "  if (dateStr && /^\\d{4}-\\d{2}-\\d{2}$/.test(dateStr)) {\n"
            "    const d = new Date(dateStr);\n"
            "    if (!isNaN(d.getTime())) return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));\n"
            "  }\n"
            "  const now = new Date();\n"
            "  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));"
        )
        query_range_code = (
            "  const queryStart = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), 0));\n"
            "  const queryEnd   = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 2));"
        )
    else:  # year
        parse_fn_body = (
            "  if (dateStr && /^\\d{4}-\\d{2}-\\d{2}$/.test(dateStr)) {\n"
            "    const d = new Date(dateStr);\n"
            "    if (!isNaN(d.getTime())) return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));\n"
            "  }\n"
            "  const now = new Date();\n"
            "  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));"
        )
        query_range_code = (
            "  const queryStart = new Date(Date.UTC(periodStart.getUTCFullYear() - 1, 11, 30));\n"
            "  const queryEnd   = new Date(Date.UTC(periodStart.getUTCFullYear() + 1, 0, 2));"
        )

    return {
        'row_by': row_by,
        'start_field': start_field,
        'end_field': end_field,
        'fk_field': fk_field,
        'label_field': label_field,
        'span': span,
        'extra_fields': extra_fields,
        'extra_selects': extra_selects,
        'tooltip_prop': tooltip_prop,
        'parse_fn_body': parse_fn_body,
        'query_range_code': query_range_code,
    }


# ---------------------------------------------------------------------------
# page_list
# ---------------------------------------------------------------------------

def page_list_context(ctx: dict, schema: dict | None = None) -> dict:
    parent     = ctx['parent']
    model_def  = ctx['model_def']
    gen_cfg    = ctx['gen_cfg']
    xdisplay_table = ctx.get('xdisplay_table')
    has_chart  = ctx['has_chart']
    parent_pascal = ctx['parent_pascal']
    parent_camel  = ctx['parent_camel']

    model_props = model_def.get('properties', {})
    formatting_entries = []
    formatting_keys: set[str] = set()
    enum_ns_list = []       # [{var_name, ns, keys}]
    display_fields_code = ''
    primary_field = ''

    # Build map from relation display name (e.g. 'epic') to {label_field, target}.
    # parent_rels_raw entries: { prop_name: 'epic_id', label_field: 'title' | [...], ... }
    rel_label_map: dict[str, dict[str, object]] = {}
    for r in list(ctx.get('parent_rels_raw', [])) + list(ctx.get('selector_oto_rels', [])):
        prop = r['prop_name']
        if prop.endswith('_id'):
            rel_label_map[prop[:-3]] = {
                'label_field':         r['label_field'],
                'target':              r.get('target', ''),
            }

    # Set when any list-page formatting expression invokes formatLabelValue —
    # the generated page_list.tsx must then import it from '@/lib/_format'.
    list_uses_format_label_value = False

    def add_formatting(field_name: str, expr: str) -> None:
        if field_name in formatting_keys:
            return
        formatting_keys.add(field_name)
        formatting_entries.append(f'    {field_name}: {expr},')

    def _label_expr_for_rel(field_name: str, rel_info: dict) -> str:
        """Build the formatting expression for a relation column (list page)."""
        nonlocal list_uses_format_label_value
        target = rel_info.get('target') or ''
        built = build_label_expression(
            f'item.{field_name}',
            rel_info['label_field'],
            target,
            schema or {},
        )
        if built['has_format']:
            list_uses_format_label_value = True
        # Guard: when item.{field_name} is null/undefined, deep accesses inside
        # the expression already short-circuit via ?., so we just need to
        # evaluate the expression. formatLabelValue handles nullish itself.
        return built['expression']

    if xdisplay_table:
        fields_code_parts = []
        for item in xdisplay_table:
            field_name = list(item.keys())[0]
            config     = item[field_name] or {}
            field_key  = to_camel_case(field_name)
            width      = config.get('width', 200)

            prop = model_props.get(field_name)
            if prop:
                actual   = _get_actual_type(prop)
                enum_vals = prop.get('enum')
                enum_ns  = prop.get('x-enum-namespace')
                native_ns = _native_enum_ns(prop)

                if native_ns and isinstance(enum_vals, list) and _has_string_labels(enum_vals):
                    var_name = f'{to_camel_case(field_name)}Labels'
                    entries = [(v, _native_enum_key(v)) for v in enum_vals]
                    if not any(e['var_name'] == var_name for e in enum_ns_list):
                        enum_ns_list.append({'var_name': var_name, 'ns': native_ns, 'entries': entries, 'is_native_enum': True})
                    add_formatting(field_name, f"{var_name}[item.{field_name} as string] ?? item.{field_name}")
                elif actual in ('integer', 'number') and isinstance(enum_vals, list) and _has_string_labels(enum_vals):
                    var_name = f'{to_camel_case(field_name)}Labels'
                    ns_to_use = enum_ns or 'Fields'
                    entries = [
                        (i, f"{field_name}_{v}" if isinstance(v, str) and not str(v).lstrip('-').isdigit() else str(v))
                        if not enum_ns
                        else (i, v.lower()[0] + v[1:] if isinstance(v, str) and not str(v).lstrip('-').isdigit() else str(v))
                        for i, v in enumerate(enum_vals)
                    ]
                    # avoid duplicates
                    if not any(e['var_name'] == var_name for e in enum_ns_list):
                        enum_ns_list.append({'var_name': var_name, 'ns': ns_to_use, 'entries': entries, 'is_native_enum': False})
                    add_formatting(field_name, f"{var_name}[item.{field_name} as number] ?? ''")

            if config.get('primary'):
                primary_field = field_name

            # If this field is a relationship object, format it server-side (no functions to client)
            if field_name in rel_label_map:
                rel_info = rel_label_map[field_name]
                add_formatting(field_name, _label_expr_for_rel(field_name, rel_info))

            fmt = model_props[field_name].get('format') if field_name in model_props else None
            format_attr = f", format: '{fmt}'" if fmt in ('date-time', 'date', 'time') else ''
            fields_code_parts.append(f"          {{ field: '{field_name}', headerName: tf('{field_key}'), width: {width}{format_attr} }}")

        display_fields_code = ',\n'.join(fields_code_parts)

    if not xdisplay_table:
        for field_name, rel_info in rel_label_map.items():
            add_formatting(field_name, _label_expr_for_rel(field_name, rel_info))

        for field_name, prop in model_props.items():
            actual = _get_actual_type(prop)
            enum_vals = prop.get('enum')
            enum_ns = prop.get('x-enum-namespace')
            native_ns = _native_enum_ns(prop)
            if native_ns and isinstance(enum_vals, list) and _has_string_labels(enum_vals):
                var_name = f'{to_camel_case(field_name)}Labels'
                entries = [(v, _native_enum_key(v)) for v in enum_vals]
                if not any(e['var_name'] == var_name for e in enum_ns_list):
                    enum_ns_list.append({'var_name': var_name, 'ns': native_ns, 'entries': entries, 'is_native_enum': True})
                add_formatting(field_name, f"{var_name}[item.{field_name} as string] ?? item.{field_name}")
            elif actual in ('integer', 'number') and isinstance(enum_vals, list) and _has_string_labels(enum_vals):
                var_name = f'{to_camel_case(field_name)}Labels'
                ns_to_use = enum_ns or 'Fields'
                entries = [
                    (i, f"{field_name}_{v}" if isinstance(v, str) and not str(v).lstrip('-').isdigit() else str(v))
                    if not enum_ns
                    else (i, v.lower()[0] + v[1:] if isinstance(v, str) and not str(v).lstrip('-').isdigit() else str(v))
                    for i, v in enumerate(enum_vals)
                ]
                if not any(e['var_name'] == var_name for e in enum_ns_list):
                    enum_ns_list.append({'var_name': var_name, 'ns': ns_to_use, 'entries': entries, 'is_native_enum': False})
                add_formatting(field_name, f"{var_name}[item.{field_name} as number] ?? ''")

    needs_formatting = bool(formatting_entries)
    formatted_var    = f'formatted{parent_pascal}s'
    src_var          = formatted_var if needs_formatting else f'{parent_camel}s'

    force_cards   = gen_cfg.get('listDisplay') == 'cards'
    list_component = 'CardListClient' if force_cards else 'ResponsiveListClient'

    return {
        'list_component':     list_component,
        'display_fields_code': display_fields_code,
        'primary_field':      primary_field,
        'needs_formatting':   needs_formatting,
        'formatting_entries': '\n'.join(formatting_entries),
        'enum_ns_list':       enum_ns_list,
        'src_var':            src_var,
        'needs_tf':           bool(xdisplay_table),
        'needs_tc':           has_chart,
        'list_uses_format_label_value': list_uses_format_label_value,
    }


# ---------------------------------------------------------------------------
# actions.ts
# ---------------------------------------------------------------------------

def actions_context(ctx: dict) -> dict:
    parent        = ctx['parent']
    model         = ctx['model']
    parent_pascal = ctx['parent_pascal']
    can_create    = ctx['can_create']
    can_update    = ctx['can_update']
    can_delete    = ctx['can_delete']
    parent_params = ctx['parent_params']
    non_comment_ch = ctx['non_comment_ch']
    child_args    = ctx['child_args_for_call']
    form_data_gets = ctx['form_data_gets']
    child_form_data_extractions = ctx['child_form_data_extractions']
    item_context_select = ctx['item_context_select']
    has_children  = bool(non_comment_ch)
    reservation_config = ctx.get('reservation_config')
    has_reservation = bool(reservation_config and reservation_config.get('mode') == 'count')
    should_filter_by_org = bool(ctx.get('should_filter_by_org'))

    sep = ', ' if (parent_params and child_args) else ''
    full_child_args = f'{sep}{child_args}' if child_args else ''

    # Flatten rel extraction code and update args
    flatten_rels_raw = ctx.get('flatten_rels', [])
    non_m2o_flatten = [r for r in flatten_rels_raw if not r['is_m2o']]

    def _flatten_field_extraction_expr(form_key: str, f: dict) -> str:
        # Array-of-$ref fields ship as repeated form entries under a
        # `field[]` key (the FormUpsert appends one per item via
        # `formData.append('{prop}__{name}[]', value)`). `data.getAll`
        # returns them as `FormDataEntryValue[]`; cast to `string[]`.
        if f.get('is_array'):
            return f"data.getAll('{form_key}[]') as string[]"
        ftype = f['prop_type']
        fmt   = f.get('format')
        null  = f.get('nullable', True)
        raw   = f"data.get('{form_key}')"
        if ftype == 'string' and fmt in ('date', 'date-time', 'time'):
            return f"{raw} ? new Date({raw} as string) : null" if null else f"new Date({raw} as string)"
        if ftype in ('integer', 'number'):
            return f"{raw} ? Number({raw}) : null" if null else f"Number({raw})"
        if ftype == 'boolean':
            return f"{raw} === 'true'"
        return f"({raw} as string | null) || null" if null else f"{raw} as string"

    def _flatten_field_ts_type(f: dict) -> str:
        if f.get('is_array'):
            return 'string[]'
        ftype = f['prop_type']
        fmt   = f.get('format')
        null  = f.get('nullable', True)
        sfx   = ' | null' if null else ''
        if ftype == 'string' and fmt in ('date', 'date-time', 'time'):
            return f'Date{sfx}'
        if ftype in ('integer', 'number'):
            return f'number{sfx}'
        if ftype == 'boolean':
            return 'boolean'
        return f'string{sfx}'

    flatten_extractions_lines: list[str] = []
    flatten_update_var_names: list[str] = []

    for _flat in non_m2o_flatten:
        _prop    = _flat['prop_name']
        _fields  = [f for f in _flat['fields'] if not f.get('is_fk')]
        if not _fields:
            continue
        _var     = to_camel_case(_prop) + 'UpdateData'
        _ts_type = '{ ' + '; '.join(
            f"{f['name']}: {_flatten_field_ts_type(f)}" for f in _fields
        ) + ' }'
        # Truthy gate: scalar fields use `data.get(key)`; array fields use
        # `data.getAll(key[]).length > 0`. The form may have only changed
        # the array (e.g., added a symptom) — keep that path live.
        _gate_scalars = [f"'{_prop}__{f['name']}'" for f in _fields if not f.get('is_array')]
        _gate_arrays  = [f"data.getAll('{_prop}__{f['name']}[]').length > 0" for f in _fields if f.get('is_array')]
        _gate_parts: list[str] = []
        if _gate_scalars:
            _gate_parts.append(
                f"[{', '.join(_gate_scalars)}].some(k => {{ const v = data.get(k); return v !== null && v !== ''; }})"
            )
        _gate_parts.extend(_gate_arrays)
        _gate_expr = ' || '.join(_gate_parts) if _gate_parts else 'false'
        _field_exprs  = '\n'.join(
            "    " + f['name'] + ": " + _flatten_field_extraction_expr(f'{_prop}__{f["name"]}', f) + ","
            for f in _fields
        )
        flatten_extractions_lines.append(
            f"  const {_var}: {_ts_type} | null = {_gate_expr}\n"
            f"    ? {{\n{_field_exprs}\n    }}\n"
            f"    : null;"
        )
        flatten_update_var_names.append(_var)

    flatten_extractions_code = '\n'.join(flatten_extractions_lines)
    flatten_args_str = (', ' + ', '.join(flatten_update_var_names)) if flatten_update_var_names else ''

    def _actor_and_existing_block(indent: str) -> str:
        # GAP-2 fix (cmd_452): org-scoped entities must retrieve actorId before the
        # existence check (needed by getAssociatedOrganizations) and re-fetch the
        # target row through an org-filtered findFirst, not a global findUnique —
        # otherwise requirePermission() can only see creator_id/assignee_id and a
        # user with general.update can edit any org's record by id. Applied to
        # every findUnique-before-update site in this function (not only the
        # audited line) since they share the identical gap. should_filter_by_org
        # is False for the overwhelming majority of entities, so this branch is
        # opt-in and leaves every non-org-scoped entity's generated actions.ts
        # byte-identical to the pre-fix output (see the `else` arm below and its
        # callers) — confirmed via cmd_452's golden-diff forward check.
        #
        # The explicit `if (!existing) throw` below is NOT optional: requirePermission()
        # falls back to the top-level (general | creator | assignee) union whenever its
        # item argument is falsy (lib/authz.ts requirePermission — `item && resolvedUserId
        # ? resolvePermissions(...) : permissions`), so a general.update=true caller would
        # still pass the check on a null `existing`, and the subsequent update<Parent>()
        # call would then write to `id` unconditionally — the org-scoped findFirst above
        # would filter the *read* but have zero effect on the *write*. Denying immediately
        # on a null `existing` is what actually stops the cross-org mutation.
        # actorId must already be declared in the enclosing function scope (before
        # the if/else this is nested in) — every should_filter_by_org call site
        # below declares it up front, precisely so it's still in scope for the
        # update/create calls later in the function body.
        return (
            f"{indent}const _orgs = await getAssociatedOrganizations(actorId);\n"
            f"{indent}const _orgIds = _orgs.map((o) => o.id);\n"
            f"{indent}const existing = await prisma.{model}.findFirst({{ where: {{ id, organization_id: {{ in: _orgIds }} }}, select: {item_context_select} }});\n"
            f"{indent}if (!existing) throw new Error('Not found');\n"
        )

    def _upsert_body(has_ch: bool) -> str:
        _flatten_block = (f"{flatten_extractions_code}\n" if flatten_extractions_code else "")
        if can_create and can_update:
            create_call = f'await add{parent_pascal}(actorId, {parent_params}{full_child_args}{flatten_args_str});'
            update_call = f'await update{parent_pascal}(actorId, id, {parent_params}{full_child_args}{flatten_args_str}, srcSnapshotRaw);'
            if has_reservation:
                if should_filter_by_org:
                    return (
                        f"  const id = data.get('id') as string | null;\n"
                        f"  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;\n"
                        f"  const actorId = await getSessionUserIdOrThrow();\n"
                        f"  if (id) {{\n"
                        + _actor_and_existing_block("    ") +
                        f"    await requirePermission('{parent}', 'update', existing);\n"
                        f"  }} else {{\n"
                        f"    await requirePermission('{parent}', 'create');\n"
                        f"  }}\n"
                        f"{form_data_gets}\n"
                        + (f"{child_form_data_extractions}\n" if has_ch else "")
                        + _flatten_block +
                        f"\n  let _serviceError: string | null = null;\n"
                        f"  if (id) {{\n"
                        f"    try {{\n"
                        f"      {update_call}\n"
                        f"    }} catch (e) {{\n"
                        f"      if (e instanceof ReservationMutationError) {{\n"
                        f"        _serviceError = (e as Error).message;\n"
                        f"      }} else {{\n"
                        f"        throw e;\n"
                        f"      }}\n"
                        f"    }}\n"
                        f"  }} else {{\n"
                        f"    try {{\n"
                        f"      {create_call}\n"
                        f"    }} catch (e) {{\n"
                        f"      if (e instanceof InsufficientPoolCapacityError) {{\n"
                        f"        _serviceError = (e as Error).message;\n"
                        f"      }} else {{\n"
                        f"        throw e;\n"
                        f"      }}\n"
                        f"    }}\n"
                        f"  }}\n"
                        f"  if (_serviceError) {{\n"
                        f"    return {{ error: _serviceError }};\n"
                        f"  }}"
                    )
                return (
                    f"  const id = data.get('id') as string | null;\n"
                    f"  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;\n"
                    f"  if (id) {{\n"
                    f"    const existing = await prisma.{model}.findUnique({{ where: {{ id }}, select: {item_context_select} }});\n"
                    f"    await requirePermission('{parent}', 'update', existing);\n"
                    f"  }} else {{\n"
                    f"    await requirePermission('{parent}', 'create');\n"
                    f"  }}\n"
                    f"{form_data_gets}\n"
                    + (f"{child_form_data_extractions}\n" if has_ch else "")
                    + _flatten_block +
                    f"  const actorId = await getSessionUserIdOrThrow();\n\n"
                    f"  let _serviceError: string | null = null;\n"
                    f"  if (id) {{\n"
                    f"    try {{\n"
                    f"      {update_call}\n"
                    f"    }} catch (e) {{\n"
                    f"      if (e instanceof ReservationMutationError) {{\n"
                    f"        _serviceError = (e as Error).message;\n"
                    f"      }} else {{\n"
                    f"        throw e;\n"
                    f"      }}\n"
                    f"    }}\n"
                    f"  }} else {{\n"
                    f"    try {{\n"
                    f"      {create_call}\n"
                    f"    }} catch (e) {{\n"
                    f"      if (e instanceof InsufficientPoolCapacityError) {{\n"
                    f"        _serviceError = (e as Error).message;\n"
                    f"      }} else {{\n"
                    f"        throw e;\n"
                    f"      }}\n"
                    f"    }}\n"
                    f"  }}\n"
                    f"  if (_serviceError) {{\n"
                    f"    return {{ error: _serviceError }};\n"
                    f"  }}"
                )
            if should_filter_by_org:
                return (
                    f"  const id = data.get('id') as string | null;\n"
                    f"  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;\n"
                    f"  const actorId = await getSessionUserIdOrThrow();\n"
                    f"  if (id) {{\n"
                    + _actor_and_existing_block("    ") +
                    f"    await requirePermission('{parent}', 'update', existing);\n"
                    f"  }} else {{\n"
                    f"    await requirePermission('{parent}', 'create');\n"
                    f"  }}\n"
                    f"{form_data_gets}\n"
                    + (f"{child_form_data_extractions}\n" if has_ch else "")
                    + _flatten_block +
                    f"\n  if (id) {{\n"
                    f"    {update_call}\n"
                    f"  }} else {{\n"
                    f"    {create_call}\n"
                    f"  }}"
                )
            return (
                f"  const id = data.get('id') as string | null;\n"
                f"  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;\n"
                f"  if (id) {{\n"
                f"    const existing = await prisma.{model}.findUnique({{ where: {{ id }}, select: {item_context_select} }});\n"
                f"    await requirePermission('{parent}', 'update', existing);\n"
                f"  }} else {{\n"
                f"    await requirePermission('{parent}', 'create');\n"
                f"  }}\n"
                f"{form_data_gets}\n"
                + (f"{child_form_data_extractions}\n" if has_ch else "")
                + _flatten_block +
                f"  const actorId = await getSessionUserIdOrThrow();\n\n"
                f"  if (id) {{\n"
                f"    {update_call}\n"
                f"  }} else {{\n"
                f"    {create_call}\n"
                f"  }}"
            )
        elif can_update:
            if should_filter_by_org:
                return (
                    f"  const id = data.get('id') as string | null;\n"
                    f"  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;\n"
                    f"  if (!id) throw new Error('Create not supported');\n"
                    f"  const actorId = await getSessionUserIdOrThrow();\n"
                    + _actor_and_existing_block("  ") +
                    f"  await requirePermission('{parent}', 'update', existing);\n"
                    f"{form_data_gets}\n"
                    + (f"{child_form_data_extractions}\n" if has_ch else "")
                    + _flatten_block +
                    f"\n  await update{parent_pascal}(actorId, id, {parent_params}{full_child_args}{flatten_args_str}, srcSnapshotRaw);"
                )
            return (
                f"  const id = data.get('id') as string | null;\n"
                f"  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;\n"
                f"  if (!id) throw new Error('Create not supported');\n"
                f"  const existing = await prisma.{model}.findUnique({{ where: {{ id }}, select: {item_context_select} }});\n"
                f"  await requirePermission('{parent}', 'update', existing);\n"
                f"{form_data_gets}\n"
                + (f"{child_form_data_extractions}\n" if has_ch else "")
                + _flatten_block +
                f"\n  const actorId = await getSessionUserIdOrThrow();\n"
                f"  await update{parent_pascal}(actorId, id, {parent_params}{full_child_args}{flatten_args_str}, srcSnapshotRaw);"
            )
        else:  # create only
            return (
                f"  await requirePermission('{parent}', 'create');\n"
                f"{form_data_gets}\n"
                + (f"{child_form_data_extractions}\n" if has_ch else "") +
                f"\n  const actorId = await getSessionUserIdOrThrow();\n"
                f"  await add{parent_pascal}(actorId, {parent_params}{full_child_args}{flatten_args_str});"
            )

    service_fns = [
        f'add{parent_pascal}'    if can_create else '',
        f'update{parent_pascal}' if can_update else '',
        f'delete{parent_pascal}' if can_delete else '',
    ]
    error_imports = ', InsufficientPoolCapacityError, ReservationMutationError' if has_reservation else ''
    service_imports = ', '.join(f for f in service_fns if f) + error_imports

    return {
        'service_imports': service_imports,
        'upsert_body': _upsert_body(has_children),
    }


# ---------------------------------------------------------------------------
# service.ts
# ---------------------------------------------------------------------------

def _build_reservation_mutation_guard_update(rc: dict, model: str) -> str:
    """Generate TypeScript update guard that rejects criteria changes after allocation."""
    if rc.get('transaction_strategy') == 'ledger_transaction':
        return _build_reservation_mutation_guard_update_ledger(rc, model)
    res          = rc.get('result') or {}
    alloc_entity = res.get('allocationEntity') or ''
    parent_field = res.get('parentField') or f'{model}_id'
    lines_entity = rc.get('lines_entity') or ''
    lines_prop   = rc.get('lines') or 'items'
    lines_var    = to_camel_case(lines_prop)

    req          = rc.get('request') or {}
    criteria     = req.get('criteria') or {}
    qty_field    = req.get('quantityField', 'quantity')

    header = (
        f"    // Reservation mutation guard: reject criteria changes after allocation\n"
        f"    const _allocationCount = await tx.{alloc_entity}.count({{\n"
        f"      where: {{ {parent_field}: id }},\n"
        f"    }});\n"
        f"    if (_allocationCount > 0) {{\n"
    )

    if not lines_entity:
        # count mode without lines: compare parent entity quantity directly
        return (
            header +
            f"      const _existing = await tx.{model}.findUnique({{\n"
            f"        where: {{ id }},\n"
            f"        select: {{ {qty_field}: true }},\n"
            f"      }});\n"
            f"      if (_existing && _existing.{qty_field} !== {qty_field}) {{\n"
            f"        throw new ReservationMutationError('Cannot modify reservation criteria after allocation.');\n"
            f"      }}\n"
            f"    }}"
        )

    # count mode with lines: compare line items
    # select fields: all criteria keys + quantity field (deduplicated)
    select_fields_set = list(dict.fromkeys(list(criteria.keys()) + [qty_field]))
    select_fields_str = ', '.join(f'{f}: true' for f in select_fields_set)

    # per-row comparison: criteria keys + quantity field
    check_parts = [f'ex.{f} !== incoming.{f}' for f in select_fields_set]
    criteria_check = ' || '.join(check_parts)

    return (
        header +
        f"      const _existingLines = await tx.{lines_entity}.findMany({{\n"
        f"        where: {{ {model}_id: id }},\n"
        f"        select: {{ id: true, {select_fields_str} }},\n"
        f"      }});\n"
        f"      const _existingMap = new Map(_existingLines.map(i => [i.id, i]));\n"
        f"      const _existingIds = new Set(_existingLines.map(i => i.id));\n"
        f"      const _incomingWithId = {lines_var}Items.filter(i => i.id);\n"
        f"      const _incomingIds = new Set(_incomingWithId.map(i => i.id as string));\n"
        f"      const _mutated =\n"
        f"        {lines_var}Items.some(i => !i.id) ||\n"
        f"        [..._existingIds].some(eid => !_incomingIds.has(eid)) ||\n"
        f"        _incomingWithId.some(incoming => {{\n"
        f"          const ex = _existingMap.get(incoming.id as string);\n"
        f"          return ex !== undefined && ({criteria_check});\n"
        f"        }});\n"
        f"      if (_mutated) {{\n"
        f"        throw new ReservationMutationError('Cannot modify reservation criteria after allocation.');\n"
        f"      }}\n"
        f"    }}"
    )


def _build_reservation_mutation_guard_delete(rc: dict, model: str) -> str:
    """Generate TypeScript delete guard that rejects delete when allocation exists."""
    if rc.get('transaction_strategy') == 'ledger_transaction':
        return _build_reservation_mutation_guard_delete_ledger(rc, model)
    res          = rc.get('result') or {}
    alloc_entity = res.get('allocationEntity') or ''
    parent_field = res.get('parentField') or f'{model}_id'

    return (
        f"  // Reservation mutation guard: reject delete when allocation exists\n"
        f"  const _allocationCount = await prisma.{alloc_entity}.count({{\n"
        f"    where: {{ {parent_field}: {{ in: ids }} }},\n"
        f"  }});\n"
        f"  if (_allocationCount > 0) {{\n"
        f"    throw new ReservationMutationError('Cannot delete {model} with existing reservation allocation.');\n"
        f"  }}"
    )


def _build_ledger_reservation_allocation_code(rc: dict, model: str, schema: dict | None = None) -> str:
    """Generate the TypeScript reserve phase for strategy: ledger_transaction.

    No allocationEntity: each pool claim is written as an inventory_transaction
    ledger row (event_type='reserve', quantity_delta=0 — O-4) instead of an
    allocation table row, and the line entity's own bridge FK
    (result.lineTransactionableField) records which transactions belong to it.

    Lines case (has_lines=True, e.g. purchase_per_item): the line's own
    approvable + approval_request(s) are pre-created and nested-created with
    the parent (see get_approval_lines_props / _build_approval_lines_*_code —
    the ledger_transaction lines prop is folded into that same mechanism),
    so this function only claims inventory and links the bridge FK here —
    it does not touch approvable at all, and never back-fills approvable_id.

    Self case (has_lines=False, no lines_entity — currently unexercised by
    any schema entity): kept on the original create-then-back-fill approvable
    pattern, since there is no embedded child array for the pre-create
    mechanism to hook into; an entity that needs this path with a NOT NULL
    approvable_id would need the leave_request-style one_to_one_pre_creates
    treatment instead (out of scope here — see docs/receiving-approval-backfill-design.md §5.2).
    """
    pool           = rc.get('pool') or {}
    req            = rc.get('request') or {}
    pol            = rc.get('policy') or {}
    res            = rc.get('result') or {}

    # OD-1: domain resolution (required — no defaults)
    domain_key = rc.get('ledger_domain')
    if not domain_key:
        raise ValueError(
            f"x-reservation for {model!r}: transaction.ledgerDomain is required (OD-1)"
        )
    _domain               = resolve_ledger_domain(schema or {}, domain_key)
    pool_entity           = _domain['pool']
    ledger_entity         = _domain['ledger']
    transactionable_entity = _domain['transactionable']

    pool_qty_field = pool.get('quantityField', 'quantity')
    pool_res_field = pool.get('reservedField', 'reserved_quantity')
    lines_prop     = rc.get('lines')
    lines_entity   = rc.get('lines_entity') or ''
    req_qty_field  = req.get('quantityField', 'quantity')
    criteria       = req.get('criteria') or {}
    policy_order   = pol.get('orderBy') or []
    line_txable_f  = res.get('lineTransactionableField')
    if not line_txable_f:
        raise ValueError(
            f"x-reservation for {model!r}: result.lineTransactionableField is required (OD-1)"
        )
    entity_name    = lines_entity or model
    has_lines      = rc.get('hasLines', bool(lines_entity))
    self_qty_field = rc.get('selfQuantityField', req_qty_field)

    def _order_entry(field: str, direction: str) -> str:
        if direction == 'asc_nulls_last':
            return f"{{ {field}: {{ sort: 'asc', nulls: 'last' }} }}"
        if direction == 'desc_nulls_first':
            return f"{{ {field}: {{ sort: 'desc', nulls: 'first' }} }}"
        return f"{{ {field}: '{direction}' }}"

    order_parts: list[str] = []
    for item in policy_order:
        for field, direction in item.items():
            order_parts.append(_order_entry(field, str(direction)))
    order_str = ', '.join(order_parts)

    criteria_lines = [f'          {k}: _line.{v},' for k, v in criteria.items()]
    criteria_str   = '\n'.join(criteria_lines) if criteria_lines else ''
    where_clause = f"          {pool_qty_field}: {{ gt: 0 }},"
    if criteria_str:
        where_clause = criteria_str + '\n' + f"          {pool_qty_field}: {{ gt: 0 }},"

    # Per-line body: claim inventory via ledger rows against one shared bridge.
    claim_body = (
        f"      const _candidates = await tx.{pool_entity}.findMany({{\n"
        f"        where: {{\n"
        f"{where_clause}\n"
        f"        }},\n"
        + (f"        orderBy: [{order_str}],\n" if order_str else '') +
        f"        include: {{ location: true }},\n"
        f"      }});\n"
        f"      const bridge = await tx.{transactionable_entity}.create({{ data: {{}} }});\n"
        f"      for (const _candidate of _candidates) {{\n"
        f"        if (_remaining <= 0) break;\n"
        f"        const _available = _candidate.{pool_qty_field} - _candidate.{pool_res_field};\n"
        f"        if (_available <= 0) continue;\n"
        f"        const _claim = Math.min(_remaining, _available);\n"
        f"        const _claimResult = await tx.{pool_entity}.updateMany({{\n"
        f"          where: {{ id: _candidate.id, {pool_res_field}: {{ lte: _candidate.{pool_qty_field} - _claim }} }},\n"
        f"          data: {{ {pool_res_field}: {{ increment: _claim }} }}, // O-4: quantity unchanged on reserve\n"
        f"        }});\n"
        f"        if (_claimResult.count > 0) {{\n"
        f"          _remaining -= _claim;\n"
        f"          await tx.{ledger_entity}.create({{\n"
        f"            data: {{\n"
        f"              {line_txable_f}: bridge.id,\n"
        f"              event_type: 'reserve',\n"
        f"              quantity_delta: 0,\n"
        f"              reserved_delta: _claim,\n"
        f"              product_id: _candidate.product_id,\n"
        f"              location: _candidate.location?.name ?? '',\n"
        f"              lot_number: _candidate.lot_number,\n"
        f"              expiration_date: _candidate.expiration_date,\n"
        f"              created_by_id: actorId,\n"
        f"              creator_id: actorId,\n"
        f"              updater_id: actorId,\n"
        f"            }},\n"
        f"          }});\n"
        f"        }}\n"
        f"      }}\n"
        f"      if (_remaining > 0) {{\n"
        f"        throw new InsufficientPoolCapacityError(\n"
        f"          `Insufficient inventory for {entity_name} line`\n"
        f"        );\n"
        f"      }}\n"
    )

    # Self case only (no lines_entity): approvable is created inline and
    # back-filled, since there's no embedded child array for the pre-create
    # mechanism to hook into (see function docstring).
    approval_body = (
        f"\n"
        f"      const approvable = await tx.approvable.create({{ data: {{}} }});\n"
        f"      let _hasFlow = false;\n"
        f"      for (const flow of _approvalFlows) {{\n"
        f"        if (flow.requestor_role_id && !_creatorRoleIds.includes(flow.requestor_role_id)) {{\n"
        f"          continue;\n"
        f"        }}\n"
        f"        await tx.approval_request.create({{\n"
        f"          data: {{ approvable_id: approvable.id, approval_flow_id: flow.id, status: 'Pending' }},\n"
        f"        }});\n"
        f"        _hasFlow = true;\n"
        f"      }}\n"
        f"      if (_hasFlow) {{\n"
        f"        await tx.approvable.update({{ where: {{ id: approvable.id }}, data: {{ creator_id: actorId }} }});\n"
        f"      }}\n"
    )

    header_comment = (
        f"    // Reservation (strategy: ledger_transaction): allocate {pool_entity} via\n"
        f"    // inventory_transaction ledger rows (O-4/O-6/O-8) — no allocation entity.\n"
    )
    approval_lookup_header = (
        f"    const _creator = await tx.user.findUnique({{\n"
        f"      where: {{ id: actorId }},\n"
        f"      select: {{ roles: {{ select: {{ id: true }} }} }},\n"
        f"    }});\n"
        f"    const _creatorRoleIds = _creator?.roles.map((r) => r.id) ?? [];\n"
        f"    const _approvalFlows = await tx.approval_flow.findMany({{\n"
        f"      where: {{ entity_name: '{entity_name}' }},\n"
        f"    }});\n"
    )

    if not lines_entity:
        # count mode without lines: the request entity itself is the single line
        return (
            header_comment + approval_lookup_header +
            f"    {{\n"
            f"      let _remaining = (created as Record<string, unknown>).{self_qty_field} as number;\n"
            + claim_body + approval_body +
            f"      await tx.{model}.update({{\n"
            f"        where: {{ id: created.id }},\n"
            f"        data: {{\n"
            f"          {line_txable_f}: bridge.id,\n"
            f"          approvable_id: approvable.id,\n"
            f"        }},\n"
            f"      }});\n"
            f"    }}"
        )

    # Lines case (e.g. purchase_per_item): approvable_id was already set on
    # each line by the parent's nested-create (get_approval_lines_props pre-
    # create/post-create mechanism — see docstring). Only the inventory
    # claim + bridge link happen here; approvable is never touched.
    return (
        header_comment +
        f"    const _reservationLines = await tx.{lines_entity}.findMany({{\n"
        f"      where: {{ {model}_id: created.id }},\n"
        f"    }});\n"
        f"    for (const _line of _reservationLines) {{\n"
        f"      let _remaining = (_line as Record<string, unknown>).{req_qty_field} as number;\n"
        + claim_body +
        f"      await tx.{lines_entity}.update({{\n"
        f"        where: {{ id: _line.id }},\n"
        f"        data: {{\n"
        f"          {line_txable_f}: bridge.id,\n"
        f"        }},\n"
        f"      }});\n"
        f"    }}"
    )


def _build_reservation_mutation_guard_update_ledger(rc: dict, model: str) -> str:
    """Mutation guard for strategy: ledger_transaction (no allocationEntity).

    A line counts as "allocated" once it has a non-null lineTransactionableField.
    """
    res            = rc.get('result') or {}
    line_txable_f  = res.get('lineTransactionableField')
    if not line_txable_f:
        raise ValueError(f"x-reservation for {model!r}: result.lineTransactionableField is required")
    lines_entity   = rc.get('lines_entity') or ''
    lines_prop     = rc.get('lines') or 'items'
    lines_var      = to_camel_case(lines_prop)

    req         = rc.get('request') or {}
    criteria    = req.get('criteria') or {}
    qty_field   = req.get('quantityField', 'quantity')

    if not lines_entity:
        return (
            f"    // Reservation mutation guard (ledger_transaction): reject criteria changes after allocation\n"
            f"    const _existingSelf = await tx.{model}.findUnique({{\n"
            f"      where: {{ id }},\n"
            f"      select: {{ {qty_field}: true, {line_txable_f}: true }},\n"
            f"    }});\n"
            f"    if (_existingSelf?.{line_txable_f} && _existingSelf.{qty_field} !== {qty_field}) {{\n"
            f"      throw new ReservationMutationError('Cannot modify reservation criteria after allocation.');\n"
            f"    }}"
        )

    select_fields_set = list(dict.fromkeys(list(criteria.keys()) + [qty_field]))
    select_fields_str = ', '.join(f'{f}: true' for f in select_fields_set)
    check_parts = [f'ex.{f} !== incoming.{f}' for f in select_fields_set]
    criteria_check = ' || '.join(check_parts)

    return (
        f"    // Reservation mutation guard (ledger_transaction): reject criteria changes after allocation\n"
        f"    const _allocatedCount = await tx.{lines_entity}.count({{\n"
        f"      where: {{ {model}_id: id, {line_txable_f}: {{ not: null }} }},\n"
        f"    }});\n"
        f"    if (_allocatedCount > 0) {{\n"
        f"      const _existingLines = await tx.{lines_entity}.findMany({{\n"
        f"        where: {{ {model}_id: id }},\n"
        f"        select: {{ id: true, {select_fields_str} }},\n"
        f"      }});\n"
        f"      const _existingMap = new Map(_existingLines.map(i => [i.id, i]));\n"
        f"      const _existingIds = new Set(_existingLines.map(i => i.id));\n"
        f"      const _incomingWithId = {lines_var}Items.filter(i => i.id);\n"
        f"      const _incomingIds = new Set(_incomingWithId.map(i => i.id as string));\n"
        f"      const _mutated =\n"
        f"        {lines_var}Items.some(i => !i.id) ||\n"
        f"        [..._existingIds].some(eid => !_incomingIds.has(eid)) ||\n"
        f"        _incomingWithId.some(incoming => {{\n"
        f"          const ex = _existingMap.get(incoming.id as string);\n"
        f"          return ex !== undefined && ({criteria_check});\n"
        f"        }});\n"
        f"      if (_mutated) {{\n"
        f"        throw new ReservationMutationError('Cannot modify reservation criteria after allocation.');\n"
        f"      }}\n"
        f"    }}"
    )


def _build_reservation_mutation_guard_delete_ledger(rc: dict, model: str) -> str:
    """Delete guard for strategy: ledger_transaction (no allocationEntity)."""
    res            = rc.get('result') or {}
    line_txable_f  = res.get('lineTransactionableField')
    if not line_txable_f:
        raise ValueError(f"x-reservation for {model!r}: result.lineTransactionableField is required")
    lines_entity   = rc.get('lines_entity') or ''

    if not lines_entity:
        return (
            f"  // Reservation mutation guard (ledger_transaction): reject delete when allocated\n"
            f"  const _allocatedCount = await prisma.{model}.count({{\n"
            f"    where: {{ id: {{ in: ids }}, {line_txable_f}: {{ not: null }} }},\n"
            f"  }});\n"
            f"  if (_allocatedCount > 0) {{\n"
            f"    throw new ReservationMutationError('Cannot delete {model} with existing reservation allocation.');\n"
            f"  }}"
        )

    return (
        f"  // Reservation mutation guard (ledger_transaction): reject delete when allocated\n"
        f"  const _allocatedCount = await prisma.{lines_entity}.count({{\n"
        f"    where: {{ {model}_id: {{ in: ids }}, {line_txable_f}: {{ not: null }} }},\n"
        f"  }});\n"
        f"  if (_allocatedCount > 0) {{\n"
        f"    throw new ReservationMutationError('Cannot delete {model} with existing reservation allocation.');\n"
        f"  }}"
    )


def _build_reservation_allocation_code(rc: dict, model: str, schema: dict | None = None) -> str:
    """Generate the TypeScript allocation phase for count mode reservation."""
    if rc.get('transaction_strategy') == 'ledger_transaction':
        return _build_ledger_reservation_allocation_code(rc, model, schema)
    pool        = rc.get('pool') or {}
    req         = rc.get('request') or {}
    pol         = rc.get('policy') or {}
    res         = rc.get('result') or {}

    pool_entity     = pool.get('entity')
    if not pool_entity:
        raise ValueError(f"x-reservation for {model!r}: pool.entity is required")
    pool_qty_field  = pool.get('quantityField', 'quantity')
    pool_res_field  = pool.get('reservedField', 'reserved_quantity')
    lines_prop      = rc.get('lines')  # None when no lines configured
    lines_entity    = rc.get('lines_entity') or ''
    req_qty_field   = req.get('quantityField', 'quantity')
    criteria        = req.get('criteria') or {}
    policy_order    = pol.get('orderBy') or []
    alloc_entity    = res.get('allocationEntity') or ''
    parent_field    = res.get('parentField') or f'{model}_id'
    # line_field is only meaningful when a lines entity exists
    line_field      = res.get('lineField') or (f'{lines_entity}_id' if lines_entity else None)
    pool_field      = res.get('poolField') or f'{pool_entity}_id'
    alloc_qty       = res.get('quantityField') or 'quantity'

    # Criteria where clause entries (each line has criteria fields)
    criteria_lines = [f'          {k}: _line.{v},' for k, v in criteria.items()]
    criteria_str   = '\n'.join(criteria_lines) if criteria_lines else ''

    # orderBy entries
    def _order_entry(field: str, direction: str) -> str:
        if direction == 'asc_nulls_last':
            return f"{{ {field}: {{ sort: 'asc', nulls: 'last' }} }}"
        if direction == 'desc_nulls_first':
            return f"{{ {field}: {{ sort: 'desc', nulls: 'first' }} }}"
        return f"{{ {field}: '{direction}' }}"

    order_parts: list[str] = []
    for item in policy_order:
        for field, direction in item.items():
            order_parts.append(_order_entry(field, str(direction)))
    order_str = ', '.join(order_parts)

    # Allocation row creation (optional)
    alloc_block = ''
    if alloc_entity:
        alloc_block = (
            f"          await tx.{alloc_entity}.create({{\n"
            f"            data: {{\n"
            f"              {parent_field}: created.id,\n"
            f"              {line_field}: _line.id,\n"
            f"              {pool_field}: _candidate.id,\n"
            f"              {alloc_qty}: _claim,\n"
            f"              creator_id: actorId,\n"
            f"              updater_id: actorId,\n"
            f"            }},\n"
            f"          }});\n"
        )

    has_lines = rc.get('hasLines', True)
    self_qty_field = rc.get('selfQuantityField', req_qty_field)

    lines = [
        f"    // Reservation: count mode — allocate {pool_entity} for each {lines_prop or 'request'} line",
    ]
    if lines_entity:
        lines.append(
            f"    const _reservationLines = await tx.{lines_entity}.findMany({{\n"
            f"      where: {{ {model}_id: created.id }},\n"
            f"    }});"
        )
        iter_var = '_reservationLines'
    elif not has_lines:
        # ④A: count mode without lines — treat the request entity itself as the single line
        lines.append(
            f"    const _reservationLines = [{{ ...created, {req_qty_field}: "
            f"(created as Record<string, unknown>).{self_qty_field} as number }}];"
        )
        iter_var = '_reservationLines'
    else:
        iter_var = f'(created as Record<string, unknown>).{lines_prop} as Record<string, unknown>[]'

    where_clause = f"          {pool_qty_field}: {{ gt: 0 }},"
    if criteria_str:
        where_clause = criteria_str + '\n' + f"          {pool_qty_field}: {{ gt: 0 }},"

    alloc_has_creator = rc.get('alloc_has_creator', True)

    # Allocation row creation (optional); line_field omitted when no lines entity;
    # creator_id/updater_id omitted when allocation entity has no such fields.
    alloc_block = ''
    if alloc_entity:
        alloc_data_entries = [f"              {parent_field}: created.id,"]
        if line_field:
            alloc_data_entries.append(f"              {line_field}: _line.id,")
        alloc_data_entries += [
            f"              {pool_field}: _candidate.id,",
            f"              {alloc_qty}: _claim,",
        ]
        if rc.get('has_actions'):
            _rem_f_ac = rc.get('actions_remaining_field', 'remaining_quantity')
            _stat_f_ac = rc.get('actions_status_field', 'status')
            _init_status = rc.get('actions_initial_status', 'reserved')
            _init_status_ts = _enum_value_literal(
                _status_prop_defn(schema, alloc_entity, _stat_f_ac), _init_status)
            alloc_data_entries += [
                f"              {_rem_f_ac}: _claim,",
                f"              {_stat_f_ac}: {_init_status_ts},",
            ]
        if alloc_has_creator:
            alloc_data_entries += [
                f"              creator_id: actorId,",
                f"              updater_id: actorId,",
            ]
        alloc_block = (
            f"          await tx.{alloc_entity}.create({{\n"
            f"            data: {{\n"
            + '\n'.join(alloc_data_entries) + '\n'
            + f"            }},\n"
            + f"          }});\n"
        )

    # ---- NO-LINES branch: count mode without a line entity ----
    # Allocates directly from created.{req_qty_field} without iterating lines.
    if not lines_entity:
        lines = [
            f"    // Reservation: count mode — allocate {pool_entity}",
            f"    {{",
            f"      let _remaining = (created as Record<string, unknown>).{req_qty_field} as number;",
            f"      const _candidates = await tx.{pool_entity}.findMany({{",
            f"        where: {{",
            f"{where_clause}",
            f"        }},",
        ]
        if order_str:
            lines.append(f"        orderBy: [{order_str}],")
        lines += [
            f"      }});",
            f"      for (const _candidate of _candidates) {{",
            f"        if (_remaining <= 0) break;",
            f"        const _claim = Math.min(_remaining, _candidate.{pool_qty_field});",
            f"        const _claimResult = await tx.{pool_entity}.updateMany({{",
            f"          where: {{ id: _candidate.id, {pool_qty_field}: {{ gte: _claim }} }},",
            f"          data: {{",
            f"            {pool_qty_field}: {{ decrement: _claim }},",
            f"            {pool_res_field}: {{ increment: _claim }},",
            f"          }},",
            f"        }});",
            f"        if (_claimResult.count > 0) {{",
            f"          _remaining -= _claim;",
        ]
        if alloc_block:
            lines.append(alloc_block.rstrip('\n'))
        lines += [
            f"        }}",
            f"      }}",
            f"      if (_remaining > 0) {{",
            f"        throw new InsufficientPoolCapacityError(",
            f"          `Insufficient inventory for request ${{created.id}}`",
            f"        );",
            f"      }}",
            f"    }}",
        ]
        return '\n'.join(lines)

    # ---- WITH-LINES branch: count mode with a line entity ----
    lines = [
        f"    // Reservation: count mode — allocate {pool_entity} for each {lines_prop} line",
        f"    const _reservationLines = await tx.{lines_entity}.findMany({{\n"
        f"      where: {{ {model}_id: created.id }},\n"
        f"    }});",
        f"    for (const _line of _reservationLines) {{",
        f"      let _remaining = (_line as Record<string, unknown>).{req_qty_field} as number;",
        f"      const _candidates = await tx.{pool_entity}.findMany({{",
        f"        where: {{",
        f"{where_clause}",
        f"        }},",
    ]
    if order_str:
        lines.append(f"        orderBy: [{order_str}],")
    lines += [
        f"      }});",
        f"      for (const _candidate of _candidates) {{",
        f"        if (_remaining <= 0) break;",
        f"        const _claim = Math.min(_remaining, _candidate.{pool_qty_field});",
        f"        const _claimResult = await tx.{pool_entity}.updateMany({{",
        f"          where: {{ id: _candidate.id, {pool_qty_field}: {{ gte: _claim }} }},",
        f"          data: {{",
        f"            {pool_qty_field}: {{ decrement: _claim }},",
        f"            {pool_res_field}: {{ increment: _claim }},",
        f"          }},",
        f"        }});",
        f"        if (_claimResult.count > 0) {{",
        f"          _remaining -= _claim;",
    ]
    if alloc_block:
        lines.append(alloc_block.rstrip('\n'))
    lines += [
        f"        }}",
        f"      }}",
        f"      if (_remaining > 0) {{",
        f"        throw new InsufficientPoolCapacityError(",
        f"          `Insufficient inventory for product ${{(_line as Record<string, unknown>).product_id}}`",
        f"        );",
        f"      }}",
        f"    }}",
    ]
    return '\n'.join(lines)


def _build_reservation_action_functions(rc: dict, model: str, schema: dict | None = None) -> str:
    """Generate TypeScript action functions for shipOrder / releaseReservation / cancelReservation."""
    actions: list[dict] = rc.get('reservation_actions', [])
    if not actions:
        return ''
    pool = rc.get('pool') or {}
    pool_entity = pool.get('entity')
    if not pool_entity:
        raise ValueError(f"x-reservation for {model!r}: pool.entity is required in action functions")
    pool_qty_field = pool.get('quantityField', 'quantity')
    pool_res_field = pool.get('reservedField', 'reserved_quantity')
    res = rc.get('result') or {}
    parent_field = res.get('parentField') or f'{model}_id'
    # FK field on the allocation row that points to the pool entity
    pool_fk_on_alloc = res.get('poolField') or f'{pool_entity}_id'

    # Build a type that includes all needed Prisma models for the action transaction
    alloc_entities = list({a.get('allocationEntity', '') for a in actions if a.get('allocationEntity')})
    tx_type_parts = [f"'{model}'", f"'{pool_entity}'"] + [f"'{e}'" for e in alloc_entities]
    tx_type = f"Pick<typeof prisma, {' | '.join(tx_type_parts)}>"

    parts: list[str] = [f"type ActionTxClient = {tx_type};"]
    for action in actions:
        act_name = action['name']
        act_type = action['type']
        alloc_entity = action.get('allocationEntity', '')
        rem_field = action.get('remainingField', 'remaining_quantity')
        stat_field = action.get('statusField', 'status')
        open_statuses = action.get('openStatuses', [])
        done_status = action.get('doneStatus', '')
        # Resolve status literals against the allocation entity's status field so
        # integer-enum statuses are emitted as ordinals (string enums stay quoted).
        _status_defn = _status_prop_defn(schema, alloc_entity, stat_field)
        open_statuses_ts = ', '.join(_enum_value_literal(_status_defn, s) for s in open_statuses)
        done_status_ts = _enum_value_literal(_status_defn, done_status)
        partial_status_ts = _enum_value_literal(_status_defn, 'partially_shipped')

        if act_type == 'ship':
            parts.append(
                f"export async function {act_name}(\n"
                f"  orderId: string,\n"
                f"  requestedQty: number,\n"
                f"  actorId: string\n"
                f"): Promise<void> {{\n"
                f"  await prisma.$transaction(async (tx) => {{\n"
                f"    const _tx = tx as unknown as ActionTxClient;\n"
                f"    const allocations = await _tx.{alloc_entity}.findMany({{\n"
                f"      where: {{\n"
                f"        {parent_field}: orderId,\n"
                f"        {stat_field}: {{ in: [{open_statuses_ts}] }},\n"
                f"      }},\n"
                f"      orderBy: {{ created_at: 'asc' }},\n"
                f"    }});\n"
                f"    let _remaining = requestedQty;\n"
                f"    for (const alloc of allocations) {{\n"
                f"      if (_remaining <= 0) break;\n"
                f"      const _remQty = (alloc as Record<string, unknown>).{rem_field} as number;\n"
                f"      const actionQty = Math.min(_remaining, _remQty);\n"
                f"      const _result = await _tx.{pool_entity}.updateMany({{\n"
                f"        where: {{\n"
                f"          id: (alloc as Record<string, unknown>).{pool_fk_on_alloc} as string,\n"
                f"          {pool_res_field}: {{ gte: actionQty }},\n"
                f"        }},\n"
                f"        data: {{\n"
                f"          {pool_res_field}: {{ decrement: actionQty }},\n"
                f"        }},\n"
                f"      }});\n"
                f"      if (_result.count > 0) {{\n"
                f"        const newRemaining = _remQty - actionQty;\n"
                f"        await _tx.{alloc_entity}.update({{\n"
                f"          where: {{ id: alloc.id }},\n"
                f"          data: {{\n"
                f"            {rem_field}: newRemaining,\n"
                f"            {stat_field}: newRemaining === 0 ? {done_status_ts} : {partial_status_ts},\n"
                f"            updater_id: actorId,\n"
                f"          }},\n"
                f"        }});\n"
                f"        _remaining -= actionQty;\n"
                f"      }}\n"
                f"    }}\n"
                f"  }}, {{ isolationLevel: 'Serializable' }});\n"
                f"}}"
            )
        elif act_type == 'release':
            parts.append(
                f"export async function {act_name}(\n"
                f"  orderId: string,\n"
                f"  releaseQty: number,\n"
                f"  actorId: string\n"
                f"): Promise<void> {{\n"
                f"  await prisma.$transaction(async (tx) => {{\n"
                f"    const _tx = tx as unknown as ActionTxClient;\n"
                f"    const allocations = await _tx.{alloc_entity}.findMany({{\n"
                f"      where: {{\n"
                f"        {parent_field}: orderId,\n"
                f"        {stat_field}: {{ in: [{open_statuses_ts}] }},\n"
                f"      }},\n"
                f"      orderBy: {{ created_at: 'asc' }},\n"
                f"    }});\n"
                f"    let _remaining = releaseQty;\n"
                f"    for (const alloc of allocations) {{\n"
                f"      if (_remaining <= 0) break;\n"
                f"      const _remQty = (alloc as Record<string, unknown>).{rem_field} as number;\n"
                f"      const actionQty = Math.min(_remaining, _remQty);\n"
                f"      const _result = await _tx.{pool_entity}.updateMany({{\n"
                f"        where: {{\n"
                f"          id: (alloc as Record<string, unknown>).{pool_fk_on_alloc} as string,\n"
                f"          {pool_res_field}: {{ gte: actionQty }},\n"
                f"        }},\n"
                f"        data: {{\n"
                f"          {pool_qty_field}: {{ increment: actionQty }},\n"
                f"          {pool_res_field}: {{ decrement: actionQty }},\n"
                f"        }},\n"
                f"      }});\n"
                f"      if (_result.count > 0) {{\n"
                f"        const newRemaining = _remQty - actionQty;\n"
                f"        await _tx.{alloc_entity}.update({{\n"
                f"          where: {{ id: alloc.id }},\n"
                f"          data: {{\n"
                f"            {rem_field}: newRemaining,\n"
                f"            {stat_field}: newRemaining === 0 ? {done_status_ts} : {partial_status_ts},\n"
                f"            updater_id: actorId,\n"
                f"          }},\n"
                f"        }});\n"
                f"        _remaining -= actionQty;\n"
                f"      }}\n"
                f"    }}\n"
                f"  }}, {{ isolationLevel: 'Serializable' }});\n"
                f"}}"
            )
        elif act_type == 'cancel':
            parts.append(
                f"export async function {act_name}(\n"
                f"  orderId: string,\n"
                f"  actorId: string\n"
                f"): Promise<void> {{\n"
                f"  await prisma.$transaction(async (tx) => {{\n"
                f"    const _tx = tx as unknown as ActionTxClient;\n"
                f"    const allocations = await _tx.{alloc_entity}.findMany({{\n"
                f"      where: {{\n"
                f"        {parent_field}: orderId,\n"
                f"        {stat_field}: {{ in: [{open_statuses_ts}] }},\n"
                f"      }},\n"
                f"    }});\n"
                f"    for (const alloc of allocations) {{\n"
                f"      const releaseQty = (alloc as Record<string, unknown>).{rem_field} as number;\n"
                f"      await _tx.{pool_entity}.updateMany({{\n"
                f"        where: {{\n"
                f"          id: (alloc as Record<string, unknown>).{pool_fk_on_alloc} as string,\n"
                f"          {pool_res_field}: {{ gte: releaseQty }},\n"
                f"        }},\n"
                f"        data: {{\n"
                f"          {pool_qty_field}: {{ increment: releaseQty }},\n"
                f"          {pool_res_field}: {{ decrement: releaseQty }},\n"
                f"        }},\n"
                f"      }});\n"
                f"      await _tx.{alloc_entity}.update({{\n"
                f"        where: {{ id: alloc.id }},\n"
                f"        data: {{\n"
                f"          {rem_field}: 0,\n"
                f"          {stat_field}: {done_status_ts},\n"
                f"          updater_id: actorId,\n"
                f"        }},\n"
                f"      }});\n"
                f"    }}\n"
                f"  }}, {{ isolationLevel: 'Serializable' }});\n"
                f"}}"
            )

    return '\n\n'.join(parts)


def _build_action_route_code(action: dict, parent: str, model: str) -> str:
    """Generate the content of a POST action route handler file."""
    act_name = action['name']
    act_type = action['type']

    if act_type == 'cancel':
        body_destructure = ''
        service_call = f"await {act_name}(id, actorId);"
    else:
        qty_param = 'requestedQty' if act_type == 'ship' else 'releaseQty'
        body_destructure = f"\n  const {{ {qty_param} }} = await req.json();"
        service_call = f"await {act_name}(id, {qty_param}, actorId);"

    return (
        f"import {{ NextRequest, NextResponse }} from 'next/server';\n"
        f"import {{ {act_name} }} from '@/lib/{parent}/reservation_actions';\n"
        f"import {{ authenticateApiKey }} from '@/lib/api-auth';\n"
        f"\n"
        f"type Params = {{ params: Promise<{{ id: string }}> }};\n"
        f"export async function POST(\n"
        f"  req: NextRequest,\n"
        f"  {{ params }}: Params\n"
        f"): Promise<NextResponse> {{\n"
        f"  const {{ id }} = await params;{body_destructure}\n"
        f"  const {{ userId: actorId }} = await authenticateApiKey(req);\n"
        f"  try {{\n"
        f"    {service_call}\n"
        f"    return NextResponse.json({{ ok: true }});\n"
        f"  }} catch (err) {{\n"
        f"    const message = err instanceof Error ? err.message : String(err);\n"
        f"    return NextResponse.json({{ error: message }}, {{ status: 500 }});\n"
        f"  }}\n"
        f"}}\n"
    )


def get_reservation_action_routes(rc: dict, model: str) -> list[dict]:
    """Return list of {act_type, act_name, code} for each action in rc."""
    actions: list[dict] = rc.get('reservation_actions', [])
    parent = model  # model == parent here (same naming)
    return [
        {
            'act_type': a['type'],
            'act_name': a['name'],
            'code': _build_action_route_code(a, parent, model),
        }
        for a in actions
    ]


# ---------------------------------------------------------------------------
# x-approval-lines: pre-create approval on new:false embedded line children
# ---------------------------------------------------------------------------
#
# receiving_receipt_line (and similarly-shaped line children) carry x-approval
# but are new:false — they're created only via the parent's nested-create and
# never run their own service_after_create, so approvable/approval_request
# rows never get generated for them. approvable_id is also mandatory
# (String @unique, non-null), so a create-then-UPDATE-back-fill approach
# would violate the NOT NULL constraint. Instead, one approvable is
# pre-created per line *before* the parent create, so the nested-create body
# can include approvable_id directly.
#
# purchase_per_item (x-reservation, transaction.strategy: ledger_transaction)
# has the exact same shape and gap, so helpers.schema_helpers.
# get_approval_lines_props() folds both signals into one list and this same
# pre-create/post-create pair covers both — see
# docs/receiving-approval-backfill-design.md §5.2 (D2).

def _resolve_approval_lines_entity(model: str, prop_name: str, schema: dict) -> str:
    """Resolve the child entity name for an x-approval-lines property.

    The parent's own definition has no properties for embedded list children
    — only the `{model}_detail` allOf view does — so entity resolution goes
    through `{model}_detail.properties.{prop_name}.items.$ref`.
    """
    props = get_detail_properties(model, schema) or {}
    prop  = props.get(prop_name, {})
    ref   = (prop.get('items') or {}).get('$ref', '')
    entity = ref.rsplit('/', 1)[-1]
    if not entity:
        raise ValueError(
            f"x-approval-lines: cannot resolve entity for {model}.{prop_name} "
            f"via {model}_detail.properties.{prop_name}.items.$ref"
        )
    return entity


def _build_approval_lines_pre_create_code(parent_def: dict, model: str, schema: dict, mode: str = 'create') -> str:
    """Pre-create one approvable per line, before the parent create/update.

    mode='create': pre-creates for every incoming line (all get nested-created).
    mode='update': pre-creates only for newly-added lines (no `id` — see
    _build_child_nested_update), since existing lines already have an
    approvable from their original creation.
    """
    props = get_approval_lines_props(parent_def, model, schema)
    if not props:
        return ''
    blocks = []
    for prop_name in props:
        child_var = safe_var_name(prop_name)
        arr_var   = f'_{child_var}ApprIds'
        if mode == 'update':
            src_var = f'_{child_var}NewItems'
            blocks.append(f"    const {src_var} = {child_var}Items.filter(f => !f.id);")
        else:
            src_var = f'{child_var}Items'
        blocks.append(
            f"    const {arr_var} = {src_var}.length > 0\n"
            f"      ? await Promise.all({src_var}.map(() => tx.approvable.create({{ data: {{}} }}).then((a) => a.id)))\n"
            f"      : [];"
        )
    return '\n'.join(blocks)


def _build_approval_create_block_for_entity(
    approvable_id_expr: str,
    actor_id_expr: str,
    flows_var: str,
    role_ids_var: str,
    tx_var: str = 'tx',
    indent: str = '  ',
) -> str:
    """Create approval_request(s) for ONE pre-created approvable against a
    pre-fetched, creator-role-filtered approval_flow[], then stamp
    creator_id on the approvable if any flow matched.

    Shared inner block (cmd_296 Phase2 common-helper — see
    docs/split-generalization-design.md §4.2) for:
      - _build_approval_lines_post_create_code (cmd_295 x-approval-lines):
        called once per pre-created array element, inside the caller's
        `for (const _apprId of {arr}) {...}` loop.
      - split_action_route.ts.jinja2 (cmd_296 split): called once per part,
        directly in the per-part loop — one approvable at a time, no array.

    Caller pre-fetches `flows_var` (approval_flow[] for the entity) and
    `role_ids_var` (creator's role ids) once, outside any per-approvable loop.

    cmd_413 fix: notifies every approver-role holder for each created
    approval_request via notifyApprovalRequestCreated (mirrors Trigger #2 in
    service_after_create_stub.ts.jinja2, which only covers the top-level
    single-entity afterCreate path — this shared block is the datagrid-child
    / split-action path, which never had the notify call at all). Caller
    must import notifyApprovalRequestCreated from '@/lib/_notifyApprovalRequest'.
    """
    return (
        f"{indent}let _hasFlow = false;\n"
        f"{indent}for (const _flow of {flows_var}) {{\n"
        f"{indent}  if (_flow.requestor_role_id && !{role_ids_var}.includes(_flow.requestor_role_id)) {{\n"
        f"{indent}    continue;\n"
        f"{indent}  }}\n"
        f"{indent}  const _apprReq = await {tx_var}.approval_request.create({{\n"
        f"{indent}    data: {{ approvable_id: {approvable_id_expr}, approval_flow_id: _flow.id, status: 'Pending' }},\n"
        f"{indent}  }});\n"
        f"{indent}  await notifyApprovalRequestCreated({tx_var}, _apprReq.id, {{ excludeUserId: {actor_id_expr} }});\n"
        f"{indent}  _hasFlow = true;\n"
        f"{indent}}}\n"
        f"{indent}if (_hasFlow) {{\n"
        f"{indent}  await {tx_var}.approvable.update({{\n"
        f"{indent}    where: {{ id: {approvable_id_expr} }},\n"
        f"{indent}    data: {{ creator_id: {actor_id_expr} }},\n"
        f"{indent}  }});\n"
        f"{indent}}}"
    )


def _build_split_approval_inherit_block(indent: str = '  ') -> str:
    """Create approval_request(s) for ONE split child, inheriting the flow IDs
    from the parent's own (pre-split) approval_request rows — unconditionally,
    with no requestor-role filter.

    cmd_439 F1 (approved Option A): a split child continues whatever approval
    flow the parent was already subject to, regardless of which role the
    split actor holds. This replaces the old creator-role-filtered lookup
    (_build_approval_create_block_for_entity) for the split path only —
    that function is still used unchanged for x-approval-lines
    (_build_approval_lines_post_create_code), where filtering by the
    creator's role remains correct.

    Caller must define `_parentARFlowIds` (the parent's approval_request
    approval_flow_id list) once, outside the per-part loop, and a
    `childApprovable` var inside it. Caller must import
    notifyApprovalRequestCreated from '@/lib/_notifyApprovalRequest'.
    """
    return (
        f"{indent}for (const _flowId of _parentARFlowIds) {{\n"
        f"{indent}  const _apprReq = await tx.approval_request.create({{\n"
        f"{indent}    data: {{ approvable_id: childApprovable.id, approval_flow_id: _flowId, status: 'Pending' }},\n"
        f"{indent}  }});\n"
        f"{indent}  await notifyApprovalRequestCreated(tx, _apprReq.id, {{ excludeUserId: userId }});\n"
        f"{indent}}}\n"
        f"{indent}if (_parentARFlowIds.length > 0) {{\n"
        f"{indent}  await tx.approvable.update({{\n"
        f"{indent}    where: {{ id: childApprovable.id }},\n"
        f"{indent}    data: {{ creator_id: userId }},\n"
        f"{indent}  }});\n"
        f"{indent}}}"
    )


def _build_approval_lines_post_create_code(parent_def: dict, model: str, schema: dict) -> str:
    """Create approval_request(s) for each pre-created line approvable.

    Mirrors the per-child approval body in
    _build_ledger_reservation_allocation_code (creator-role-filtered
    approval_flow lookup, one approval_request per matching flow, then stamp
    creator_id on the approvable). Used for both the create and update flow —
    the caller passes a different `_{child_var}ApprIds` population for each
    (all lines vs. only newly-added lines).
    """
    props = get_approval_lines_props(parent_def, model, schema)
    if not props:
        return ''
    blocks = []
    for prop_name in props:
        child_var    = safe_var_name(prop_name)
        arr_var      = f'_{child_var}ApprIds'
        lines_entity = _resolve_approval_lines_entity(model, prop_name, schema)
        flows_var    = f'_{child_var}ApprFlows'
        creator_var  = f'_{child_var}Creator'
        role_ids_var = f'_{child_var}CreatorRoleIds'
        inner = _build_approval_create_block_for_entity(
            approvable_id_expr='_apprId',
            actor_id_expr='actorId',
            flows_var=flows_var,
            role_ids_var=role_ids_var,
            tx_var='tx',
            indent='        ',
        )
        blocks.append(
            f"    if ({arr_var}.length > 0) {{\n"
            f"      const {flows_var} = await tx.approval_flow.findMany({{\n"
            f"        where: {{ entity_name: '{lines_entity}' }},\n"
            f"      }});\n"
            f"      const {creator_var} = await tx.user.findUnique({{\n"
            f"        where: {{ id: actorId }},\n"
            f"        select: {{ roles: {{ select: {{ id: true }} }} }},\n"
            f"      }});\n"
            f"      const {role_ids_var} = {creator_var}?.roles.map((r) => r.id) ?? [];\n"
            f"      for (const _apprId of {arr_var}) {{\n"
            f"{inner}\n"
            f"      }}\n"
            f"    }}"
        )
    return '\n'.join(blocks)


def service_context(ctx: dict, schema: dict | None = None) -> dict:
    parent                  = ctx['parent']
    parent_def              = _raw_def(parent, schema) if schema else {}
    model                   = ctx['model']
    parent_pascal           = ctx['parent_pascal']
    can_create              = ctx['can_create']
    can_update              = ctx['can_update']
    can_delete              = ctx['can_delete']
    non_comment_ch          = ctx['non_comment_ch']
    snapshot_field_mappings = ctx['snapshot_field_mappings']
    snapshot_child_mappings = ctx['snapshot_child_mappings']
    snapshot_include_props  = ctx['snapshot_include_props']
    parent_params_with_types = ctx['parent_params_with_types']
    child_params_for_add    = ctx['child_params_for_add']
    child_params_for_update = ctx['child_params_for_update']
    has_assignee_id         = ctx.get('has_assignee_id', False)
    child_assignee_notify_create_code = ctx.get('child_assignee_notify_create_code', '')
    child_assignee_notify_update_code = ctx.get('child_assignee_notify_update_code', '')
    is_audited              = ctx.get('is_audited', False)
    reservation_config      = ctx.get('reservation_config')
    has_reservation         = bool(reservation_config and reservation_config.get('mode') == 'count')
    has_item_reservation    = bool(reservation_config and reservation_config.get('mode') == 'item')
    has_item_daterange      = has_item_reservation and bool(reservation_config.get('dateRange'))

    has_non_comment_ch = bool(non_comment_ch)

    # Flatten non-m2o rel update params and nested update calls
    flatten_rels_raw = ctx.get('flatten_rels', [])
    non_m2o_flatten  = [r for r in flatten_rels_raw if not r['is_m2o']]

    def _flatten_field_ts_type(f: dict) -> str:
        # Arrays of $ref items (e.g., pre_check_detail.symptoms) carry
        # `is_array: True`. The form ships them as a flat list of label
        # strings (e.g., the symptom `name`), which the service then
        # turns into a Prisma nested create — see below.
        if f.get('is_array'):
            return 'string[]'
        ftype = f['prop_type']
        fmt   = f.get('format')
        null  = f.get('nullable', True)
        sfx   = ' | null' if null else ''
        if ftype == 'string' and fmt in ('date', 'date-time', 'time'):
            return f'Date{sfx}'
        if ftype in ('integer', 'number'):
            return f'number{sfx}'
        if ftype == 'boolean':
            return 'boolean'
        return f'string{sfx}'

    def _resolve_flatten_base_model(target: str) -> str:
        """Return the Prisma model name backing a flatten target.

        Flatten $ref targets are always the bare view entity key, which IS
        the Prisma model name directly — the raw entity's '__' prefix is a
        purely internal JSON-schema bookkeeping artifact that never reaches
        schema.prisma. No stripping needed; this used to strip a literal
        `_detail` suffix pre-Stage4 (e.g. `pre_check_detail` -> `pre_check`)
        when the flatten $ref pointed at the view rather than the base —
        that distinction no longer exists now that the view IS the bare key.
        """
        return target

    flatten_update_params_parts: list[str] = []
    flatten_nested_update_lines: list[str] = []
    flatten_nested_create_lines: list[str] = []

    for _flat in non_m2o_flatten:
        _prop    = _flat['prop_name']
        _target_raw = _flat['target']
        _target  = _resolve_flatten_base_model(_target_raw)
        _rel_name = _flat['relation_name']
        _fields  = [f for f in _flat['fields'] if not f.get('is_fk')]
        if not _fields:
            continue
        # Array-of-$ref fields are transformed into Prisma nested-create
        # shape (`symptoms: { create: [{name}, …] }`) rather than spread
        # raw. Pull them out of the scalar bag and emit explicit relations.
        _array_fields = [f for f in _fields if f.get('is_array')]
        _scalar_fields = [f for f in _fields if not f.get('is_array')]
        _var     = to_camel_case(_prop) + 'UpdateData'
        _ts_type = '{ ' + '; '.join(
            f"{f['name']}: {_flatten_field_ts_type(f)}" for f in _fields
        ) + ' }'
        flatten_update_params_parts.append(f"{_var}: {_ts_type} | null")
        # FK pointing back to parent: {parent_model}_id
        _fk_field = f'{model}_id'
        # Whether the FK back to parent is optional on the target side. When it's
        # optional, "remove" means unlink (set to null and keep the row); when
        # it's required, "remove" means delete. The inline-create path is the
        # same in both cases.
        _target_def = _raw_def(_target, schema) if schema else {}
        _target_props = _target_def.get('properties', {})
        _fk_prop = _target_props.get(_fk_field, {})
        _fk_type = _fk_prop.get('type')
        _parent_fk_optional_on_target = isinstance(_fk_type, list) and 'null' in _fk_type

        # External required FKs that the form does NOT collect — must be
        # derived from the parent's own data (e.g. lifestyle.patient_id is
        # derived from checkup.patient_rel.patient_id). When a derivation path
        # exists, generate the lookup; otherwise fall back to update-only and
        # leave a TODO so the schema author can supply a path.
        _external_req_fks = [
            f for f in _flat['fields']
            if f.get('is_fk') and not f.get('nullable', True) and f.get('fk_target') != parent
        ]

        _derivation_decls: list[str] = []  # `const xId = …` lines
        _create_extras: list[str] = []     # extra `field: xId,` entries spread into create.data
        _derivation_failed = False
        for _fk in _external_req_fks:
            _fk_name = _fk['name']                          # e.g. 'patient_id'
            _fk_target_q = _fk['fk_target']                 # e.g. 'patient'
            _path = find_fk_derivation_path(parent, parent_def, _fk_target_q, schema or {}) if schema else None
            if _path is None:
                _derivation_failed = True
                break
            _local_var = to_camel_case(_target) + to_pascal_case(_fk_name)  # e.g. 'lifestylePatientId'
            if _path['kind'] == 'direct':
                # Parent already has its own FK to this entity — use it.
                _parent_fk_param = to_camel_case(_path['parent_fk'])
                _derivation_decls.append(f"      const {_local_var} = {_parent_fk_param};")
            else:
                # one_hop: query the intermediate table to fetch the FK.
                _parent_fk_param = to_camel_case(_path['parent_fk'])
                _intermediate = _path['intermediate']
                _intermediate_fk = _path['intermediate_fk']
                _row_var = to_camel_case(_target) + to_pascal_case(_intermediate) + 'Row'
                _derivation_decls.append(
                    f"      const {_row_var} = await tx.{_intermediate}.findUnique({{\n"
                    f"        where: {{ id: {_parent_fk_param} }},\n"
                    f"        select: {{ {_intermediate_fk}: true }},\n"
                    f"      }});\n"
                    f"      if (!{_row_var}) throw new Error('{_intermediate} not found while deriving {_target}.{_fk_name}');\n"
                    f"      const {_local_var} = {_row_var}.{_intermediate_fk};"
                )
            _create_extras.append(f"{_fk_name}: {_local_var}, ")

        if _derivation_failed:
            # Schema doesn't expose a path to the external FK — keep the old
            # update-only behaviour so we don't break generation. This branch
            # is hit when the flatten target's required FK target isn't
            # reachable from the parent within two FK hops.
            _create_extras_str = ''
            _has_create_block = False
            flatten_nested_update_lines.append(
                f"    if ({_var}) {{\n"
                f"      await tx.{_target}.updateMany({{\n"
                f"        where: {{ {_fk_field}: id }},\n"
                f"        data: {_var},\n"
                f"      }});\n"
                f"    }} else {{\n"
                f"      // TODO: external required FK on {_target} has no derivable path from {parent}\n"
                f"      await tx.{_target}.updateMany({{\n"
                f"        where: {{ {_fk_field}: id }},\n"
                f"        data: {{ {_fk_field}: null }},\n"
                f"      }});\n"
                f"    }}"
            )
            continue

        _create_extras_str = ''.join(_create_extras)
        # On remove (`null` UpdateData): if the target's parent FK is optional,
        # keep the row and unlink (set FK to null); otherwise delete the row.
        if _parent_fk_optional_on_target:
            _on_null_update = (
                f"      await tx.{_target}.updateMany({{\n"
                f"        where: {{ {_fk_field}: id }},\n"
                f"        data: {{ {_fk_field}: null }},\n"
                f"      }});"
            )
        else:
            _on_null_update = (
                f"      await tx.{_target}.deleteMany({{ where: {{ {_fk_field}: id }} }});"
            )

        # Compose the data object spread into Prisma create/update.
        # If there are array-of-$ref fields (e.g., pre_check.symptoms),
        # they must be peeled off before the spread — Prisma's nested
        # write expects { create: [{name}, …] } shape, not a raw string[]
        # — and re-attached as an explicit relation block. For the update
        # branch of upsert, the array fields can't be set inline; we
        # follow the upsert with a delete-and-recreate step against the
        # item entity.
        if _array_fields:
            _array_destructure_keys = ', '.join(
                f"{f['name']}: {to_camel_case(_prop)}{to_pascal_case(f['name'])}"
                for f in _array_fields
            )
            _scalars_var = f"{to_camel_case(_prop)}Scalars"
            _array_destructure = (
                f"      const {{ {_array_destructure_keys}, ...{_scalars_var} }} = {_var};"
            )
            _array_relation_create_parts: list[str] = []
            for _af in _array_fields:
                _af_name = _af['name']
                _af_var  = f"{to_camel_case(_prop)}{to_pascal_case(_af_name)}"
                _item_target = _af.get('item_target', '')
                _item_props  = _raw_def(_item_target, schema).get('properties', {}) if schema else {}
                _item_label  = 'name' if 'name' in _item_props else 'id'
                _array_relation_create_parts.append(
                    f"...({_af_var}.length > 0 ? {{ {_af_name}: {{ create: {_af_var}.map((v: string) => ({{ {_item_label}: v }})) }} }} : {{}})"
                )
            _array_relation_create_str = ', '.join(_array_relation_create_parts)
            _create_data_body = (
                f"{{ {_fk_field}: created.id, {_create_extras_str}creator_id: userId, updater_id: userId, ...{_scalars_var}, {_array_relation_create_str} }}"
            )
            _upsert_create_body = (
                f"{{ {_fk_field}: id, {_create_extras_str}creator_id: userId, updater_id: userId, ...{_scalars_var}, {_array_relation_create_str} }}"
            )
            _upsert_update_body = _scalars_var
            # After the upsert, replace the array items (delete-all + create-all).
            _array_post_upsert: list[str] = []
            for _af in _array_fields:
                _af_name = _af['name']
                _af_var  = f"{to_camel_case(_prop)}{to_pascal_case(_af_name)}"
                _item_target = _af.get('item_target', '')
                _item_props  = _raw_def(_item_target, schema).get('properties', {}) if schema else {}
                _item_label  = 'name' if 'name' in _item_props else 'id'
                _row_var = f"{to_camel_case(_target)}Row"
                _array_post_upsert.append(
                    f"      const {_row_var} = await tx.{_target}.findUnique({{ where: {{ {_fk_field}: id }}, select: {{ id: true }} }});\n"
                    f"      if ({_row_var}) {{\n"
                    f"        await tx.{_item_target}.deleteMany({{ where: {{ {_fk_field.replace(model, _target)}: {_row_var}.id }} }});\n"
                    f"        if ({_af_var}.length > 0) {{\n"
                    f"          await tx.{_item_target}.createMany({{ data: {_af_var}.map((v: string) => ({{ {_item_label}: v, {_target}_id: {_row_var}.id }})) }});\n"
                    f"        }}\n"
                    f"      }}"
                )
            _array_post_upsert_str = '\n'.join(_array_post_upsert)
            flatten_nested_update_lines.append(
                f"    if ({_var}) {{\n"
                + (f"{chr(10).join(_derivation_decls)}\n" if _derivation_decls else "")
                + f"{_array_destructure}\n"
                + f"      await tx.{_target}.upsert({{\n"
                f"        where: {{ {_fk_field}: id }},\n"
                f"        create: {_upsert_create_body},\n"
                f"        update: {_upsert_update_body},\n"
                f"      }});\n"
                + f"{_array_post_upsert_str}\n"
                + f"    }} else {{\n"
                f"{_on_null_update}\n"
                f"    }}"
            )
            flatten_nested_create_lines.append(
                f"    if ({_var}) {{\n"
                + (f"{chr(10).join(_derivation_decls)}\n" if _derivation_decls else "")
                + f"{_array_destructure}\n"
                + f"      await tx.{_target}.create({{\n"
                f"        data: {_create_data_body},\n"
                f"      }});\n"
                f"    }}"
            )
        else:
            # No array fields — original spread suffices.
            flatten_nested_update_lines.append(
                f"    if ({_var}) {{\n"
                + (f"{chr(10).join(_derivation_decls)}\n" if _derivation_decls else "")
                + f"      await tx.{_target}.upsert({{\n"
                f"        where: {{ {_fk_field}: id }},\n"
                f"        create: {{ {_fk_field}: id, {_create_extras_str}creator_id: userId, updater_id: userId, ...{_var} }},\n"
                f"        update: {_var},\n"
                f"      }});\n"
                f"    }} else {{\n"
                f"{_on_null_update}\n"
                f"    }}"
            )
            flatten_nested_create_lines.append(
                f"    if ({_var}) {{\n"
                + (f"{chr(10).join(_derivation_decls)}\n" if _derivation_decls else "")
                + f"      await tx.{_target}.create({{\n"
                f"        data: {{ {_fk_field}: created.id, {_create_extras_str}creator_id: userId, updater_id: userId, ...{_var} }},\n"
                f"      }});\n"
                f"    }}"
            )

    flatten_update_params = ', '.join(flatten_update_params_parts)
    flatten_nested_updates = '\n'.join(flatten_nested_update_lines)
    flatten_nested_creates = '\n'.join(flatten_nested_create_lines)

    # Reservation count mode: build allocation code block
    reservation_allocation_code = ''
    if has_reservation and reservation_config is not None:
        reservation_allocation_code = _build_reservation_allocation_code(reservation_config, model, schema)

    # Action functions (ship / release / cancel)
    reservation_actions_code = ''
    if has_reservation and reservation_config is not None and reservation_config.get('has_actions'):
        reservation_actions_code = _build_reservation_action_functions(reservation_config, model, schema)

    # x-approval-lines: pre-create/post-create approval for embedded line
    # children that are new:false (see docs/receiving-approval-backfill-design.md).
    approval_lines_pre_create_code  = ''
    approval_lines_post_create_code = ''
    approval_lines_pre_update_code  = ''
    approval_lines_post_update_code = ''
    if get_approval_lines_props(parent_def, model, schema):
        approval_lines_pre_create_code  = _build_approval_lines_pre_create_code(parent_def, model, schema, mode='create')
        approval_lines_post_create_code = _build_approval_lines_post_create_code(parent_def, model, schema)
        if can_update:
            approval_lines_pre_update_code  = _build_approval_lines_pre_create_code(parent_def, model, schema, mode='update')
            approval_lines_post_update_code = _build_approval_lines_post_create_code(parent_def, model, schema)

    _insufficient_inventory_error_class_def = (
        "\n\nexport class InsufficientPoolCapacityError extends Error {\n"
        "  constructor(message: string) {\n"
        "    super(message);\n"
        "    this.name = 'InsufficientPoolCapacityError';\n"
        "  }\n"
        "}"
    )
    _reservation_mutation_error_class_def = (
        "\n\nexport class ReservationMutationError extends Error {\n"
        "  constructor(message: string) {\n"
        "    super(message);\n"
        "    this.name = 'ReservationMutationError';\n"
        "  }\n"
        "}"
    )
    if has_reservation:
        insufficient_inventory_error_class = (
            _insufficient_inventory_error_class_def + _reservation_mutation_error_class_def
        )
    elif has_item_reservation:
        insufficient_inventory_error_class = _insufficient_inventory_error_class_def
    else:
        insufficient_inventory_error_class = ''

    reservation_mutation_guard_update = ''
    reservation_mutation_guard_delete = ''
    if has_reservation and reservation_config is not None:
        reservation_mutation_guard_update = _build_reservation_mutation_guard_update(reservation_config, model)
        reservation_mutation_guard_delete = _build_reservation_mutation_guard_delete(reservation_config, model)

    # item mode: assertNoDuplicateReservation added to service_validation import when dateRange present
    _validation_extras = ''
    if has_item_daterange:
        _validation_extras = ', assertNoDuplicateReservation'
    _pool_entity_pick = (
        f" | '{reservation_config['pool']['entity']}'" if has_item_reservation and reservation_config else ''
    )

    utility_code = (
        f"import prisma from '@/lib/prisma';\n"
        + (f"import {{ Prisma }} from '@/app/generated/prisma/client';\n" if has_item_reservation else '')
        + f"import {{ normalizeValue,{' normalizeChildRefs,' if has_non_comment_ch else ''}"
        f"{' assertNotStale,' if can_update else ''} type NormalizedSnapshot }} from '@/lib/normalize';"
        + (f"\nimport {{ validateOnAdd, validateOnUpdate{_validation_extras} }} from './service_validation';" if (can_create or can_update) else '')
        + (f"\nimport {{ assertNoDuplicateReservation }} from './service_validation';" if has_item_daterange and not (can_create or can_update) else '')
        + (f"\nimport {{ afterCreate }} from './service_after_create';" if can_create else '')
        + (f"\nimport {{ notify }} from '@/lib/_notifier';"
           if has_assignee_id or child_assignee_notify_create_code or child_assignee_notify_update_code else '')
        + (f"\nimport {{ notifyApprovalRequestCreated }} from '@/lib/_notifyApprovalRequest';"
           if approval_lines_post_create_code or approval_lines_post_update_code else '')
        + (f"\nimport {{ recordAuditEvent }} from '@/lib/audit-log';" if is_audited else '')
        + insufficient_inventory_error_class +
        f"\n\ntype TransactionClient = Pick<typeof prisma, '{model}'{_pool_entity_pick}>;\n\n"
        f"function normalizeSnapshot(snapshot: Record<string, unknown> | null | undefined): NormalizedSnapshot {{\n"
        f"  const safeSnapshot = (snapshot ?? {{}}) as Record<string, unknown>;\n"
        f"  return {{\n"
        f"    id: String(safeSnapshot.id ?? ''),\n"
        f"{snapshot_field_mappings}"
        + (f"\n{snapshot_child_mappings}" if snapshot_child_mappings else '') +
        f"\n  }};\n}}\n\n"
        f"async function getCurrentSnapshot(tx: TransactionClient, id: string): Promise<NormalizedSnapshot | null> {{\n"
        f"  const current = await tx.{model}.findUnique({{\n"
        f"    where: {{ id }}{snapshot_include_props}\n"
        f"  }});\n\n"
        f"  if (!current) {{\n"
        f"    return null;\n"
        f"  }}\n\n"
        f"  return normalizeSnapshot(current as Record<string, unknown>);\n"
        f"}}"
    )

    return {
        'utility_code':                       utility_code,
        'child_params_for_add':               child_params_for_add,
        'child_params_for_update':            child_params_for_update,
        'flatten_update_params':              flatten_update_params,
        'flatten_nested_updates':             flatten_nested_updates,
        'flatten_nested_creates':             flatten_nested_creates,
        'reservation_allocation_code':        reservation_allocation_code,
        'reservation_actions_code':           reservation_actions_code,
        'has_reservation':                    has_reservation,
        'has_item_reservation':               has_item_reservation,
        'reservation_mutation_guard_update':  reservation_mutation_guard_update,
        'reservation_mutation_guard_delete':  reservation_mutation_guard_delete,
        'approval_lines_pre_create_code':     approval_lines_pre_create_code,
        'approval_lines_post_create_code':    approval_lines_post_create_code,
        'approval_lines_pre_update_code':     approval_lines_pre_update_code,
        'approval_lines_post_update_code':    approval_lines_post_update_code,
    }


# ---------------------------------------------------------------------------
# column_def.tsx
# ---------------------------------------------------------------------------

def column_def_context(ctx: dict, schema: dict) -> dict:
    model            = ctx['model']
    non_comment_ch   = ctx['non_comment_ch']
    parent_rels_raw  = ctx['parent_rels_raw']

    needs_datetime_imports = False
    needs_entity_autocomplete_cell = False
    uses_format_label_value = False
    column_children = []

    for child_raw in non_comment_ch:
        child_name = child_raw['name']
        prop_name  = child_raw['property_name']
        child_def  = _raw_def(child_name, schema)
        child_props = child_def.get('properties', {})

        if not child_props:
            column_children.append({
                'fn_code': (
                    f"export function use{to_pascal_case(prop_name)}Columns(editable: boolean = false): GridColDef[] {{\n"
                    f"  const t = useTranslations('Fields');\n"
                    f"  return [];\n"
                    f"}}"
                )
            })
            continue

        rel_params = []
        for key, prop in child_props.items():
            if key == f'{model}_id':
                continue
            rel = prop.get('x-relationship', {})
            if rel.get('type') == 'many-to-one':
                param_camel = to_camel_case(key)
                rel_params.append(f"{param_camel}Config?: EntityAutocompleteCellConfig")

        columns = []
        col_ns_hooks: list[str] = []
        col_seen_ns: set[str] = set()
        for key, prop in child_props.items():
            if key in ('id', f'{model}_id', 'created_at', 'updated_at', 'creator_id'):
                continue

            rel = prop.get('x-relationship', {})
            # Internal bridge FKs are implementation details, never shown as a
            # plain column: one-to-one_bridge relations (e.g. approvable_id)
            # and unrelated *able_id technical FKs (e.g.
            # inventory_transactionable_id) — mirrors the form-body exclusion
            # in build_context.py's _child_bridge_excludes.
            if rel.get('type') == 'one-to-one_bridge':
                continue
            if not rel and key.endswith('able_id'):
                continue
            if rel.get('type') == 'many-to-one':
                needs_entity_autocomplete_cell = True
                label_base   = key.removesuffix('_id')
                header_camel = to_camel_case(label_base)
                prop_camel   = to_camel_case(key)
                param_name   = f'{prop_camel}Config'
                label_field  = rel.get('labelField', 'name')
                # label_field may be a single field name or a composite path list
                # (e.g. ['product.name', 'location', 'lot_number']) — always go
                # through build_label_expression rather than raw `row.{label_base}.
                # {label_field}` property access, which breaks on composite/array
                # labelField.
                label_built = build_label_expression(f'row.{label_base}', label_field, rel.get('target'), schema)
                if label_built['has_format']:
                    uses_format_label_value = True
                # When the config is provided, pick uses EntityAutocomplete (any object selectable
                # via server-side search). When it's missing, the column is read-only with the
                # included relation's label.
                columns.append(
                    f"    ...({param_name}\n"
                    f"      ? [{{ field: '{key}', headerName: t('{header_camel}'), width: 200, editable: editable,\n"
                    f"          renderEditCell: (params: GridRenderEditCellParams) => (\n"
                    f"            <EntityAutocompleteCellEditor {{...params}} config={{{param_name}}} />\n"
                    f"          ),\n"
                    f"          valueFormatter: entityAutocompleteValueFormatter({param_name}) }}]\n"
                    f"      // eslint-disable-next-line @typescript-eslint/no-explicit-any\n"
                    f"      : [{{ field: '{key}', headerName: t('{header_camel}'), width: 200, editable: false, valueGetter: (_value: any, row: any) => {label_built['expression']} }}]),"
                )
                continue

            header_camel = to_camel_case(key)
            actual = _get_actual_type(prop)
            fmt    = prop.get('format')
            width  = 150

            if key == 'order':
                columns.append(f"    {{ field: '{key}', headerName: t('{key}'), width: 50, editable: false, type: 'number' }},")
                continue

            prop_type_raw = prop.get('type')
            is_bool = (prop_type_raw == 'boolean' or (isinstance(prop_type_raw, list) and 'boolean' in prop_type_raw))
            is_int  = (prop_type_raw == 'integer' or (isinstance(prop_type_raw, list) and 'integer' in prop_type_raw))
            enum_vals = prop.get('enum')

            if is_bool:
                columns.append(f"    {{ field: '{key}', headerName: t('{header_camel}'), width: 100, editable: editable, type: 'boolean' }},")
            elif is_int and isinstance(enum_vals, list):
                is_nullable = isinstance(prop_type_raw, list) and 'null' in prop_type_raw
                opts = ', '.join(_int_enum_option(v, i) for i, v in enumerate(enum_vals))
                null_opt = "{ value: '' as const, label: '-- None --' }"
                value_opts = f'{null_opt}, {opts}' if is_nullable else opts
                extra = ''
                if is_nullable:
                    extra = (
                        f",\n      // eslint-disable-next-line @typescript-eslint/no-explicit-any\n"
                        f"      valueGetter: (value: any) => value ?? '',\n"
                        f"      // eslint-disable-next-line @typescript-eslint/no-explicit-any\n"
                        f"      valueSetter: (value: any, row: any) => ({{ ...row, {key}: value === '' ? null : value }})"
                    )
                columns.append(f"    {{ field: '{key}', headerName: t('{header_camel}'), width: 150, editable: editable, type: 'singleSelect' as const, valueOptions: [{value_opts}]{extra} }},")
            elif is_int:
                columns.append(f"    {{ field: '{key}', headerName: t('{header_camel}'), width: 100, editable: editable, type: 'number' }},")
            elif actual == 'string' and fmt in ('date', 'date-time', 'time'):
                needs_datetime_imports = True
                show_date_str = "\n      show_date={false}" if fmt == 'time' else ''
                columns.append(
                    f"    {{\n"
                    f"      field: '{key}',\n"
                    f"      headerName: t('{header_camel}'),\n"
                    f"      width: 250,\n"
                    f"      editable: editable,\n"
                    f"      type: 'dateTime',\n"
                    f"      valueFormatter: (value) => {{\n"
                    f"        if (!value) return '';\n"
                    f"        return dayjs(value).format('YYYY-MM-DD HH:mm');\n"
                    f"      }},\n"
                    f"    }},"
                )
            elif actual == 'string' and isinstance(enum_vals, list) and _native_enum_ns(prop):
                native_ns = _native_enum_ns(prop)
                is_nullable = isinstance(prop_type_raw, list) and 'null' in prop_type_raw
                if native_ns not in col_seen_ns:
                    col_seen_ns.add(native_ns)
                    col_ns_hooks.append(f"  const t{native_ns} = useTranslations('{native_ns}');")
                opts = ', '.join(
                    f"{{ value: '{v}', label: t{native_ns}('{_native_enum_key(v)}') }}"
                    for v in enum_vals
                )
                null_opt = "{ value: '' as const, label: '-- None --' }"
                value_opts = f'{null_opt}, {opts}' if is_nullable else opts
                extra = ''
                if is_nullable:
                    extra = (
                        f",\n      // eslint-disable-next-line @typescript-eslint/no-explicit-any\n"
                        f"      valueGetter: (value: any) => value ?? '',\n"
                        f"      // eslint-disable-next-line @typescript-eslint/no-explicit-any\n"
                        f"      valueSetter: (value: any, row: any) => ({{ ...row, {key}: value === '' ? null : value }})"
                    )
                columns.append(f"    {{ field: '{key}', headerName: t('{header_camel}'), width: 150, editable: editable, type: 'singleSelect' as const, valueOptions: [{value_opts}]{extra} }},")
            else:
                columns.append(f"    {{ field: '{key}', headerName: t('{header_camel}'), width: {width}, editable: editable }},")

        rel_params_str = (', ' + ', '.join(rel_params)) if rel_params else ''
        _col_ns_hooks_str = ('\n' + '\n'.join(col_ns_hooks)) if col_ns_hooks else ''
        fn_code = (
            f"export function use{to_pascal_case(prop_name)}Columns(editable: boolean = false{rel_params_str}): GridColDef[] {{\n"
            f"  const t = useTranslations('Fields');{_col_ns_hooks_str}\n"
            f"  return [\n"
            + '\n'.join(columns) +
            f"\n  ];\n"
            f"}}"
        )
        column_children.append({'fn_code': fn_code})

    return {
        'column_children': column_children,
        'needs_datetime_imports': needs_datetime_imports,
        'needs_entity_autocomplete_cell': needs_entity_autocomplete_cell,
        'uses_format_label_value': uses_format_label_value,
    }


# ---------------------------------------------------------------------------
# form_view.tsx
# ---------------------------------------------------------------------------

def form_view_context(ctx: dict, schema: dict | None = None) -> dict:
    parent        = ctx['parent']
    model         = ctx['model']
    parent_pascal = ctx['parent_pascal']
    parent_camel  = ctx['parent_camel']
    filtered_props = ctx['filtered_props']
    model_def     = ctx['model_def']
    parent_rels   = ctx['parent_rels']
    children_raw  = ctx['children_raw']
    use_dayjs     = False
    # Set when any read-only TextField value uses formatLabelValue — the
    # generated FormView must then import it.
    uses_format_label_value = False

    rel_by_prop = {r['prop_name']: r for r in ctx['parent_rels_raw']}
    # Add selector OTO rels to rel_by_prop so they display like many-to-one (label + view link)
    for _oto_r in ctx.get('selector_oto_rels', []):
        rel_by_prop[_oto_r['prop_name']] = {
            'prop_name': _oto_r['prop_name'],
            'label_field': _oto_r['label_field'],
            'label_field_is_date': _oto_r.get('label_field_is_date', False),
            'relation_name': _oto_r['relation_name'],
            'target': _oto_r['target'],
            'is_selector_oto': True,  # FK prop not in src type; use relation?.id for linking
        }
    one_to_one_fk_props = {r['prop_name'] for r in ctx.get('one_to_one_rels', [])}
    flatten_rels_raw = ctx.get('flatten_rels', [])
    flatten_m2o_fk_props = ctx.get('flatten_m2o_fk_props', set())
    # Unrelated *able_id technical FKs with no x-relationship (e.g.
    # inventory_transactionable_id) are system-managed internal bridge FKs —
    # mirrors the same exclusion in column_def_context.
    bridge_fk_no_rel_props = {
        k for k in filtered_props
        if k.endswith('able_id') and not filtered_props[k].get('x-relationship')
    }
    # m2o flatten FK props are rendered as accordion sections, not plain FK TextFields
    EXCLUDE = (
        {'id', 'created_at', 'updated_at', 'creator_id'}
        | one_to_one_fk_props | flatten_m2o_fk_props | bridge_fk_no_rel_props
    )
    parent_props = [k for k in filtered_props if k not in EXCLUDE]

    custom_view_props = [
        p for p in parent_props
        if (isinstance((filtered_props[p].get('x-custom-component') or {}), dict) and
            'view' in ((filtered_props[p].get('x-custom-component') or {}).get('target') or []))
    ]

    date_time_flds     = []
    image_flds         = []
    boolean_flds       = []
    enum_integer_flds  = []
    enum_native_flds   = []
    other_flds         = []

    for p in parent_props:
        if p in custom_view_props:
            continue
        prop   = filtered_props[p]
        actual = _get_actual_type(prop)
        fmt    = prop.get('format')
        if actual == 'string' and fmt in ('date', 'date-time', 'time'):
            date_time_flds.append(p)
        elif actual == 'string' and fmt == 'uri':
            image_flds.append(p)
        elif actual == 'boolean':
            boolean_flds.append(p)
        elif actual in ('integer', 'number') and isinstance(prop.get('enum'), list):
            enum_integer_flds.append(p)
        elif _native_enum_ns(prop) and isinstance(prop.get('enum'), list):
            enum_native_flds.append(p)
        else:
            other_flds.append(p)

    needs_datetime_wrapper = bool(date_time_flds)
    needs_image_display    = bool(image_flds)

    def _tf(p: str):
        return to_camel_case(p)

    # Text fields (incl. relationship display)
    entity_select_props_view = {
        p for p in other_flds
        if filtered_props.get(p, {}).get('x-entity-select')
    }
    entity_select_options = ctx.get('entity_select_options', [])
    text_jsxs = []
    for p in other_flds:
        fk = _tf(p)
        rel = rel_by_prop.get(p)
        if p in entity_select_props_view:
            opts_var = f'{safe_var_name(p)}Options'
            opts_items = ', '.join(
                f"{{ value: '{o['value']}', label: '{o['label']}' }}"
                for o in entity_select_options
            )
            text_jsxs.append(
                f"      <AppFieldText\n        label={{tf('{fk}')}}\n"
                f"        value={{[{opts_items}].find((o) => o.value === src.{p})?.label ?? src.{p} ?? ''}}\n"
                f"        readOnly\n      />"
            )
        elif rel:
            label_f       = rel.get('label_field', 'name')
            label_fk      = fk.removesuffix('Id')
            rel_name      = rel.get('relation_name', p.removesuffix('_id'))
            target        = rel.get('target', p.removesuffix('_id'))
            target_pascal = to_pascal_case(target)
            is_oto        = rel.get('is_selector_oto', False)
            # For selector OTO, the FK prop is excluded from src type; use relation?.id instead
            fk_id_expr    = f"src.{rel_name}?.id" if is_oto else f"src.{p}"
            built = build_label_expression(f"src.{rel_name}", label_f, target, schema or {})
            if built['has_format']:
                uses_format_label_value = True
            rel_value_expr = built['expression']
            # For non-selector m2o, allow falling back to the raw FK value when
            # the relation row failed to include — preserves the historical
            # behaviour where empty labels still show *something* identifying.
            if is_oto:
                value_expr = rel_value_expr
            else:
                value_expr = f"({rel_value_expr}) || src.{p} || ''"
            text_jsxs.append(
                f"      <AppFieldRelation\n"
                f"        label={{tf('{label_fk}')}}\n"
                f"        value={{{value_expr}}}\n"
                f"        href={{{fk_id_expr} ? `/{target}/view/${{{fk_id_expr}}}` : null}}\n"
                f"        readOnly\n"
                f"      />"
            )
        else:
            fallback_actual = _get_actual_type(filtered_props.get(p, {}))
            fallback_op = '??' if fallback_actual in ('integer', 'number') else '||'
            text_jsxs.append(
                f"      <AppFieldText\n        label={{tf('{fk}')}}\n"
                f"        value={{src.{p} {fallback_op} ''}}\n"
                f"        readOnly\n      />"
            )

    # DateTime fields
    dt_jsxs = []
    for p in date_time_flds:
        fk  = _tf(p)
        fmt = filtered_props[p].get('format')
        show_time_attr = '' if fmt in ('date-time', 'time') else ' show_time={false}'
        show_date_attr = ' show_date={false}' if fmt == 'time' else ''
        if fmt == 'date':
            use_dayjs = True
            # Convert UTC midnight ISO string to local midnight Date so dayjs() shows the
            # correct calendar date in all timezones. 'T00:00:00' without tz suffix = local.
            date_time_expr = f"{{src.{p} ? dayjs(new Date(src.{p}).toISOString().slice(0, 10) + 'T00:00:00').toDate() : null}}"
        else:
            date_time_expr = f"{{src.{p}}}"
        dt_jsxs.append(
            f"      <DateTimeWrapper label={{tf('{fk}')}} date_time={date_time_expr}{show_time_attr}{show_date_attr} readOnly />"
        )

    # Image fields
    img_jsxs = [f"      <ImageDisplay url={{src.{p}}} alt={{tf('{_tf(p)}')}} />" for p in image_flds]

    # Boolean fields
    bool_jsxs = [
        f"      <AppFieldBoolean\n        label={{tf('{_tf(p)}')}}\n        checked={{Boolean(src.{p})}}\n        readOnly\n      />"
        for p in boolean_flds
    ]

    # Enum integer fields
    enum_ns_hooks  = []
    enum_opt_setups = []
    enum_int_jsxs  = []
    seen_ns = set()
    for p in enum_integer_flds:
        prop       = filtered_props[p]
        state_name = safe_var_name(p)
        enum_vals  = prop.get('enum', [])
        ns         = prop.get('x-enum-namespace')
        if ns and ns not in seen_ns:
            seen_ns.add(ns)
            enum_ns_hooks.append(f"  const t{ns} = useTranslations('{ns}');")
        if ns:
            opts = ', '.join(
                (f"{{ value: {(v if isinstance(v, (int, float)) else (i if not str(v).lstrip('-').isdigit() else int(v)))}, "
                 f"label: t{ns}('{(v.lower()[0]+v[1:] if isinstance(v,str) and not str(v).lstrip('-').isdigit() else str(v))}') }}")
                for i, v in enumerate(enum_vals)
            )
        else:
            opts = ', '.join(_int_enum_option(v, i) for i, v in enumerate(enum_vals))
        enum_opt_setups.append(f"  const {state_name}Options = [{opts}];")
        fk = _tf(p)
        enum_int_jsxs.append(
            f"      <AppFieldText\n        label={{tf('{fk}')}}\n"
            f"        value={{{state_name}Options.find(o => o.value === src.{p})?.label ?? ''}}\n"
            f"        readOnly\n      />"
        )

    # Enum nativeEnum fields (string-backed Prisma enum, always translated)
    enum_native_jsxs = []
    for p in enum_native_flds:
        prop       = filtered_props[p]
        state_name = safe_var_name(p)
        enum_vals  = prop.get('enum', [])
        ns         = _native_enum_ns(prop)
        if ns not in seen_ns:
            seen_ns.add(ns)
            enum_ns_hooks.append(f"  const t{ns} = useTranslations('{ns}');")
        opts = ', '.join(
            f"{{ value: '{v}', label: t{ns}('{_native_enum_key(v)}') }}"
            for v in enum_vals
        )
        enum_opt_setups.append(f"  const {state_name}Options = [{opts}];")
        fk = _tf(p)
        enum_native_jsxs.append(
            f"      <AppFieldText\n        label={{tf('{fk}')}}\n"
            f"        value={{{state_name}Options.find(o => o.value === src.{p})?.label ?? ''}}\n"
            f"        readOnly\n      />"
        )

    # Custom view fields
    custom_jsxs = [
        f"      <{to_pascal_case(p)} value={{src.{safe_var_name(p)}}} />"
        for p in custom_view_props
    ]
    custom_view_imports = '\n'.join(
        f"import {to_pascal_case(p)} from './{p}';" for p in custom_view_props
    )

    all_parent_fields = '\n'.join(filter(None, [
        '\n'.join(text_jsxs),
        '\n'.join(enum_int_jsxs),
        '\n'.join(enum_native_jsxs),
        '\n'.join(bool_jsxs),
        '\n'.join(dt_jsxs),
        '\n'.join(img_jsxs),
        '\n'.join(custom_jsxs),
    ]))

    # Reverse OTO rels (FK in target): display as labeled fields with view links
    reverse_oto_rels = ctx.get('reverse_oto_rels', [])
    reverse_oto_jsxs = []
    for r in reverse_oto_rels:
        prop       = r['prop_name']
        target     = r['target']
        label_f    = r['label_field']
        label_fk   = to_camel_case(prop)
        target_pascal = to_pascal_case(target)
        value_expr = f"src.{prop}?.{label_f}?.toString() || ''"
        fk_id_expr = f"src.{prop}?.id"
        reverse_oto_jsxs.append(
            f"      <AppFieldRelation\n"
            f"        label={{tf('{label_fk}')}}\n"
            f"        value={{{value_expr}}}\n"
            f"        href={{{fk_id_expr} ? `/{target}/view/${{{fk_id_expr}}}` : null}}\n"
            f"        readOnly\n"
            f"      />"
        )
    reverse_oto_fields = '\n'.join(reverse_oto_jsxs)

    # Flatten accordion sections
    flatten_enum_opt_setups: list[str] = []
    flatten_sections_list: list[str] = []
    has_accordion_rel_links = False
    has_flatten_array = False

    for _fr in flatten_rels_raw:
        _prop = _fr['prop_name']
        _prop_camel = to_camel_case(_prop)
        _inner: list[str] = []

        for _field in _fr['fields']:
            _fname = _field['name']
            _fcamel = to_camel_case(_fname)

            if _field.get('is_array'):
                # Render the array as a read-only ListWrapper, matching how
                # the standalone _detail page of the target entity shows
                # its own children. The data path is `src.{prop}.{field}`
                # (e.g., `src.pre_check.symptoms`) — the parent's getter
                # already fetches it through the *_detail $ref include
                # chain. `as any` cast: the parent's static type may not
                # carry the nested array shape (it's typed as the bare
                # target's properties, not the _detail's extension).
                _item_target = _field.get('item_target', '')
                _item_props  = _raw_def(_item_target, schema).get('properties', {})
                _item_label  = 'name' if 'name' in _item_props else 'id'
                has_flatten_array = True
                _inner.append(
                    f"        <div>\n"
                    f"          {{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}}\n"
                    f"          <ListWrapper\n"
                    f"            items={{((src.{_prop} as any)?.{_fname} ?? []).map((f: any) => ({{\n"
                    f"              id: f.id,\n"
                    f"              value: (f.{_item_label} ?? ''),\n"
                    f"              label: (f.{_item_label} ?? ''),\n"
                    f"            }}))}}\n"
                    f"            itemType=\"text\"\n"
                    f"            showTitle={{true}}\n"
                    f"            title={{tf('{_fcamel}')}}\n"
                    f"          />\n"
                    f"        </div>"
                )
                continue

            if _field.get('is_fk'):
                has_accordion_rel_links = True
                _rel_name = _field['relation_name']
                _rel_camel = to_camel_case(_rel_name)
                _fk_target = _field['fk_target']
                _fk_target_pascal = to_pascal_case(_fk_target)
                _fk_label = _field['fk_label_field']
                # Use 'as any' to bypass TypeScript since the nested FK may not be in the base type
                _id_expr = f"(src.{_prop} as any)?.{_rel_name}?.id"
                _val_expr = f"(src.{_prop} as any)?.{_rel_name}?.{_fk_label}?.toString() || ''"
                _inner.append(
                    f"        {{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}}\n"
                    f"        <AppFieldRelation\n"
                    f"          label={{tf('{_rel_camel}')}}\n"
                    f"          value={{{_val_expr}}}\n"
                    f"          href={{{_id_expr} ? `/{_fk_target}/view/${{{_id_expr}}}` : null}}\n"
                    f"          readOnly\n"
                    f"        />"
                )
            elif _field.get('format') in ('date', 'date-time', 'time'):
                _fmt = _field.get('format')
                needs_datetime_wrapper = True
                _show_time = '' if _fmt in ('date-time', 'time') else ' show_time={false}'
                _show_date = ' show_date={false}' if _fmt == 'time' else ''
                if _fmt == 'date':
                    use_dayjs = True
                    _date_expr = f"{{src.{_prop}?.{_fname} ? dayjs(new Date(src.{_prop}?.{_fname}).toISOString().slice(0, 10) + 'T00:00:00').toDate() : null}}"
                else:
                    _date_expr = f"{{src.{_prop}?.{_fname} ?? null}}"
                _inner.append(
                    f"        <DateTimeWrapper label={{tf('{_fcamel}')}} date_time={_date_expr}{_show_time}{_show_date} readOnly />"
                )
            elif _field.get('prop_type') == 'boolean':
                _inner.append(
                    f"        <AppFieldBoolean\n"
                    f"          label={{tf('{_fcamel}')}}\n"
                    f"          checked={{Boolean(src.{_prop}?.{_fname})}}\n"
                    f"          readOnly\n"
                    f"        />"
                )
            elif _field.get('prop_type') in ('integer', 'number') and _field.get('enum'):
                _enum_vals = _field['enum']
                _opts = ', '.join(_int_enum_option(v, i) for i, v in enumerate(_enum_vals))
                _state = safe_var_name(f'{_prop}_{_fname}')
                flatten_enum_opt_setups.append(f"  const {_state}Options = [{_opts}];")
                _inner.append(
                    f"        <AppFieldText\n          label={{tf('{_fcamel}')}}\n"
                    f"          value={{{_state}Options.find(o => o.value === src.{_prop}?.{_fname})?.label ?? ''}}\n"
                    f"          readOnly\n        />"
                )
            else:
                _inner.append(
                    f"        <AppFieldText\n          label={{tf('{_fcamel}')}}\n"
                    f"          value={{src.{_prop}?.{_fname}?.toString() ?? ''}}\n"
                    f"          readOnly\n        />"
                )

        flatten_sections_list.append(
            f"      <AppSection label={{te('{_prop_camel}')}}>\n"
            + ('\n'.join(_inner) + '\n' if _inner else '')
            + "      </AppSection>"
        )

    needs_accordion = bool(flatten_rels_raw)
    flatten_sections = '\n'.join(flatten_sections_list)

    # Children view grids
    has_commentable      = ctx.get('has_commentable', False)
    commentable_rel_name = ctx.get('commentable_rel_name', 'commentable')
    has_comment_children = has_commentable or any(c.get('output_type') == 'comments' for c in children_raw)
    has_list_children    = any(c.get('output_type') == 'list' for c in children_raw)
    grid_children        = [c for c in children_raw if c.get('output_type') not in ('list', 'comments')]
    col_fn_names         = [f"use{to_pascal_case(c['property_name'])}Columns" for c in grid_children]

    child_view_grids = []
    # Bridge-based comment section (commentable one-to-one)
    if has_commentable:
        child_view_grids.append(
            f"      <CommentListWrapper\n"
            f"        comments={{src.{commentable_rel_name}?.comments ?? []}}\n"
            f"        showTitle={{true}}\n"
            f"        title={{tf('comments')}}\n"
            f"        permissions={{{{ create: false, delete: false }}}}\n"
            f"      />"
        )
    for child in children_raw:
        prop = child['property_name']
        child_camel = to_camel_case(prop)
        ot = child.get('output_type')
        if ot == 'comments':
            child_view_grids.append(
                f"      <CommentListWrapper\n"
                f"        comments={{src.{prop}}}\n"
                f"        showTitle={{true}}\n"
                f"        title={{tf('{child_camel}')}}\n"
                f"        permissions={{{{ create: false, delete: false }}}}\n"
                f"      />"
            )
        elif ot == 'list':
            ft = child.get('file_type')
            if ft:
                child_view_grids.append(
                    f"      <div>\n"
                    f"        <ListWrapper\n"
                    f"          items={{src.{prop}.map(f => ({{\n"
                    f"            id: f.id,\n"
                    f"            value: f.path,\n"
                    f"            label: f.name,\n"
                    f"          }}))}}\n"
                    f"          itemType=\"file\"\n"
                    f"          fileVariant=\"{ft}\"\n"
                    f"          showTitle={{true}}\n"
                    f"          title={{tf('{child_camel}')}}\n"
                    f"        />\n"
                    f"      </div>"
                )
            else:
                _rel = child.get('relationship') or {}
                _lf = _rel.get('label_field', 'name') if _rel else 'name'
                _slf = _rel.get('secondary_label_field') if _rel else None
                _target = _rel.get('target', child.get('name', '')) if _rel else child.get('name', '')
                _built = build_label_expression('f', _lf, _target, schema)
                if _built['has_format']:
                    uses_format_label_value = True
                if _slf and isinstance(_lf, str) and '.' not in _lf:
                    _sec_parts = _slf.split('.')
                    _sec_rel = _sec_parts[0]
                    _sec_field = _sec_parts[1] if len(_sec_parts) > 1 else 'name'
                    _view_val = f"(f.{_sec_rel}?.{_sec_field} || ({_built['expression']}))"
                else:
                    _view_val = _built['expression']
                child_view_grids.append(
                    f"      <div>\n"
                    f"        <ListWrapper\n"
                    f"          items={{src.{prop}.map(f => ({{\n"
                    f"            id: f.id,\n"
                    f"            value: {_view_val},\n"
                    f"            label: {_view_val},\n"
                    f"          }}))}}\n"
                    f"          itemType=\"text\"\n"
                    f"          showTitle={{true}}\n"
                    f"          title={{tf('{child_camel}')}}\n"
                    f"        />\n"
                    f"      </div>"
                )
        else:
            child_var = safe_var_name(prop)
            child_view_grids.append(
                f"      <div>\n"
                f"        <h2>{{tf('{child_camel}')}}</h2>\n"
                f"        <FieldsViewGrid fields={{src.{prop}}} columns={{{child_var}Columns}} />\n"
                f"      </div>"
            )

    column_variables = '\n'.join(
        f"  const {safe_var_name(c['property_name'])}Columns: GridColDef[] = use{to_pascal_case(c['property_name'])}Columns(false);"
        for c in grid_children
    )

    has_rel_links = any(rel_by_prop.get(p) for p in other_flds) or bool(reverse_oto_rels) or has_accordion_rel_links

    return {
        'needs_datetime_wrapper': needs_datetime_wrapper,
        'needs_image_display':    needs_image_display,
        'has_rel_links':          has_rel_links,
        'needs_accordion':        needs_accordion,
        'has_comment_children':   has_comment_children,
        'has_list_children':      has_list_children or has_flatten_array,
        'has_grid_children':      bool(grid_children),
        'col_fn_names':           col_fn_names,
        'view_enum_ns_hooks':     '\n'.join(enum_ns_hooks),
        'view_enum_opt_setups':   '\n'.join(enum_opt_setups + flatten_enum_opt_setups),
        'all_parent_fields':      all_parent_fields,
        'reverse_oto_fields':     reverse_oto_fields,
        'flatten_sections':       flatten_sections,
        'child_view_grids':       '\n'.join(child_view_grids),
        'column_variables':       column_variables,
        'custom_view_imports':    custom_view_imports,
        'use_dayjs':              use_dayjs,
        'uses_format_label_value': uses_format_label_value,
    }


# ---------------------------------------------------------------------------
# form_upsert.tsx
# ---------------------------------------------------------------------------

def form_upsert_context(ctx: dict, schema: dict) -> dict:
    parent        = ctx['parent']
    model         = ctx['model']
    parent_pascal = ctx['parent_pascal']
    parent_camel  = ctx['parent_camel']
    filtered_props = ctx['filtered_props']
    model_def     = ctx['model_def']
    parent_rels   = ctx['parent_rels']
    parent_rels_raw = ctx['parent_rels_raw']
    selector_oto_rels = ctx.get('selector_oto_rels', [])
    selector_oto_prop_names = {r['prop_name'] for r in selector_oto_rels}
    parent_rels_raw = [r for r in parent_rels_raw if r['prop_name'] not in selector_oto_prop_names]
    children_raw  = ctx['children_raw']
    can_delete    = ctx['can_delete']
    selection_targets = ctx['selection_targets']

    cats = ctx['field_categories']
    EXCLUDE = {'id', 'created_at', 'updated_at', 'creator_id'}

    # Set when any autocomplete option / FormView label uses formatLabelValue —
    # the generated component must then `import { formatLabelValue } from '@/lib/_format';`.
    uses_format_label_value = False

    # Readonly fields: exclude from editable field lists; render as disabled in edit mode only.
    readonly_field_names: set[str] = set(ctx.get('readonly_fields') or [])

    text_props           = [p for p in cats['text']           if p not in readonly_field_names]
    number_props         = [p for p in cats['number']         if p not in readonly_field_names]
    date_time_props      = [p for p in cats['date_time']      if p not in readonly_field_names]
    image_props          = [p for p in cats['image']          if p not in readonly_field_names]
    boolean_props        = [p for p in cats['boolean']        if p not in readonly_field_names]
    enum_int_props       = [p for p in cats['enum_integer']   if p not in readonly_field_names]
    enum_str_props       = [p for p in cats.get('enum_string', [])  if p not in readonly_field_names]
    custom_upsert_props  = [p for p in cats['custom_upsert'] if p not in readonly_field_names]
    entity_select_props  = [p for p in cats.get('entity_select', []) if p not in readonly_field_names]

    rel_prop_names = {r['prop_name'] for r in parent_rels_raw}

    # ---- States / Refs ----
    text_refs = '\n'.join(f"  const {p}Ref = useRef<HTMLInputElement>(null);" for p in text_props)
    number_refs = '\n'.join(f"  const {p}Ref = useRef<HTMLInputElement>(null);" for p in number_props)
    parent_refs = '\n'.join(filter(None, [text_refs, number_refs]))

    _bridge_child_ir = ctx.get('bridge_child_ir')
    if _bridge_child_ir:
        _bridge_refs = (
            "  const selectedParentTypeRef = useRef<HTMLInputElement>(null);\n"
            "  const selectedParentIdRef = useRef<HTMLInputElement>(null);"
        )
        parent_refs = '\n'.join(filter(None, [parent_refs, _bridge_refs]))

    def _setter(var_name: str) -> str:
        return to_pascal_case_from_var(var_name)

    def _ui_width_cols(prop: dict) -> int | None:
        val = (prop.get('x-ui') or {}).get('width')
        if val is None or not isinstance(val, (int, float)):
            return None
        return int(val)

    def _maybe_box_wrap(jsx: str, cols: int | None) -> str:
        if not cols:
            return jsx
        reindented = '\n'.join('  ' + line if line.strip() else line for line in jsx.splitlines())
        return (
            f"      <AppFormFieldWrapper cols={{{cols}}}>\n"
            f"{reindented}\n"
            f"      </AppFormFieldWrapper>"
        )

    has_box_import = False

    dt_state_lines = []
    for p in date_time_props:
        sn = safe_var_name(p)
        fmt = filtered_props[p].get('format')
        if fmt == 'date':
            # Date-only: slice the UTC ISO string to "YYYY-MM-DD" then append 'T00:00:00'
            # (no timezone suffix) so dayjs parses it as local midnight, preserving the
            # calendar date regardless of timezone. Using plain "YYYY-MM-DD" would be
            # parsed as UTC midnight by JS, causing a date shift in western timezones.
            init = f"src.{p} ? dayjs(new Date(src.{p}).toISOString().slice(0, 10) + 'T00:00:00') : null"
        else:
            init = f"src.{p} ? dayjs(src.{p}) : null"
        dt_state_lines.append(f"  const [{sn}, set{_setter(sn)}] = useState<Dayjs | null>({init});")
    dt_states = '\n'.join(dt_state_lines)
    img_states = '\n'.join(
        f"  const [{safe_var_name(p)}, set{_setter(safe_var_name(p))}] = useState<string>(src.{p} || '');"
        for p in image_props
    )
    bool_states = '\n'.join(
        f"  const [{safe_var_name(p)}, set{_setter(safe_var_name(p))}] = useState<boolean>(Boolean(src.{p}));"
        for p in boolean_props
    )
    enum_states = '\n'.join(
        f"  const [{safe_var_name(p)}, set{_setter(safe_var_name(p))}] = useState<number | null>(src.{p} ?? null);"
        for p in enum_int_props
    )
    def _enum_str_state_line(p: str) -> str:
        sn = safe_var_name(p)
        if _is_nullable(filtered_props.get(p, {})):
            return f"  const [{sn}, set{_setter(sn)}] = useState<string | null>(src.{p} ?? null);"
        return f"  const [{sn}, set{_setter(sn)}] = useState<string>(src.{p} ?? '');"
    enum_str_states = '\n'.join(_enum_str_state_line(p) for p in enum_str_props)
    # Many-to-one: FK prop is in src type → initialize from src.{prop_name}
    # Selector OTO: FK prop is excluded from src type, but relation object is present → use src.{relation_name}?.id
    rel_states_lines = [
        f"  const [{safe_var_name(r['prop_name'])}, set{_setter(safe_var_name(r['prop_name']))}] = useState<string | null>(src.{r['prop_name']} || null);"
        for r in parent_rels_raw
    ]
    for r in selector_oto_rels:
        sn = safe_var_name(r['prop_name'])
        rel_states_lines.append(
            f"  const [{sn}, set{_setter(sn)}] = useState<string | null>(src.{r['relation_name']}?.id || null);"
        )
    rel_states = '\n'.join(rel_states_lines)
    def _custom_state_line(p: str) -> str:
        defn = filtered_props.get(p, {})
        if _get_actual_type(defn) == 'boolean':
            return f"  const [{safe_var_name(p)}, set{_setter(safe_var_name(p))}] = useState<boolean>(Boolean(src.{p}));"
        return f"  const [{safe_var_name(p)}, set{_setter(safe_var_name(p))}] = useState<string>(src.{p} ?? '');"
    custom_states = '\n'.join(_custom_state_line(p) for p in custom_upsert_props)
    entity_select_states = '\n'.join(
        f"  const [{safe_var_name(p)}, set{_setter(safe_var_name(p))}] = useState<string | null>(src.{p} || null);"
        for p in entity_select_props
    )
    all_states = '\n'.join(filter(None, [dt_states, img_states, bool_states, enum_states, enum_str_states, rel_states, custom_states, entity_select_states]))

    # ---- Form fields (JSX) ----
    def _tf(p):
        return to_camel_case(p)

    # Text fields
    text_jsxs = []
    for p in text_props:
        prop    = filtered_props[p]
        fk      = _tf(p)
        req     = p in (model_def.get('required') or [])
        min_len = prop.get('minLength')
        max_len = prop.get('maxLength')
        slot_str = ''
        if min_len is not None: slot_str += f'\n        minLength={{{min_len}}}'
        if max_len is not None: slot_str += f'\n        maxLength={{{max_len}}}'
        _ui_rows = (prop.get('x-ui') or {}).get('rows')
        if _ui_rows is not None:
            multiline = 'true'
            rows = str(int(_ui_rows))
        else:
            multiline = 'true' if p == 'description' else 'false'
            rows = '4' if p == 'description' else 'undefined'
        _text_width_cols = _ui_width_cols(prop)
        if _text_width_cols:
            has_box_import = True
        _text_jsx = (
            f"      <AppFieldText\n"
            f"        label={{tf('{fk}')}}\n"
            f"        inputRef={{{p}Ref}}\n"
            f"        defaultValue={{src.{p} || ''}}\n"
            f"        {'required' if req else ''}{slot_str}\n"
            f"        multiline={{{multiline}}}\n"
            f"        rows={{{rows}}}\n"
            f"      />"
        )
        text_jsxs.append(_maybe_box_wrap(_text_jsx, _text_width_cols))

    def _autocomplete_rel_jsx(prop_name: str, target: str, required: bool) -> str:
        label_base    = prop_name.removesuffix('_id')
        label_fk      = _tf(label_base)
        state_name    = safe_var_name(prop_name)
        setter        = _setter(state_name)
        target_pascal = to_pascal_case(target)
        search_var    = f'{state_name}SearchAction'
        initial_var   = f'{state_name}InitialOptions'
        current_var   = f'{state_name}CurrentOption'
        return (
            f"      <AppFieldRelation\n"
            f"        label={{tf('{label_fk}')}}\n"
            f"        value={{{state_name}}}\n"
            f"        onChange={{(id) => set{setter}(id)}}\n"
            f"        searchAction={{{search_var}}}\n"
            f"        initialOptions={{{initial_var}}}\n"
            f"        currentOption={{{current_var}}}\n"
            f"        href={{{state_name} ? `/{target}/view/${{{state_name}}}` : null}}\n"
            f"        required={{{'true' if required else 'false'}}}\n"
            f"      />"
        )

    # Relationship fields (Autocomplete) — many-to-one and selector OTO
    rel_jsxs = []
    for r in parent_rels_raw:
        _rel_width_cols = _ui_width_cols(filtered_props.get(r['prop_name'], {}))
        if _rel_width_cols:
            has_box_import = True
        _rel_jsx = _autocomplete_rel_jsx(r['prop_name'], r['target'], bool(r.get('required')))
        rel_jsxs.append(_maybe_box_wrap(_rel_jsx, _rel_width_cols))
    for r in selector_oto_rels:
        # Selector OTO: required = FK is not nullable
        _rel_width_cols = _ui_width_cols(filtered_props.get(r['prop_name'], {}))
        if _rel_width_cols:
            has_box_import = True
        _rel_jsx = _autocomplete_rel_jsx(r['prop_name'], r['target'], not r.get('nullable', True))
        rel_jsxs.append(_maybe_box_wrap(_rel_jsx, _rel_width_cols))

    # Number fields
    num_jsxs = []
    for p in number_props:
        prop   = filtered_props[p]
        fk     = _tf(p)
        req    = p in (model_def.get('required') or [])
        mn     = prop.get('minimum', 0)
        mx     = prop.get('maximum', 2147483647)  # JS max safe int / float
        is_float = _get_actual_type(prop) == 'number'
        step_str = '\n        step={0.01}' if is_float else ''
        num_jsxs.append(
            f"      <NumberField\n"
            f"        label={{tf('{fk}')}}\n"
            f"        inputRef={{{p}Ref}}\n"
            f"        defaultValue={{src.{p} || undefined}}\n"
            f"        {'required' if req else ''}\n"
            f"        min={{{mn}}}\n"
            f"        max={{{mx}}}{step_str}\n"
            f"      />"
        )

    # DateTime fields
    dt_jsxs = []
    for p in date_time_props:
        prop    = filtered_props[p]
        fk      = _tf(p)
        req     = p in (model_def.get('required') or [])
        sn      = safe_var_name(p)
        setter  = _setter(sn)
        fmt     = prop.get('format')
        show_date_str = '\n        show_date={false}' if fmt == 'time' else ''
        show_time_str = '\n        show_time={false}' if fmt == 'date' else ''
        dt_jsxs.append(
            f"      <DateTimeWrapper\n"
            f"        label={{tf('{fk}')}} {show_date_str}{show_time_str}\n"
            f"        date_time={{{sn} ? {sn}.toDate() : null}}\n"
            f"        {'required' if req else ''}\n"
            f"        onChange={{(newValue: dayjs.Dayjs | null) => set{setter}(newValue)}}\n"
            f"      />"
        )

    # Image fields
    img_jsxs = []
    for p in image_props:
        sn     = safe_var_name(p)
        setter = _setter(sn)
        img_jsxs.append(f"      <ImageUpload\n        value={{{sn}}}\n        onChange={{set{setter}}}\n      />")

    # Boolean fields
    bool_jsxs = []
    for p in boolean_props:
        fk     = _tf(p)
        sn     = safe_var_name(p)
        setter = _setter(sn)
        bool_jsxs.append(
            f"      <AppFieldBoolean\n"
            f"        label={{tf('{fk}')}}\n"
            f"        checked={{{sn}}}\n"
            f"        onChange={{(e) => set{setter}(e.target.checked)}}\n"
            f"      />"
        )

    # Enum integer fields
    enum_ns_set   = set()
    enum_ns_hooks = []
    enum_opt_setups = []
    rel_opt_setups  = []
    enum_int_jsxs = []

    for p in enum_int_props:
        prop      = filtered_props[p]
        fk        = _tf(p)
        sn        = safe_var_name(p)
        setter    = _setter(sn)
        opts_var  = f'{sn}Options'
        enum_vals = prop.get('enum', [])
        ns        = prop.get('x-enum-namespace')
        # A non-nullable enum field (Prisma NOT NULL, possibly with a
        # `@default(...)` that keeps it out of json_schema `required:`) can
        # never be legally cleared, so it's validated like a required field
        # even when the schema doesn't list it (cmd_472/R-2; see
        # validation_context._is_select_like).
        req       = p in (model_def.get('required') or []) or not _is_nullable(prop)

        if ns and ns not in enum_ns_set:
            enum_ns_set.add(ns)
            enum_ns_hooks.append(f"  const t{ns} = useTranslations('{ns}');")

        if ns:
            opts = ', '.join(
                (f"{{ value: {(v if isinstance(v, (int, float)) else (i if not str(v).lstrip('-').isdigit() else int(v)))}, "
                 f"label: t{ns}('{(v.lower()[0]+v[1:] if isinstance(v,str) and not str(v).lstrip('-').isdigit() else str(v))}') }}")
                for i, v in enumerate(enum_vals)
            )
        else:
            opts = ', '.join(_int_enum_option(v, i) for i, v in enumerate(enum_vals))
        enum_opt_setups.append(f"  const {opts_var} = [{opts}];")

        _enum_int_width_cols = _ui_width_cols(prop)
        if _enum_int_width_cols:
            has_box_import = True
        _enum_int_jsx = (
            f"      <AppFieldSelect\n"
            f"        options={{{opts_var}}}\n"
            f"        value={{{opts_var}.find((o) => o.value === {sn}) ?? null}}\n"
            f"        onChange={{(newValue) => set{setter}(newValue)}}\n"
            f"        label={{tf('{fk}')}}\n"
            f"        {'required' if req else ''}\n"
            f"      />"
        )
        enum_int_jsxs.append(_maybe_box_wrap(_enum_int_jsx, _enum_int_width_cols))

    # Enum string fields (string discriminator with fixed enum values)
    enum_str_jsxs = []
    for p in enum_str_props:
        prop      = filtered_props[p]
        fk        = _tf(p)
        sn        = safe_var_name(p)
        setter    = _setter(sn)
        opts_var  = f'{sn}Options'
        enum_vals = prop.get('enum', [])
        # See the enum_int_props loop above (cmd_472/R-2): a non-nullable
        # enum field is validated as required even if a Prisma default
        # keeps it out of json_schema `required:`.
        req       = p in (model_def.get('required') or []) or not _is_nullable(prop)
        native_ns = _native_enum_ns(prop)

        if native_ns:
            if native_ns not in enum_ns_set:
                enum_ns_set.add(native_ns)
                enum_ns_hooks.append(f"  const t{native_ns} = useTranslations('{native_ns}');")
            opts = ', '.join(
                f"{{ value: '{v}', label: t{native_ns}('{_native_enum_key(v)}') }}"
                for v in enum_vals
            )
        else:
            opts = ', '.join(f"{{ value: '{v}', label: '{v}' }}" for v in enum_vals)
        enum_opt_setups.append(f"  const {opts_var} = [{opts}];")

        _enum_str_width_cols = _ui_width_cols(prop)
        if _enum_str_width_cols:
            has_box_import = True
        # Nullable → pass the cleared (null) value straight through so an
        # explicit NULL reaches the server. Non-nullable → fall back to ''
        # so the missing-value check in form_validation.ts (isMissingValue)
        # catches it before submit (cmd_472/R-2).
        _enum_str_on_change = (
            f"onChange={{(newValue) => set{setter}(newValue)}}"
            if _is_nullable(prop)
            else f"onChange={{(newValue) => set{setter}(newValue ?? '')}}"
        )
        _enum_str_jsx = (
            f"      <AppFieldSelect\n"
            f"        options={{{opts_var}}}\n"
            f"        value={{{opts_var}.find((o) => o.value === {sn}) ?? null}}\n"
            f"        {_enum_str_on_change}\n"
            f"        label={{tf('{fk}')}}\n"
            f"        {'required' if req else ''}\n"
            f"      />"
        )
        enum_str_jsxs.append(_maybe_box_wrap(_enum_str_jsx, _enum_str_width_cols))

    # For each many-to-one (and selector OTO) relation, emit:
    #   - {prop}InitialOptions  : useMemo over the limited initial set (initial{Target}s)
    #   - {prop}SearchAction    : useCallback that delegates to search{Target}Options and
    #                             remaps full records to {id, label} using the rel's label_field
    #   - {prop}CurrentOption   : useMemo over src.{relation_name} for the resolved label
    for r in list(parent_rels_raw) + list(selector_oto_rels):
        prop_name     = r['prop_name']
        target        = r['target']
        target_pascal = to_pascal_case(target)
        label_field   = r.get('label_field', 'name')
        rel_name      = prop_name.removesuffix('_id') if prop_name.endswith('_id') else prop_name
        sn            = safe_var_name(prop_name)
        initial_var   = f'{sn}InitialOptions'
        search_var    = f'{sn}SearchAction'
        current_var   = f'{sn}CurrentOption'
        prop_initial  = f'initial{target_pascal}s'
        prop_search   = f'search{target_pascal}Options'

        label_built = build_label_expression('item', label_field, target, schema)
        current_built = build_label_expression(f'src.{rel_name}', label_field, target, schema)
        if label_built['has_format']:
            uses_format_label_value = True

        # DP-3 (cmd_377/379): forward callerEntity + selected sibling-field
        # values into the target's autocomplete filter hook (context param
        # on search{Target}Options), but only for FK fields that carry an
        # 'x-autocomplete-context' annotation — every other FK's call site
        # (the overwhelming majority) is byte-for-byte unchanged.
        ctx_fields = r.get('autocomplete_context_fields') or []
        if ctx_fields:
            form_values_entries = ', '.join(f'{f}: {safe_var_name(f)}' for f in ctx_fields)
            search_call_args = (
                f"query, includeIds, 50, "
                f"{{ callerEntity: '{parent}', formValues: {{ {form_values_entries} }} }}"
            )
            search_deps = ''.join(f', {safe_var_name(f)}' for f in ctx_fields)
        else:
            search_call_args = "query, includeIds"
            search_deps = ''

        rel_opt_setups.append(
            f"  const {initial_var} = useMemo(() => ({prop_initial} ?? []).map((item) => ({{\n"
            f"    id: item.id,\n"
            f"    label: {label_built['expression']},\n"
            f"  }})), [{prop_initial}]);\n"
            f"  const {search_var} = useCallback(async (query: string, includeIds: string[]) => {{\n"
            f"    const rows = (await {prop_search}?.({search_call_args})) ?? [];\n"
            f"    return rows.map((item) => ({{ id: item.id, label: {label_built['expression']} }}));\n"
            f"  }}, [{prop_search}{search_deps}]);\n"
            f"  const {current_var} = useMemo(() => (\n"
            f"    src.{rel_name} ? {{ id: src.{rel_name}.id, label: {current_built['expression']} }} : null\n"
            f"  ), [src.{rel_name}]);"
        )

    # Entity select fields (static options embedded in the file)
    entity_select_opt_setups = []
    entity_select_jsxs = []
    entity_select_options = ctx.get('entity_select_options', [])
    for p in entity_select_props:
        fk      = _tf(p)
        sn      = safe_var_name(p)
        setter  = _setter(sn)
        req     = p in (model_def.get('required') or [])
        opts_var = f'{sn}Options'
        opts_items = ', '.join(
            f"{{ value: '{o['value']}', label: '{o['label']}' }}"
            for o in entity_select_options
        )
        entity_select_opt_setups.append(f"  const {opts_var} = [{opts_items}];")
        entity_select_jsxs.append(
            f"      <AppFieldSelect\n"
            f"        options={{{opts_var}}}\n"
            f"        value={{{opts_var}.find((o) => o.value === {sn}) ?? null}}\n"
            f"        onChange={{(newValue) => set{setter}(newValue)}}\n"
            f"        label={{tf('{fk}')}}\n"
            f"        {'required' if req else ''}\n"
            f"      />"
        )

    # Custom upsert fields
    custom_jsxs = []
    for p in custom_upsert_props:
        comp  = to_pascal_case(p)
        sn    = safe_var_name(p)
        setter = _setter(sn)
        custom_jsxs.append(f"      <{comp} value={{{sn}}} onChange={{set{setter}}} isEdit={{isEdit}} />")

    # Readonly fields: displayed as readOnly text fields in edit mode, omitted in new mode.
    readonly_edit_jsxs = []
    for _ro_fn in sorted(readonly_field_names):
        if _ro_fn not in filtered_props:
            continue
        _ro_fk = _tf(_ro_fn)
        readonly_edit_jsxs.append(
            f"      {{isEdit && (\n"
            f"        <AppFieldText\n"
            f"          label={{tf('{_ro_fk}')}}\n"
            f"          value={{src.{_ro_fn} !== null && src.{_ro_fn} !== undefined ? String(src.{_ro_fn}) : ''}}\n"
            f"          readOnly\n"
            f"        />\n"
            f"      )}}"
        )

    all_parent_fields_jsx = '\n'.join(filter(None, [
        '\n'.join(text_jsxs),
        '\n'.join(entity_select_jsxs),
        '\n'.join(rel_jsxs),
        '\n'.join(num_jsxs),
        '\n'.join(enum_int_jsxs),
        '\n'.join(enum_str_jsxs),
        '\n'.join(bool_jsxs),
        '\n'.join(dt_jsxs),
        '\n'.join(img_jsxs),
        '\n'.join(custom_jsxs),
        '\n'.join(readonly_edit_jsxs),
    ]))

    if _bridge_child_ir:
        # Stage 2: bridge parent UI.
        # Edit mode: parent type and label displayed read-only so the user sees context.
        # New mode:  hidden inputs carry selectedParentType/Id (populated by parent-embedded create).
        _bc_bridge_name = _bridge_child_ir['name']
        _bridge_jsx = (
            f"      {{/* bridge-parent: {_bc_bridge_name} — set by parent-embedded create, not switchable */}}\n"
            f"      {{isEdit ? (\n"
            f"        <>\n"
            f"          <AppFieldText label={{tf('parentType')}} value={{src.parent_type ?? ''}} readOnly />\n"
            f"          <AppFieldText label={{tf('parentLabel')}} value={{src.parent_label ?? ''}} readOnly />\n"
            f"        </>\n"
            f"      ) : (\n"
            f"        <>\n"
            f"          <input type=\"hidden\" ref={{selectedParentTypeRef}} defaultValue={{initialParentType ?? ''}} />\n"
            f"          <input type=\"hidden\" ref={{selectedParentIdRef}} defaultValue={{initialParentId ?? ''}} />\n"
            f"        </>\n"
            f"      )}}"
        )
        all_parent_fields_jsx = '\n'.join(filter(None, [_bridge_jsx, all_parent_fields_jsx]))

    # ---- FormData sets ----
    text_ds  = '\n'.join(f"    formData.set('{p}', {p}Ref.current?.value || '');" for p in text_props)
    def _entity_select_fds_line(p: str) -> str:
        var = safe_var_name(p)
        if _is_nullable(filtered_props.get(p, {})):
            return f"    if ({var}) formData.set('{p}', {var});"
        return f"    formData.set('{p}', {var} || '');"
    entity_select_ds = '\n'.join(_entity_select_fds_line(p) for p in entity_select_props)
    num_ds   = '\n'.join(f"    formData.set('{p}', {p}Ref.current?.value || '');" for p in number_props)
    dt_ds_parts = []
    for p in date_time_props:
        sn = safe_var_name(p)
        if filtered_props[p].get('format') == 'date':
            # Date-only: send as YYYY-MM-DD so new Date() parses it as UTC midnight,
            # matching the @db.Date column and avoiding timezone shift (e.g. JST → prev day).
            dt_ds_parts.append(f"    formData.set('{p}', {sn}?.format('YYYY-MM-DD') || '');")
        else:
            dt_ds_parts.append(f"    formData.set('{p}', {sn}?.toISOString() || '');")
    dt_ds = '\n'.join(dt_ds_parts)
    img_ds   = '\n'.join(f"    formData.set('{p}', {safe_var_name(p)});" for p in image_props)
    def _rel_fds_line(r: dict) -> str:
        var = safe_var_name(r['prop_name'])
        # parent_rels_raw entries carry a 'required' key; selector_oto_rels entries carry 'nullable'.
        is_optional = r.get('nullable', False) or not r.get('required', True)
        if is_optional:
            return f"    if ({var}) formData.set('{r['prop_name']}', {var});"
        return f"    formData.set('{r['prop_name']}', {var} || '');"
    rel_ds   = '\n'.join(_rel_fds_line(r) for r in list(parent_rels_raw) + list(selector_oto_rels))
    bool_ds  = '\n'.join(f"    formData.set('{p}', {safe_var_name(p)}.toString());" for p in boolean_props)
    def _enum_int_fds_line(p: str) -> str:
        var = safe_var_name(p)
        if _is_nullable(filtered_props.get(p, {})):
            # Nullable → omit the key entirely when cleared, matching the
            # rel/entity_select convention: data.get() then naturally
            # returns null instead of the string 'null' (cmd_472/R-2).
            return f"    if ({var} !== null) formData.set('{p}', String({var}));"
        return f"    formData.set('{p}', {var} !== null ? String({var}) : '');"
    enum_ds      = '\n'.join(_enum_int_fds_line(p) for p in enum_int_props)
    def _enum_str_fds_line(p: str) -> str:
        var = safe_var_name(p)
        if _is_nullable(filtered_props.get(p, {})):
            return f"    if ({var}) formData.set('{p}', {var});"
        return f"    formData.set('{p}', {var});"
    enum_str_ds  = '\n'.join(_enum_str_fds_line(p) for p in enum_str_props)
    def _custom_form_data_line(p: str) -> str:
        defn = filtered_props.get(p, {})
        if _get_actual_type(defn) == 'boolean':
            return f"    formData.set('{p}', {safe_var_name(p)}.toString());"
        return f"    formData.set('{p}', {safe_var_name(p)});"
    cust_ds  = '\n'.join(_custom_form_data_line(p) for p in custom_upsert_props)
    parent_form_data_sets = '\n'.join(filter(None, [text_ds, entity_select_ds, rel_ds, num_ds, enum_ds, enum_str_ds, bool_ds, dt_ds, img_ds, cust_ds]))

    # ---- Children analysis ----
    # Use the pre-filtered embedded_ch from build_context (passed as non_comment_ch in ctx).
    # Excludes independent mandatory-FK list children (have own pages; shown read-only).
    # Includes non-independent mandatory-FK list children (no own page; full CRUD via text list).
    # Includes m2m and optional-FK list children (use_connect=True; autocomplete add/delete).
    non_comment_ch = ctx['non_comment_ch']

    # Independent mandatory-FK list children are excluded from non_comment_ch (embedded_ch)
    # but per spec must still be shown read-only in FormUpsert (isEdit-guarded, no add/delete).
    children_data_all = ctx.get('children_data', [])
    indep_list_ch = [
        c for c in children_data_all
        if c.get('output_type') == 'list'
        and c.get('is_independent')
        and not c.get('use_connect')
    ]
    has_indep_list_children = bool(indep_list_ch)
    has_commentable_fu   = ctx.get('has_commentable', False)
    commentable_rel_name_fu = ctx.get('commentable_rel_name', 'commentable')
    if has_commentable_fu:
        comment_children = [{'bridge': True, 'property_name': commentable_rel_name_fu}]
    else:
        comment_children = [c for c in children_raw if c.get('output_type') == 'comments']
    has_comment_children = bool(comment_children)
    has_children = bool(non_comment_ch)
    has_many_to_many = any((c.get('relationship') or {}).get('type') == 'many-to-many' for c in children_raw)
    has_many_to_one = bool(parent_rels_raw) or bool(selector_oto_rels)

    # Column fn names (grid children only)
    col_fn_names = [
        f"use{to_pascal_case(c['property_name'])}Columns"
        for c in non_comment_ch
        if c.get('output_type') not in ('list', None) or c.get('output_type') is None
        if c.get('output_type') != 'list' and (c.get('relationship') or {}).get('type') != 'many-to-many'
    ]

    # Ordered children detection
    has_ordered_ch = any(
        'order' in (_raw_def(c['name'], schema).get('properties') or {})
        for c in non_comment_ch
    )
    # Flatten arrays (e.g., pre_check_detail.symptoms) need EditableListWrapper
    # too — detect early so the import is included alongside the standard
    # list-child case.
    _flatten_has_array_upsert = any(
        f.get('is_array')
        for fr in ctx.get('flatten_rels', [])
        if not fr.get('is_m2o')
        for f in fr.get('fields', [])
    )
    has_list_ch = _flatten_has_array_upsert or any(
        c.get('output_type') == 'list' or (c.get('relationship') or {}).get('type') == 'many-to-many'
        for c in non_comment_ch
    )
    has_ordered_list_ch = any(
        c.get('output_type') == 'list' and (c.get('relationship') or {}).get('type') != 'many-to-many'
        and 'order' in (_raw_def(c['name'], schema).get('properties') or {})
        for c in non_comment_ch
    )

    # Child imports
    child_imports_parts = []
    m2m_targets = list(dict.fromkeys(
        c['relationship']['target']
        for c in children_raw
        if (c.get('relationship') or {}).get('type') == 'many-to-many'
    ))
    for t in m2m_targets:
        child_imports_parts.append(f"import type {{ {to_pascal_case(t)} }} from '@/lib/{t}/types';")
    if has_list_ch:
        child_imports_parts.append("import EditableListWrapper, { EditableListWrapperItem } from '@/components/_standard/EditableListWrapper';")
    if has_ordered_list_ch:
        child_imports_parts.append("import OrderedEditableListWrapper from '@/components/_standard/OrderedEditableListWrapper';")
    has_grid_ch = any(
        c.get('output_type') != 'list' and (c.get('relationship') or {}).get('type') != 'many-to-many'
        for c in non_comment_ch
    )
    if has_grid_ch:
        child_imports_parts.append("import type { GridRowsProp } from '@/components/ui/data';")
        dg_import = (
            "import FieldsDataGrid from '@/components/_standard/FieldsDataGrid';\n"
            "import OrderedFieldsDataGrid from '@/components/_standard/OrderedFieldsDataGrid';"
            if has_ordered_ch else
            "import FieldsDataGrid from '@/components/_standard/FieldsDataGrid';"
        )
        child_imports_parts.append(dg_import)
    if col_fn_names:
        child_imports_parts.append(f"import {{ {', '.join(col_fn_names)} }} from '../{parent}/column_def';")
    if has_indep_list_children:
        child_imports_parts.append("import ListWrapper from '@/components/_standard/ListWrapper';")
    child_imports = '\n'.join(child_imports_parts)

    # Child variables (useRef)
    child_variables = '\n'.join(
        f"  const {safe_var_name(c['property_name'])}Ref = useRef<"
        + ("{ getItems: () => EditableListWrapperItem[] }"
           if c.get('output_type') == 'list' or (c.get('relationship') or {}).get('type') == 'many-to-many'
           else "{ getFields: () => GridRowsProp }")
        + ">(null);"
        for c in non_comment_ch
    )

    # Child grid setup (per child: column var, initial state, createNew)
    child_grid_setup_parts = []
    for c in non_comment_ch:
        child_name = c['name']
        prop_name  = c['property_name']
        child_var  = safe_var_name(prop_name)
        child_pascal = to_pascal_case(prop_name)
        child_def  = _raw_def(child_name, schema)
        child_props_dict = child_def.get('properties', {})
        is_m2m     = (c.get('relationship') or {}).get('type') == 'many-to-many'
        is_list    = c.get('output_type') == 'list'
        is_self    = child_name == model

        if c.get('use_connect') and is_list:
            # Derive label_field: m2m uses x-relationships labelField, self-ref uses own rel, else 'name'
            _rel = c.get('relationship') or {}
            if _rel.get('type') == 'many-to-many':
                _uc_label = _rel.get('label_field', 'name')
                _uc_target = _rel.get('target', child_name)
                _uc_secondary = _rel.get('secondary_label_field')
            elif child_name == model:
                _sr = next((r for r in ctx.get('parent_rels_raw', []) if r['target'] == model), None)
                _uc_label = _sr.get('label_field', 'name') if _sr else 'name'
                _uc_target = model
                _uc_secondary = None
            else:
                _uc_label = 'name'
                _uc_target = child_name
                _uc_secondary = None
            # Build the label expression via the shared helper so list/dotted-
            # path/array forms of labelField all work uniformly. The legacy
            # secondaryLabelField is honoured only when the primary is a single
            # field (preserves the historical " - <secondary>" suffix shape).
            built = build_label_expression('f', _uc_label, _uc_target, schema)
            if built['has_format']:
                uses_format_label_value = True
            if _uc_secondary and isinstance(_uc_label, str) and '.' not in _uc_label:
                _sec_parts = _uc_secondary.split('.')
                _sec_rel, _sec_field = _sec_parts[0], _sec_parts[1] if len(_sec_parts) > 1 else 'name'
                _label_expr = f"{built['expression']} + (f.{_sec_rel} ? ` - ${{f.{_sec_rel}.{_sec_field}}}` : '')"
            else:
                _label_expr = built['expression']
            child_grid_setup_parts.append(
                f"  const [localInitial{child_pascal}] = useState<EditableListWrapperItem[]>(() => src.{prop_name}.map(f => ({{\n"
                f"    id: f.id || `temp-${{Date.now()}}-${{Math.random()}}`,\n"
                f"    value: f.id,\n"
                f"    label: {_label_expr},\n"
                f"    originalId: f.id,\n"
                f"  }})));"
            )
            continue

        if is_list:
            ft = c.get('file_type')
            has_order = 'order' in child_props_dict
            order_line = '\n    order: f.order,' if has_order else ''
            if ft:
                child_grid_setup_parts.append(
                    f"  const [localInitial{child_pascal}] = useState<EditableListWrapperItem[]>(() => src.{prop_name}.map(f => ({{\n"
                    f"    id: f.id || `temp-${{Date.now()}}-${{Math.random()}}`,\n"
                    f"    value: f.path,\n"
                    f"    label: f.name,\n"
                    f"    originalId: f.id,{order_line}\n"
                    f"  }})));"
                )
            else:
                _list_rel = c.get('relationship') or {}
                _list_lf = _list_rel.get('label_field', 'name')
                _list_target = _list_rel.get('target', child_name)
                _list_built = build_label_expression('f', _list_lf, _list_target, schema)
                if _list_built['has_format']:
                    uses_format_label_value = True
                _list_expr = _list_built['expression']
                child_grid_setup_parts.append(
                    f"  const [localInitial{child_pascal}] = useState<EditableListWrapperItem[]>(() => src.{prop_name}.map(f => ({{\n"
                    f"    id: f.id || `temp-${{Date.now()}}-${{Math.random()}}`,\n"
                    f"    value: {_list_expr},\n"
                    f"    label: {_list_expr},\n"
                    f"    originalId: f.id,{order_line}\n"
                    f"  }})));"
                )
            continue

        # Grid child — exclude only the actual parent FK column(s), found via x-relationship
        # annotations (not all FKs targeting the parent, e.g. reference_id → db_table stays).
        parent_fk_props_child = get_parent_fk_props(child_def, model)
        child_rels = [r for r in get_parent_relationships(child_def) if r['prop_name'] not in parent_fk_props_child]
        rel_opt_args = ', '.join(f'{to_camel_case(r["prop_name"])}Config' for r in child_rels)
        rel_args_str = f', {rel_opt_args}' if rel_opt_args else ''

        exclude_in_create = parent_fk_props_child | {'id', 'created_at', 'updated_at', 'creator_id'}
        create_props = [k for k in child_props_dict if k not in exclude_in_create]

        def _new_prop_val(p, defn):
            actual = _get_actual_type(defn)
            fmt    = defn.get('format')
            nullable = _is_nullable(defn)
            if actual == 'boolean':
                return str(defn.get('default', False)).lower()
            if actual == 'string' and fmt in ('date', 'date-time', 'time'):
                return "dayjs().toISOString()"
            if actual == 'string':
                # Prisma nativeEnum-backed field: '' is not a valid enum member,
                # so the new-row seed must use the schema's actual default
                # (mirrors build_context.py:_default_value, cmd_446 pilot).
                if defn.get('_prisma_native_enum_type') and 'default' in defn:
                    return f"'{defn['default']}'"
                if defn.get('_prisma_native_enum_type') and nullable:
                    # Nullable (e.g. stack_mode/group_by_bucket) with no schema
                    # default — seeding with enum[0] would fabricate meaning
                    # that was never chosen, so leave it unset instead.
                    return 'null'
                if defn.get('_prisma_native_enum_type') and isinstance(defn.get('enum'), list) and defn['enum']:
                    # Required field with no schema default — a required
                    # column can't be left empty, so fall back to the first
                    # declared enum member so create() still receives a valid
                    # enum value.
                    return f"'{defn['enum'][0]}'"
                return "''"
            if actual in ('integer', 'number'):
                if nullable:
                    return 'null'
                schema_default = defn.get('default')
                if schema_default is None:
                    return '0'
                # Integer-enum defaults may be string labels (e.g. 'outstanding');
                # emit the stored ordinal so the row value typechecks as a number.
                return _enum_value_literal(defn, schema_default)
            return 'null'

        create_body = '\n'.join(
            f"    {p}: {_new_prop_val(p, child_props_dict[p])},"
            for p in create_props
        )

        parent_fk_assignments = '\n'.join(
            f"    {fk_prop}: src.id," for fk_prop in sorted(parent_fk_props_child)
        )
        child_grid_setup_parts.append(
            f"  const {child_var}Columns = use{to_pascal_case(prop_name)}Columns(true{rel_args_str});\n\n"
            f"  const [localInitial{child_pascal}] = useState<GridRowsProp>(() => src.{prop_name}.map(f => ({{ ...f, id: f.id || `temp-${{Date.now()}}-${{Math.random()}}` }})));\n\n"
            f"  const createNew{child_pascal} = () => ({{\n"
            f"    id: `temp-${{Date.now()}}-${{Math.random()}}`,\n"
            f"{create_body}\n"
            f"{parent_fk_assignments}\n"
            f"  }});"
        )

    child_grid_setup = '\n'.join(child_grid_setup_parts)

    # For each child grid m2o relation, build an EntityAutocompleteCellConfig.
    # The label-lookup map is seeded from src.{child}.{relation} (the FK-included rows
    # already on screen) and from initial{Target}s (the limited initial fetch).
    parent_rel_prop_names = {r['prop_name'] for r in parent_rels_raw}
    processed_rels: set[str] = set()
    child_entity_rel_opt = []
    for c in non_comment_ch:
        if c.get('output_type') == 'list' or (c.get('relationship') or {}).get('type') == 'many-to-many':
            continue
        cdef = _raw_def(c['name'], schema)
        parent_fk_props_cdef = get_parent_fk_props(cdef, model)
        child_prop_name = c['property_name']
        for r in get_parent_relationships(cdef):
            if r['prop_name'] in parent_fk_props_cdef or r['prop_name'] in parent_rel_prop_names:
                continue
            if r['prop_name'] in processed_rels:
                continue
            processed_rels.add(r['prop_name'])

            prop_camel    = to_camel_case(r['prop_name'])
            target        = r['target']
            target_pascal = to_pascal_case(target)
            label_field   = r.get('label_field', 'name')
            label_base    = r['prop_name'].removesuffix('_id') if r['prop_name'].endswith('_id') else r['prop_name']
            label_camel   = to_camel_case(label_base)
            config_var    = f'{prop_camel}Config'
            lookup_var    = f'{prop_camel}Lookup'
            initial_opts_var = f'{prop_camel}InitialOpts'
            prop_initial  = f'initial{target_pascal}s'
            prop_search   = f'search{target_pascal}Options'

            # label_field may be a single field name or a composite path list
            # (e.g. ['product.name', 'location', 'lot_number']) — always go
            # through build_label_expression rather than raw `item.{label_field}`
            # property access, which breaks on composite/array labelField.
            item_built = build_label_expression('item', label_field, target, schema)
            row_built  = build_label_expression(f'row.{label_base}', label_field, target, schema)
            if item_built['has_format'] or row_built['has_format']:
                uses_format_label_value = True

            child_entity_rel_opt.append(
                f"  const {lookup_var} = useMemo<Map<string, string>>(() => {{\n"
                f"    const m = new Map<string, string>();\n"
                f"    src.{child_prop_name}.forEach(row => {{\n"
                f"      if (row.{label_base}) m.set(row.{label_base}.id, {row_built['expression']});\n"
                f"    }});\n"
                f"    ({prop_initial} ?? []).forEach(item => {{ m.set(item.id, {item_built['expression']}); }});\n"
                f"    return m;\n"
                f"  }}, [src.{child_prop_name}, {prop_initial}]);\n"
                f"  const {initial_opts_var} = useMemo(() =>\n"
                f"    ({prop_initial} ?? []).map(item => ({{ id: item.id, label: {item_built['expression']} }})),\n"
                f"  [{prop_initial}]);\n"
                f"  const {config_var} = useMemo<EntityAutocompleteCellConfig>(() => ({{\n"
                f"    searchAction: async (query, includeIds) => {{\n"
                f"      const rows = (await {prop_search}?.(query, includeIds)) ?? [];\n"
                f"      rows.forEach(item => {{ {lookup_var}.set(item.id, {item_built['expression']}); }});\n"
                f"      return rows.map(item => ({{ id: item.id, label: {item_built['expression']} }}));\n"
                f"    }},\n"
                f"    initialOptions: {initial_opts_var},\n"
                f"    labelLookup: {lookup_var},\n"
                f"    label: tf('{label_camel}'),\n"
                f"  }}), [{initial_opts_var}, {prop_search}, {lookup_var}, tf]);"
            )
    child_entity_rel_option_setups = '\n'.join(child_entity_rel_opt)

    # Child form data handling
    child_fdh_parts = []
    for c in non_comment_ch:
        child_name = c['name']
        prop_name  = c['property_name']
        child_var  = safe_var_name(prop_name)
        form_key   = singularize(prop_name)
        child_def  = _raw_def(child_name, schema)
        child_props_dict = child_def.get('properties', {})
        is_m2m = (c.get('relationship') or {}).get('type') == 'many-to-many'
        is_list = c.get('output_type') == 'list'
        is_self = child_name == model

        if c.get('use_connect') and is_list:
            item_var = singularize(child_var)
            child_fdh_parts.append(
                f"    const {child_var} = {child_var}Ref.current?.getItems?.() || [];\n\n"
                f"    {child_var}.forEach((item) => {{\n"
                f"      const itemId =\n"
                f"        item.originalId ??\n"
                f"        (typeof item.value === 'string' || typeof item.value === 'number' ? item.value : undefined);\n"
                f"      formData.append(\n"
                f"        '{form_key}[]',\n"
                f"        JSON.stringify({{\n"
                f"          id: itemId,\n"
                f"          name: item.label ?? item.value,\n"
                f"        }})\n"
                f"      );\n"
                f"    }});"
            )
            continue

        if is_list:
            ft = c.get('file_type')
            has_order = 'order' in child_props_dict
            order_prop = '\n          order: item.order,' if has_order else ''
            if ft:
                child_fdh_parts.append(
                    f"    const {child_var} = {child_var}Ref.current?.getItems?.() || [];\n\n"
                    f"    {child_var}.forEach((item) => {{\n"
                    f"      const itemId = item.originalId || (typeof item.id === 'string' && item.id.startsWith('temp-') ? undefined : item.id);\n"
                    f"      formData.append(\n"
                    f"        '{form_key}[]',\n"
                    f"        JSON.stringify({{\n"
                    f"          id: itemId,{order_prop}\n"
                    f"          name: item.label,\n"
                    f"          path: item.value,\n"
                    f"        }})\n"
                    f"      );\n"
                    f"    }});"
                )
            else:
                child_fdh_parts.append(
                    f"    const {child_var} = {child_var}Ref.current?.getItems?.() || [];\n\n"
                    f"    {child_var}.forEach((item) => {{\n"
                    f"      const itemId = item.originalId || (typeof item.id === 'string' && item.id.startsWith('temp-') ? undefined : item.id);\n"
                    f"      formData.append(\n"
                    f"        '{form_key}[]',\n"
                    f"        JSON.stringify({{\n"
                    f"          id: itemId,{order_prop}\n"
                    f"          name: item.value,\n"
                    f"        }})\n"
                    f"      );\n"
                    f"    }});"
                )
            continue

        # Grid child
        parent_fk_props_ser = get_parent_fk_props(child_def, model)
        exclude_ser = parent_fk_props_ser | {'id', 'created_at', 'updated_at', 'creator_id'}
        ser_props = [k for k in child_props_dict if k not in exclude_ser]
        serialize = '\n'.join(f"          {p}: field.{p}," for p in ser_props)
        child_fdh_parts.append(
            f"    const {child_var} = {child_var}Ref.current?.getFields?.() || [];\n\n"
            f"    ({child_var} as GridRowsProp).forEach((field) => {{\n"
            f"      formData.append(\n"
            f"        '{form_key}[]',\n"
            f"        JSON.stringify({{\n"
            f"          id: field.id.startsWith('temp-') ? undefined : field.id,\n"
            f"{serialize}\n"
            f"        }})\n"
            f"      );\n"
            f"    }});"
        )
    child_form_data_handling = '\n'.join(child_fdh_parts)

    # Child datagrid required-field validation (injected at start of handleSubmit)
    child_validation_parts = []
    exclude_validation = {'id', 'created_at', 'updated_at', 'creator_id', 'order', 'approvable_id'}
    for c in non_comment_ch:
        child_name = c['name']
        prop_name  = c['property_name']
        child_var  = safe_var_name(prop_name)
        child_pascal = to_pascal_case(prop_name)
        child_title_label = ' '.join(w.capitalize() for w in prop_name.split('_'))
        child_def  = _raw_def(child_name, schema)
        child_props_dict_v = child_def.get('properties', {})
        is_list = c.get('output_type') == 'list'
        is_m2m  = (c.get('relationship') or {}).get('type') == 'many-to-many'

        if is_list or is_m2m or c.get('file_type') or c.get('use_connect'):
            continue

        # Required fields excluding the parent FK and audit columns; booleans always have a value
        child_required_all = child_def.get('required', [])
        parent_fk_props_val = get_parent_fk_props(child_def, model)
        required_validatable = [
            k for k in child_required_all
            if k not in exclude_validation
            and k not in parent_fk_props_val
            and _get_actual_type(child_props_dict_v.get(k, {})) != 'boolean'
        ]

        if not required_validatable:
            continue

        req_props_js = ', '.join(f"'{p}'" for p in required_validatable)
        child_validation_parts.append(
            f"    const invalid{child_pascal} = ({child_var}Ref.current?.getFields?.() || []).filter((row: Record<string, unknown>) =>\n"
            f"      [{req_props_js}].some((prop: string) => row[prop] == null || row[prop] === '')\n"
            f"    );\n"
            f"    if (invalid{child_pascal}.length > 0) {{\n"
            f"      setError('{child_title_label}: required fields ({', '.join(required_validatable)}) must be filled for all rows.');\n"
            f"      return;\n"
            f"    }}"
        )
    child_validation_code = '\n\n'.join(child_validation_parts)

    # Child grid components (JSX)
    child_grid_components_parts = []
    for c in non_comment_ch:
        child_name  = c['name']
        prop_name   = c['property_name']
        child_var   = safe_var_name(prop_name)
        child_pascal = to_pascal_case(prop_name)
        child_camel  = to_camel_case(prop_name)
        child_title_label = ' '.join(w.capitalize() for w in prop_name.split('_'))
        child_def    = _raw_def(child_name, schema)
        child_props_dict = child_def.get('properties', {})
        is_m2m = (c.get('relationship') or {}).get('type') == 'many-to-many'
        is_list = c.get('output_type') == 'list'
        is_self = child_name == model
        rel = c.get('relationship') or {}

        if c.get('use_connect') and is_list:
            if is_m2m:
                autocomplete_target = rel['target']
                # label_field for m2m comes from x-relationships labelField config
                ac_label_field = rel.get('label_field', 'name')
            elif is_self:
                autocomplete_target = model
                # self-referential: use the self-relationship's label_field
                self_rel_info = next((r for r in parent_rels_raw if r['target'] == model), None)
                ac_label_field = self_rel_info.get('label_field', 'name') if self_rel_info else 'name'
            else:  # optional FK list
                autocomplete_target = child_name
                # for optional-FK lists, look for a labelField in the child's x-relationship back to this entity,
                # otherwise fall back to 'name'
                ac_label_field = 'name'
            ac_secondary = rel.get('secondary_label_field') if is_m2m else None
            target_pascal = to_pascal_case(autocomplete_target)
            self_rel = next((r for r in parent_rels_raw if r['target'] == model), None) if is_self else None
            filter_logic = f'.filter(item => !item.{self_rel["prop_name"]} || item.{self_rel["prop_name"]} === src.id)' if self_rel else ''
            ac_built = build_label_expression('item', ac_label_field, autocomplete_target, schema)
            if ac_built['has_format']:
                uses_format_label_value = True
            if ac_secondary and isinstance(ac_label_field, str) and '.' not in ac_label_field:
                _sec_parts = ac_secondary.split('.')
                _sec_rel, _sec_field = _sec_parts[0], _sec_parts[1] if len(_sec_parts) > 1 else 'name'
                ac_label_expr = f"{ac_built['expression']} + (item.{_sec_rel} ? ` - ${{item.{_sec_rel}.{_sec_field}}}` : '')"
            else:
                ac_label_expr = ac_built['expression']
            # Server-search variant: pass initialAutocompleteOptions (limited initial set
            # mapped to {id, label}) and a wrapped searchOptions action. Self-referential
            # filtering (avoid picking your own row) is preserved on top of the server
            # results client-side via excludeOptionIds.
            search_action_var = f'search{target_pascal}Options'
            initial_data_var  = f'initial{target_pascal}s'
            _ch_prop_def = model_def.get('properties', {}).get(prop_name, {})
            _ch_width_cols = _ui_width_cols(_ch_prop_def)
            if _ch_width_cols:
                has_box_import = True
            _ch_m2m_jsx = (
                f"      <EditableListWrapper\n"
                f"        ref={{{child_var}Ref}}\n"
                f"        initialItems={{localInitial{child_pascal}}}\n"
                f"        itemType=\"autocomplete\"\n"
                f"        addButtonLabel=\"Add {child_title_label}\"\n"
                f"        showTitle={{true}}\n"
                f"        title={{tf('{child_camel}')}}\n"
                f"        textFieldLabel=\"Name\"\n"
                f"        textFieldPlaceholder=\"Enter name\"\n"
                f"        searchOptions={{async (query, includeIds) => {{\n"
                f"          const rows = (await {search_action_var}?.(query, includeIds)) ?? [];\n"
                f"          return rows{filter_logic}.map(item => ({{ id: item.id, label: {ac_label_expr} }}));\n"
                f"        }}}}\n"
                f"        initialAutocompleteOptions={{({initial_data_var} ?? []){filter_logic}.map(item => ({{\n"
                f"          id: item.id,\n"
                f"          label: {ac_label_expr},\n"
                f"        }}))}}\n"
                f"        excludeOptionIds={{[src.id]}}\n"
                f"      />"
            )
            child_grid_components_parts.append(_maybe_box_wrap(_ch_m2m_jsx, _ch_width_cols))
            continue

        if is_list:
            ft = c.get('file_type')
            has_order = 'order' in child_props_dict
            list_comp = 'OrderedEditableListWrapper' if has_order else 'EditableListWrapper'
            _ch_prop_def = model_def.get('properties', {}).get(prop_name, {})
            _ch_width_cols = _ui_width_cols(_ch_prop_def)
            if _ch_width_cols:
                has_box_import = True
            if ft:
                accepted = ('image/jpeg,image/png,image/gif,image/webp' if ft == 'image'
                            else '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip')
                _ch_list_jsx = (
                    f"      <{list_comp}\n"
                    f"        ref={{{child_var}Ref}}\n"
                    f"        initialItems={{localInitial{child_pascal}}}\n"
                    f"        itemType=\"file\"\n"
                    f"        fileVariant=\"{ft}\"\n"
                    f"        acceptedFileTypes=\"{accepted}\"\n"
                    f"        addButtonLabel=\"Add {child_title_label}\"\n"
                    f"        showTitle={{true}}\n"
                    f"        title={{tf('{child_camel}')}}\n"
                    f"      />"
                )
            else:
                _ch_list_jsx = (
                    f"      <{list_comp}\n"
                    f"        ref={{{child_var}Ref}}\n"
                    f"        initialItems={{localInitial{child_pascal}}}\n"
                    f"        itemType=\"text\"\n"
                    f"        addButtonLabel=\"Add {child_title_label}\"\n"
                    f"        showTitle={{true}}\n"
                    f"        title={{tf('{child_camel}')}}\n"
                    f"        textFieldLabel=\"Name\"\n"
                    f"        textFieldPlaceholder=\"Enter name\"\n"
                    f"      />"
                )
            child_grid_components_parts.append(_maybe_box_wrap(_ch_list_jsx, _ch_width_cols))
            continue

        # Grid child
        has_order = 'order' in child_props_dict
        grid_comp = 'OrderedFieldsDataGrid' if has_order else 'FieldsDataGrid'
        child_grid_components_parts.append(
            f"      <{grid_comp}\n"
            f"        ref={{{child_var}Ref}}\n"
            f"        initialFields={{localInitial{child_pascal}}}\n"
            f"        columns={{{child_var}Columns}}\n"
            f"        createNewRow={{createNew{child_pascal}}}\n"
            f"        addButtonLabel=\"Add {child_title_label}\"\n"
            f"        deleteDialogTitle=\"Delete Selected {child_title_label}?\"\n"
            f"        deleteDialogMessage=\"Are you sure you want to delete the selected item(s)? This action cannot be undone.\"\n"
            f"        showTitle={{true}}\n"
            f"        title={{tf('{child_camel}')}}\n"
            f"      />"
        )

    child_grid_components = '\n'.join(child_grid_components_parts)

    # Read-only JSX for independent mandatory-FK list children (isEdit-guarded, no add/delete)
    indep_list_readonly_parts = []
    for c in indep_list_ch:
        prop = c['property_name']
        child_camel = to_camel_case(prop)
        ft = c.get('file_type')
        rel = c.get('relationship') or {}
        _indep_prop_def = model_def.get('properties', {}).get(prop, {})
        _indep_width_cols = _ui_width_cols(_indep_prop_def)
        if _indep_width_cols:
            has_box_import = True
        if ft:
            _indep_jsx = (
                f"      {{isEdit && (\n"
                f"        <ListWrapper\n"
                f"          items={{src.{prop}.map(f => ({{\n"
                f"            id: f.id,\n"
                f"            value: f.path,\n"
                f"            label: f.name,\n"
                f"          }}))}}\n"
                f"          itemType=\"file\"\n"
                f"          fileVariant=\"{ft}\"\n"
                f"          showTitle={{true}}\n"
                f"          title={{tf('{child_camel}')}}\n"
                f"        />\n"
                f"      )}}"
            )
        else:
            _lf = rel.get('label_field', 'name')
            _target = rel.get('target', c.get('name', ''))
            _built = build_label_expression('f', _lf, _target, schema)
            _view_val = _built['expression']
            if _built['has_format']:
                uses_format_label_value = True
            _indep_jsx = (
                f"      {{isEdit && (\n"
                f"        <ListWrapper\n"
                f"          items={{src.{prop}.map(f => ({{\n"
                f"            id: f.id,\n"
                f"            value: {_view_val},\n"
                f"            label: {_view_val},\n"
                f"          }}))}}\n"
                f"          itemType=\"text\"\n"
                f"          showTitle={{true}}\n"
                f"          title={{tf('{child_camel}')}}\n"
                f"        />\n"
                f"      )}}"
            )
        indep_list_readonly_parts.append(_maybe_box_wrap(_indep_jsx, _indep_width_cols))
    indep_list_readonly_jsx = '\n'.join(indep_list_readonly_parts)

    # FormUpsert params signature.
    # Each selection target / selector OTO target now contributes:
    #   - initial{Xxx}s   : Xxx[] (limited initial set fetched server-side)
    #   - search{Xxx}Options : (query, includeIds) => Promise<Xxx[]>
    # The page server-fetches both and passes them as props.
    _all_targets = list(selection_targets) + [r['target'] for r in selector_oto_rels]
    # Dedupe while preserving order
    _seen: set[str] = set()
    _ordered_targets: list[str] = []
    for _t in _all_targets:
        if _t not in _seen:
            _seen.add(_t)
            _ordered_targets.append(_t)
    _initial_props = [f"initial{to_pascal_case(t)}s = []" for t in _ordered_targets]
    _search_props  = [f"search{to_pascal_case(t)}Options" for t in _ordered_targets]
    extra_default_props = ', '.join(_initial_props + _search_props)
    entity_edit_components = ctx.get('entity_edit_components') or []
    has_current_user_role_ids = bool(entity_edit_components)
    # Bridge children receive parent context (set on the create form by the
    # parent-embedded grid via /new?parentType=&parentId=).
    _is_bridge_child = bool(_bridge_child_ir)
    _bridge_params = ', initialParentType, initialParentId' if _is_bridge_child else ''
    if extra_default_props or has_comment_children or has_current_user_role_ids or _is_bridge_child:
        form_upsert_params = (
            f"{{ src, isEdit, permissions"
            + (', currentUserId' if has_comment_children else '')
            + (', currentUserRoleIds' if has_current_user_role_ids else '')
            + (f', {extra_default_props}' if extra_default_props else '')
            + _bridge_params
            + " }: FormUpsertProps"
        )
    else:
        form_upsert_params = "{ src, isEdit, permissions }: FormUpsertProps"

    # Validation call
    validation_entry_lines = ['    isEdit,', '    id: src.id,']
    validation_entry_lines.extend(f"    {p}: {p}Ref.current?.value || ''," for p in text_props)
    validation_entry_lines.extend(f"    {p}: {p}Ref.current?.value || ''," for p in number_props)
    validation_entry_lines.extend(f"    {p}: {safe_var_name(p)}," for p in date_time_props)
    validation_entry_lines.extend(f"    {p}: {safe_var_name(p)}," for p in image_props)
    validation_entry_lines.extend(f"    {r['prop_name']}: {safe_var_name(r['prop_name'])}," for r in parent_rels_raw)
    validation_entry_lines.extend(f"    {r['prop_name']}: {safe_var_name(r['prop_name'])}," for r in selector_oto_rels)
    validation_entry_lines.extend(f"    {p}: {safe_var_name(p)}," for p in boolean_props)
    validation_entry_lines.extend(f"    {p}: {safe_var_name(p)}," for p in enum_int_props)
    validation_entry_lines.extend(f"    {p}: {safe_var_name(p)}," for p in enum_str_props)
    validation_entry_lines.extend(f"    {p}: {safe_var_name(p)}," for p in custom_upsert_props)
    validation_entry_lines.extend(f"    {p}: {safe_var_name(p)}," for p in entity_select_props)
    val_entries = '\n'.join(validation_entry_lines)
    validation_call = f"  const getValidationError = () => validateForm({{\n{val_entries}\n  }});"

    # Comment children JSX
    comment_jsx_parts = []
    comment_add_id_expr = 'src.id'  # default: old pattern uses parent entity id
    has_reactions = bool(ctx.get('named_constants'))
    # toggle{Parent}CommentReaction's `type` param is the precise reaction-enum
    # literal union (see generators.reaction_type_ts) — narrower than the shared
    # CommentListWrapper's `string | number` callback signature. TS's strict
    # (contravariant) function-parameter checking rejects the plain function
    # reference here even though it's runtime-safe (the UI only ever forwards
    # values that already came from COMMENT_REACTION_TYPES), hence the cast.
    _reaction_props = (
        f"          reactionTypes={{[...COMMENT_REACTION_TYPES]}}\n"
        f"          onToggleReaction={{toggle{parent_pascal}CommentReaction as (commentId: string, type: string | number) => Promise<CommentReactionSummary>}}\n"
        if has_reactions else ""
    )
    for c in comment_children:
        if c.get('bridge'):
            prop = c['property_name']
            comment_add_id_expr = f'src.{prop}!.id'
            comment_jsx_parts.append(
                f"      {{isEdit && (\n"
                f"        <CommentListWrapper\n"
                f"          comments={{src.{prop}?.comments ?? []}}\n"
                f"          showTitle={{true}}\n"
                f"          title={{tf('comments')}}\n"
                f"          currentUserId={{currentUserId}}\n"
                f"          permissions={{{{ create: permissions?.update ?? false, delete: permissions?.update ?? false }}}}\n"
                f"          onCreateComment={{handleCreateComment}}\n"
                f"          onUpdateComment={{handleUpdateComment}}\n"
                f"          onDeleteComment={{handleDeleteComment}}\n"
                f"{_reaction_props}"
                f"        />\n"
                f"      )}}"
            )
        else:
            prop = c['property_name']
            child_camel = to_camel_case(prop)
            comment_jsx_parts.append(
                f"      {{isEdit && (\n"
                f"        <CommentListWrapper\n"
                f"          comments={{src.{prop}}}\n"
                f"          showTitle={{true}}\n"
                f"          title={{tf('{child_camel}')}}\n"
                f"          currentUserId={{currentUserId}}\n"
                f"          permissions={{{{ create: permissions?.update ?? false, delete: permissions?.update ?? false }}}}\n"
                f"          onCreateComment={{handleCreateComment}}\n"
                f"          onUpdateComment={{handleUpdateComment}}\n"
                f"          onDeleteComment={{handleDeleteComment}}\n"
                f"{_reaction_props}"
                f"        />\n"
                f"      )}}"
            )

    custom_upsert_imports = '\n'.join(
        f"import {to_pascal_case(p)} from './{p}';" for p in custom_upsert_props
    )

    # ---- Flatten edit sections (non-m2o only, edit-mode accordion) ----
    flatten_rels_raw = ctx.get('flatten_rels', [])
    non_m2o_flatten = [r for r in flatten_rels_raw if not r['is_m2o']]
    has_flatten_accordion_upsert = bool(non_m2o_flatten)

    flatten_edit_states_lines: list[str] = []
    flatten_enum_ns_hooks_upsert: list[str] = []
    flatten_enum_ns_seen_upsert: set[str] = set()
    flatten_enum_opt_setups_upsert: list[str] = []
    flatten_edit_form_data_sets_blocks: list[str] = []
    flatten_edit_section_parts: list[str] = []
    flatten_validation_parts: list[str] = []
    flatten_needs_datetime = False
    flatten_needs_boolean = False
    flatten_needs_autocomplete = False
    flatten_needs_number_field = False

    def _flatten_field_ts_type(f: dict) -> str:
        ftype = f['prop_type']
        fmt   = f.get('format')
        null  = f.get('nullable', True)
        sfx   = ' | null' if null else ''
        if ftype == 'string' and fmt in ('date', 'date-time', 'time'):
            return f'Date{sfx}'
        if ftype in ('integer', 'number'):
            return f'number{sfx}'
        if ftype == 'boolean':
            return 'boolean'
        return f'string{sfx}'

    for _flat in non_m2o_flatten:
        _prop   = _flat['prop_name']
        _target = _flat['target']
        _fields = _flat['fields']
        _rel_camel = to_camel_case(_prop)
        _target_props = _raw_def(_target, schema).get('properties', {})

        _accordion_fields_jsx: list[str] = []
        _rel_fds_lines: list[str] = []
        _all_filled_checks: list[str] = []       # any non-bool field is non-empty
        _mandatory_filled_checks: list[str] = [] # non-nullable non-bool fields are non-empty

        for _f in _fields:
            if _f.get('is_fk'):
                continue  # FK fields are read-only in edit view

            if _f.get('is_array'):
                # Array $ref (e.g., pre_check_detail.symptoms): render an
                # EditableListWrapper matching the standalone _detail
                # page's pattern. Items are submitted as repeated
                # `{prop}__{name}[]` form entries (one per item) — the
                # parent's actions.ts reads them via `data.getAll(...)`
                # as `string[]`, and the service translates them into
                # Prisma nested-create shape.
                _fname        = _f['name']
                _fcamel_label = to_camel_case(_fname)
                _item_target  = _f.get('item_target', '')
                _item_props   = _raw_def(_item_target, schema).get('properties', {})
                _item_label   = 'name' if 'name' in _item_props else 'id'
                _title_field  = to_title_case(_fname)
                _ref_var      = safe_var_name(f'{_prop}_{_fname}') + 'Ref'
                _init_var     = f'localInitial{to_pascal_case(_prop)}{to_pascal_case(_fname)}'
                _form_key     = f'{_prop}__{_fname}'
                _rel_fds_lines.append(
                    f"    ({_ref_var}.current?.getItems() ?? []).forEach((it) => formData.append('{_form_key}[]', String(it.value ?? '')));"
                )
                # State declarations go before the JSX, alongside the
                # other flatten state.
                flatten_edit_states_lines.append(
                    f"  const {_ref_var} = useRef<{{ getItems: () => EditableListWrapperItem[] }}>(null);\n"
                    f"  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n"
                    f"  const [{_init_var}] = useState<EditableListWrapperItem[]>(() => (((src.{_prop} as any)?.{_fname} ?? []) as Array<{{ id: string; {_item_label}: string }}>).map((f) => ({{\n"
                    f"    id: f.id || `temp-${{Date.now()}}-${{Math.random()}}`,\n"
                    f"    value: f.{_item_label},\n"
                    f"    label: f.{_item_label},\n"
                    f"    originalId: f.id,\n"
                    f"  }})));"
                )
                _accordion_fields_jsx.append(
                    f"        <EditableListWrapper\n"
                    f"          ref={{{_ref_var}}}\n"
                    f"          initialItems={{{_init_var}}}\n"
                    f"          itemType=\"text\"\n"
                    f"          addButtonLabel=\"Add {_title_field}\"\n"
                    f"          showTitle={{true}}\n"
                    f"          title={{tf('{_fcamel_label}')}}\n"
                    f"          textFieldLabel=\"Name\"\n"
                    f"          textFieldPlaceholder=\"Enter name\"\n"
                    f"        />"
                )
                continue

            _fname   = _f['name']
            _ftype   = _f['prop_type']
            _fmt     = _f.get('format')
            _nullable = _f.get('nullable', True)
            _enum_vals = _f.get('enum')
            _fk_label  = to_camel_case(_fname)
            _form_key  = f'{_prop}__{_fname}'
            _sn        = safe_var_name(f'{_prop}_{_fname}')
            _fsetter   = _setter(_sn)

            _is_date = _ftype == 'string' and _fmt in ('date', 'date-time', 'time')
            _is_bool = _ftype == 'boolean'
            _is_enum = _ftype in ('integer', 'number') and isinstance(_enum_vals, list)
            _is_num  = _ftype in ('integer', 'number') and not _is_enum

            if _is_date:
                flatten_needs_datetime = True
                if _fmt == 'date':
                    _init = (f"src.{_prop}?.{_fname} ? dayjs(new Date(src.{_prop}?.{_fname} as string | Date)"
                             f".toISOString().slice(0, 10) + 'T00:00:00') : null")
                else:
                    _init = f"src.{_prop}?.{_fname} ? dayjs(src.{_prop}?.{_fname}) : null"
                flatten_edit_states_lines.append(
                    f"  const [{_sn}, set{_fsetter}] = useState<Dayjs | null>({_init});"
                )
                if _fmt == 'date':
                    _rel_fds_lines.append(
                        f"    formData.set('{_form_key}', {_sn}?.format('YYYY-MM-DD') || '');"
                    )
                else:
                    _rel_fds_lines.append(
                        f"    formData.set('{_form_key}', {_sn}?.toISOString() || '');"
                    )
                _sd = '\n          show_date={false}' if _fmt == 'time' else ''
                _st = '\n          show_time={false}' if _fmt == 'date' else ''
                _accordion_fields_jsx.append(
                    f"        <DateTimeWrapper\n"
                    f"          label={{tf('{_fk_label}')}} {_sd}{_st}\n"
                    f"          date_time={{{_sn} ? {_sn}.toDate() : null}}\n"
                    f"          onChange={{(newValue: dayjs.Dayjs | null) => set{_fsetter}(newValue)}}\n"
                    f"        />"
                )
                _check = f"{_sn} !== null"
                _all_filled_checks.append(_check)
                if not _nullable:
                    _mandatory_filled_checks.append(_check)

            elif _is_bool:
                flatten_needs_boolean = True
                flatten_edit_states_lines.append(
                    f"  const [{_sn}, set{_fsetter}] = useState<boolean>(Boolean(src.{_prop}?.{_fname}));"
                )
                _rel_fds_lines.append(
                    f"    formData.set('{_form_key}', {_sn}.toString());"
                )
                _accordion_fields_jsx.append(
                    f"        <AppFieldBoolean\n"
                    f"          label={{tf('{_fk_label}')}}\n"
                    f"          checked={{{_sn}}}\n"
                    f"          onChange={{(e) => set{_fsetter}(e.target.checked)}}\n"
                    f"        />"
                )
                # booleans always have a value — excluded from filled/mandatory checks

            elif _is_enum:
                flatten_needs_autocomplete = True
                flatten_edit_states_lines.append(
                    f"  const [{_sn}, set{_fsetter}] = useState<number | null>(src.{_prop}?.{_fname} ?? null);"
                )
                _rel_fds_lines.append(
                    f"    formData.set('{_form_key}', {_sn} !== null ? String({_sn}) : '');"
                )
                _opts_var = f'{_sn}Options'
                _full_prop = _target_props.get(_fname, {})
                _ns = _full_prop.get('x-enum-namespace')
                if _ns and _ns not in flatten_enum_ns_seen_upsert:
                    flatten_enum_ns_seen_upsert.add(_ns)
                    flatten_enum_ns_hooks_upsert.append(f"  const t{_ns} = useTranslations('{_ns}');")
                if _ns:
                    _opts = ', '.join(
                        (f"{{ value: {(v if isinstance(v, (int, float)) else (i if not str(v).lstrip('-').isdigit() else int(v)))}, "
                         f"label: t{_ns}('{(v.lower()[0]+v[1:] if isinstance(v, str) and not str(v).lstrip('-').isdigit() else str(v))}') }}")
                        for i, v in enumerate(_enum_vals)
                    )
                else:
                    _opts = ', '.join(_int_enum_option(v, i) for i, v in enumerate(_enum_vals))
                flatten_enum_opt_setups_upsert.append(f"  const {_opts_var} = [{_opts}];")
                _accordion_fields_jsx.append(
                    f"        <AppFieldSelect\n"
                    f"          options={{{_opts_var}}}\n"
                    f"          value={{{_opts_var}.find((o) => o.value === {_sn}) ?? null}}\n"
                    f"          onChange={{(newValue) => set{_fsetter}(newValue)}}\n"
                    f"          label={{tf('{_fk_label}')}}\n"
                    f"        />"
                )
                _check = f"{_sn} !== null"
                _all_filled_checks.append(_check)
                if not _nullable:
                    _mandatory_filled_checks.append(_check)

            elif _is_num:
                flatten_needs_number_field = True
                _ref_var = f'{_sn}Ref'
                flatten_edit_states_lines.append(
                    f"  const {_ref_var} = useRef<HTMLInputElement>(null);"
                )
                _rel_fds_lines.append(
                    f"    formData.set('{_form_key}', {_ref_var}.current?.value || '');"
                )
                _full_prop = _target_props.get(_fname, {})
                _mn = _full_prop.get('minimum', 0)
                _mx = _full_prop.get('maximum', 2147483647)
                _is_float = _ftype == 'number'
                _step_str = '\n          step={0.01}' if _is_float else ''
                _accordion_fields_jsx.append(
                    f"        <NumberField\n"
                    f"          label={{tf('{_fk_label}')}}\n"
                    f"          inputRef={{{_ref_var}}}\n"
                    f"          defaultValue={{src.{_prop}?.{_fname} ?? undefined}}\n"
                    f"          min={{{_mn}}}\n"
                    f"          max={{{_mx}}}{_step_str}\n"
                    f"        />"
                )
                _check = f"({_ref_var}.current?.value ?? '') !== ''"
                _all_filled_checks.append(_check)
                if not _nullable:
                    _mandatory_filled_checks.append(_check)

            else:
                # Text field — use ref
                _ref_var = f'{_sn}Ref'
                flatten_edit_states_lines.append(
                    f"  const {_ref_var} = useRef<HTMLInputElement>(null);"
                )
                _rel_fds_lines.append(
                    f"    formData.set('{_form_key}', {_ref_var}.current?.value || '');"
                )
                _ui_rows_flat = (_target_props.get(_fname, {}).get('x-ui') or {}).get('rows')
                if _ui_rows_flat is not None:
                    _ml = 'true'
                    _rows = str(int(_ui_rows_flat))
                else:
                    _ml  = 'true' if _fname == 'description' else 'false'
                    _rows = '4'   if _fname == 'description' else 'undefined'
                _accordion_fields_jsx.append(
                    f"        <AppFieldText\n"
                    f"          label={{tf('{_fk_label}')}}\n"
                    f"          inputRef={{{_ref_var}}}\n"
                    f"          defaultValue={{src.{_prop}?.{_fname} || ''}}\n"
                    f"          multiline={{{_ml}}}\n"
                    f"          rows={{{_rows}}}\n"
                    f"        />"
                )
                _check = f"({_ref_var}.current?.value ?? '') !== ''"
                _all_filled_checks.append(_check)
                if not _nullable:
                    _mandatory_filled_checks.append(_check)

        if _accordion_fields_jsx:
            flatten_edit_section_parts.append(
                f"      <AppSection label={{te('{_rel_camel}')}}>\n"
                + '\n'.join(_accordion_fields_jsx) + '\n'
                + f"      </AppSection>"
            )

        if _rel_fds_lines:
            flatten_edit_form_data_sets_blocks.append('\n'.join(_rel_fds_lines))

        # Validation: if any non-bool field has a value, all mandatory ones must be filled
        if _all_filled_checks and _mandatory_filled_checks:
            _rel_label = ' '.join(w.capitalize() for w in _prop.split('_'))
            _any_expr = ' ||\n      '.join(_all_filled_checks)
            _all_mandatory_expr = ' &&\n      '.join(_mandatory_filled_checks)
            flatten_validation_parts.append(
                f"    if (\n"
                f"      ({_any_expr}) &&\n"
                f"      !({_all_mandatory_expr})\n"
                f"    ) {{\n"
                f"      setError('{_rel_label}: all required fields must be filled when providing data.');\n"
                f"      return;\n"
                f"    }}"
            )

    # Merge flatten states/opts into existing strings
    _flatten_states_str = '\n'.join(flatten_edit_states_lines)
    all_states_merged = '\n'.join(filter(None, [all_states, _flatten_states_str]))
    _flatten_fds_str = '\n'.join(flatten_edit_form_data_sets_blocks)
    parent_form_data_sets_merged = '\n'.join(filter(None, [parent_form_data_sets, _flatten_fds_str]))
    if _bridge_child_ir:
        _bridge_fds = (
            "    formData.set('selectedParentType', selectedParentTypeRef.current?.value || '');\n"
            "    formData.set('selectedParentId', selectedParentIdRef.current?.value || '');"
        )
        parent_form_data_sets_merged = '\n'.join(filter(None, [parent_form_data_sets_merged, _bridge_fds]))
    _all_enum_ns_hooks = '\n'.join(enum_ns_hooks + flatten_enum_ns_hooks_upsert)
    _all_enum_opt_setups = '\n'.join(enum_opt_setups + entity_select_opt_setups + flatten_enum_opt_setups_upsert)
    _flatten_validation_code = '\n\n'.join(flatten_validation_parts)
    _child_validation_code_merged = '\n\n'.join(filter(None, [child_validation_code, _flatten_validation_code]))

    return {
        'parent_refs':              parent_refs,
        'all_states':               all_states_merged,
        'all_parent_fields_jsx':    all_parent_fields_jsx,
        'parent_form_data_sets':    parent_form_data_sets_merged,
        'child_variables':          child_variables,
        'child_imports':            child_imports,
        'child_grid_setup':         child_grid_setup,
        'child_form_data_handling': child_form_data_handling,
        'child_validation_code':    _child_validation_code_merged,
        'child_grid_components':    child_grid_components,
        'has_indep_list_children':  has_indep_list_children,
        'indep_list_readonly_jsx':  indep_list_readonly_jsx,
        'form_upsert_params':       form_upsert_params,
        'enum_ns_hooks':            _all_enum_ns_hooks,
        'enum_opt_setups':          _all_enum_opt_setups,
        'rel_opt_setups':           '\n'.join(rel_opt_setups),
        'child_entity_rel_opt':     child_entity_rel_option_setups,
        'validation_call':          validation_call,
        'comment_children_jsx':     '\n'.join(comment_jsx_parts),
        'comment_add_id_expr':      comment_add_id_expr,
        'custom_upsert_imports':    custom_upsert_imports,
        'has_children':             has_children,
        'has_comment_children':     has_comment_children,
        'has_many_to_one':          has_many_to_one or bool(enum_int_props) or bool(enum_str_props) or bool(entity_select_props) or flatten_needs_autocomplete,
        'has_field_select':         bool(enum_int_props) or bool(enum_str_props) or bool(entity_select_props) or flatten_needs_autocomplete,
        'has_entity_autocomplete':  bool(parent_rels_raw) or bool(selector_oto_rels),
        'has_child_entity_autocomplete': bool(child_entity_rel_opt),
        'has_datetime_props':       bool(date_time_props) or flatten_needs_datetime,
        'has_image_props':          bool(image_props),
        'has_number_props':         bool(number_props) or flatten_needs_number_field,
        'has_boolean_props':        bool(boolean_props) or flatten_needs_boolean,
        'has_flatten_accordion_upsert': has_flatten_accordion_upsert,
        'flatten_edit_sections':    '\n'.join(flatten_edit_section_parts),
        'uses_format_label_value':  uses_format_label_value,
        'has_box_import':           has_box_import,
    }
