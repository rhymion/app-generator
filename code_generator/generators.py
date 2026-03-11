"""
generators.py — Per-generator context extension functions.

Each function takes the base context dict (from build_context) and returns
an extended dict with the generator-specific computed strings that templates
need.  This keeps complex Python logic out of Jinja2.
"""

from helpers.naming import (
    to_camel_case, to_pascal_case, to_pascal_case_from_var,
    safe_var_name, singularize,
)
from helpers.type_mapping import get_ts_type
from helpers.schema_helpers import get_parent_relationships


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _get_actual_type(defn: dict) -> str | None:
    t = defn.get('type')
    return next((x for x in t if x != 'null'), None) if isinstance(t, list) else t


def _is_nullable(defn: dict) -> bool:
    t = defn.get('type')
    return isinstance(t, list) and 'null' in t


def _has_string_labels(enum_values) -> bool:
    return any(isinstance(v, str) and not str(v).lstrip('-').isdigit() for v in (enum_values or []))


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

def page_list_context(ctx: dict) -> dict:
    parent     = ctx['parent']
    model_def  = ctx['model_def']
    gen_cfg    = ctx['gen_cfg']
    xdisplay_table = ctx.get('xdisplay_table')
    has_chart  = ctx['has_chart']
    parent_pascal = ctx['parent_pascal']
    parent_camel  = ctx['parent_camel']

    model_props = model_def.get('properties', {})
    formatting_entries = []
    enum_ns_list = []       # [{var_name, ns, keys}]
    display_fields_code = ''
    primary_field = ''

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
                fmt      = prop.get('format')
                enum_vals = prop.get('enum')
                enum_ns  = prop.get('x-enum-namespace')

                if actual in ('integer', 'number') and isinstance(enum_vals, list) and _has_string_labels(enum_vals):
                    if enum_ns:
                        keys = [
                            (v.lower()[0] + v[1:] if isinstance(v, str) and not v.lstrip('-').isdigit() else str(v))
                            for v in enum_vals
                        ]
                        var_name = f'{to_camel_case(field_name)}Labels'
                        # avoid duplicates
                        if not any(e['var_name'] == var_name for e in enum_ns_list):
                            enum_ns_list.append({'var_name': var_name, 'ns': enum_ns, 'keys': keys})
                        formatting_entries.append(f'    {field_name}: {var_name}[item.{field_name} as number] ?? \'\',')
                    else:
                        labels = ', '.join(f"'{v}'" for v in enum_vals)
                        formatting_entries.append(f"    {field_name}: ([{labels}] as const)[item.{field_name} as number] ?? '',")
                elif actual == 'string' and fmt in ('date', 'date-time', 'time'):
                    formatting_entries.append(
                        f"    {field_name}: item.{field_name} ? new Date(item.{field_name}).toLocaleString('sv-SE') : '',"
                    )

            if config.get('primary'):
                primary_field = field_name

            fields_code_parts.append(f"          {{ field: '{field_name}', headerName: tf('{field_key}'), width: {width} }}")

        display_fields_code = ',\n'.join(fields_code_parts)

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

    sep = ', ' if (parent_params and child_args) else ''
    full_child_args = f'{sep}{child_args}' if child_args else ''

    def _upsert_body(has_ch: bool) -> str:
        if can_create and can_update:
            create_call = f'await add{parent_pascal}(userId, {parent_params}{full_child_args});'
            update_call = f'await update{parent_pascal}(userId, id, {parent_params}{full_child_args}, srcSnapshotRaw);'
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
                + (f"{child_form_data_extractions}\n" if has_ch else "") +
                f"  const userId = await getSessionUserIdOrThrow();\n\n"
                f"  if (id) {{\n"
                f"    {update_call}\n"
                f"  }} else {{\n"
                f"    {create_call}\n"
                f"  }}"
            )
        elif can_update:
            return (
                f"  const id = data.get('id') as string | null;\n"
                f"  const srcSnapshotRaw = data.get('__src_snapshot') as string | null;\n"
                f"  if (!id) throw new Error('Create not supported');\n"
                f"  const existing = await prisma.{model}.findUnique({{ where: {{ id }}, select: {item_context_select} }});\n"
                f"  await requirePermission('{parent}', 'update', existing);\n"
                f"{form_data_gets}\n"
                + (f"{child_form_data_extractions}\n" if has_ch else "") +
                f"\n  const userId = await getSessionUserIdOrThrow();\n"
                f"  await update{parent_pascal}(userId, id, {parent_params}{full_child_args}, srcSnapshotRaw);"
            )
        else:  # create only
            return (
                f"  await requirePermission('{parent}', 'create');\n"
                f"{form_data_gets}\n"
                + (f"{child_form_data_extractions}\n" if has_ch else "") +
                f"\n  const userId = await getSessionUserIdOrThrow();\n"
                f"  await add{parent_pascal}(userId, {parent_params}{full_child_args});"
            )

    service_fns = [
        f'add{parent_pascal}'    if can_create else '',
        f'update{parent_pascal}' if can_update else '',
        f'delete{parent_pascal}' if can_delete else '',
    ]
    service_imports = ', '.join(f for f in service_fns if f)

    return {
        'service_imports': service_imports,
        'upsert_body': _upsert_body(has_children),
    }


# ---------------------------------------------------------------------------
# service.ts
# ---------------------------------------------------------------------------

def service_context(ctx: dict) -> dict:
    parent                  = ctx['parent']
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

    has_non_comment_ch = bool(non_comment_ch)

    utility_code = (
        f"import prisma from '@/lib/prisma';\n"
        f"import {{ normalizeValue,{' normalizeChildRefs,' if has_non_comment_ch else ''}"
        f"{' assertNotStale,' if can_update else ''} type NormalizedSnapshot }} from '@/lib/normalize';"
        + (f"\nimport {{ validateOnAdd, validateOnUpdate }} from './service_validation';" if (can_create or can_update) else '') +
        f"\n\ntype TransactionClient = Pick<typeof prisma, '{model}'>;\n\n"
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
        'utility_code':           utility_code,
        'child_params_for_add':   child_params_for_add,
        'child_params_for_update': child_params_for_update,
    }


# ---------------------------------------------------------------------------
# column_def.tsx
# ---------------------------------------------------------------------------

def column_def_context(ctx: dict, schema: dict) -> dict:
    model            = ctx['model']
    non_comment_ch   = ctx['non_comment_ch']
    parent_rels_raw  = ctx['parent_rels_raw']

    needs_datetime_imports = False
    column_children = []

    for child_raw in non_comment_ch:
        child_name = child_raw['name']
        prop_name  = child_raw['property_name']
        child_def  = schema['definitions'].get(child_name, {})
        child_props = child_def.get('properties', {})

        if not child_props:
            column_children.append({
                'fn_code': (
                    f"export function {prop_name}_columns(editable: boolean = false): GridColDef[] {{\n"
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
                rel_params.append(f"{param_camel}Options?: Array<{{ value: string | null; label: string }}>")

        columns = []
        for key, prop in child_props.items():
            if key in ('id', f'{model}_id', 'created_at', 'updated_at', 'creator_id'):
                continue

            rel = prop.get('x-relationship', {})
            if rel.get('type') == 'many-to-one':
                label_base  = key.removesuffix('_id')
                header_camel = to_camel_case(label_base)
                prop_camel  = to_camel_case(key)
                param_name  = f'{prop_camel}Options'
                columns.append(
                    f"    ...({param_name} && {param_name}.length > 0\n"
                    f"      ? [{{ field: '{key}', headerName: t('{header_camel}'), width: 200, editable: editable, type: 'singleSelect' as const, valueOptions: {param_name} }}]\n"
                    f"      // eslint-disable-next-line @typescript-eslint/no-explicit-any\n"
                    f"      : [{{ field: '{key}', headerName: t('{header_camel}'), width: 200, editable: false, valueGetter: (_value: any, row: any) => row.{label_base}?.name ?? '' }}]),"
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
                    f"      renderEditCell: (params: GridRenderEditCellParams) => (\n"
                    f"        <DateTimeWrapper\n"
                    f"          label={{t('{header_camel}')}}{show_date_str}\n"
                    f"          date_time={{params.value ? new Date(params.value) : null}}\n"
                    f"          onChange={{(newValue: dayjs.Dayjs | null) => {{\n"
                    f"            params.api.setEditCellValue({{\n"
                    f"              id: params.id,\n"
                    f"              field: params.field,\n"
                    f"              value: newValue ? newValue.toISOString() : ''\n"
                    f"            }});\n"
                    f"          }}}}\n"
                    f"        />\n"
                    f"      ),\n"
                    f"      valueFormatter: (value) => {{\n"
                    f"        if (!value) return '';\n"
                    f"        return dayjs(value).format('YYYY-MM-DD HH:mm');\n"
                    f"      }},\n"
                    f"    }},"
                )
            else:
                columns.append(f"    {{ field: '{key}', headerName: t('{header_camel}'), width: {width}, editable: editable }},")

        rel_params_str = (', ' + ', '.join(rel_params)) if rel_params else ''
        fn_code = (
            f"export function {prop_name}_columns(editable: boolean = false{rel_params_str}): GridColDef[] {{\n"
            f"  const t = useTranslations('Fields');\n"
            f"  return [\n"
            + '\n'.join(columns) +
            f"\n  ];\n"
            f"}}"
        )
        column_children.append({'fn_code': fn_code})

    return {
        'column_children': column_children,
        'needs_datetime_imports': needs_datetime_imports,
    }


# ---------------------------------------------------------------------------
# form_view.tsx
# ---------------------------------------------------------------------------

def form_view_context(ctx: dict) -> dict:
    parent        = ctx['parent']
    model         = ctx['model']
    parent_pascal = ctx['parent_pascal']
    parent_camel  = ctx['parent_camel']
    filtered_props = ctx['filtered_props']
    model_def     = ctx['model_def']
    parent_rels   = ctx['parent_rels']
    children_raw  = ctx['children_raw']

    rel_by_prop = {r['prop_name']: r for r in ctx['parent_rels_raw']}
    EXCLUDE = {'id', 'created_at', 'updated_at', 'creator_id'}
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
        else:
            other_flds.append(p)

    needs_datetime_wrapper = bool(date_time_flds)
    needs_image_display    = bool(image_flds)

    def _tf(p: str):
        return to_camel_case(p)

    # Text fields (incl. relationship display)
    text_jsxs = []
    for p in other_flds:
        fk = _tf(p)
        rel = rel_by_prop.get(p)
        if rel:
            label_f  = rel.get('labelField', 'name')
            label_fk = fk.removesuffix('Id')
            rel_name = rel.get('relation_name', p.removesuffix('_id'))
            text_jsxs.append(
                f"      <TextField\n        label={{tf('{label_fk}')}}\n"
                f"        value={{src.{rel_name}?.{label_f} || src.{p} || ''}}\n"
                f"        fullWidth\n        margin=\"normal\"\n        aria-readonly\n      />"
            )
        else:
            text_jsxs.append(
                f"      <TextField\n        label={{tf('{fk}')}}\n"
                f"        value={{src.{p} || ''}}\n"
                f"        fullWidth\n        margin=\"normal\"\n        aria-readonly\n      />"
            )

    # DateTime fields
    dt_jsxs = []
    for p in date_time_flds:
        fk  = _tf(p)
        fmt = filtered_props[p].get('format')
        show_time_attr = '' if fmt in ('date-time', 'time') else ' show_time={false}'
        show_date_attr = ' show_date={false}' if fmt == 'time' else ''
        dt_jsxs.append(
            f"      <DateTimeWrapper label={{tf('{fk}')}} date_time={{src.{p}}}{show_time_attr}{show_date_attr} readOnly />"
        )

    # Image fields
    img_jsxs = [f"      <ImageDisplay url={{src.{p}}} alt={{tf('{_tf(p)}')}} />" for p in image_flds]

    # Boolean fields
    bool_jsxs = [
        f"      <FormControlLabel\n        control={{<Checkbox checked={{Boolean(src.{p})}} readOnly />}}\n        label={{tf('{_tf(p)}')}}\n      />"
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
            f"      <TextField\n        label={{tf('{fk}')}}\n"
            f"        value={{{state_name}Options.find(o => o.value === src.{p})?.label ?? ''}}\n"
            f"        fullWidth\n        margin=\"normal\"\n        aria-readonly\n      />"
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
        '\n'.join(bool_jsxs),
        '\n'.join(dt_jsxs),
        '\n'.join(img_jsxs),
        '\n'.join(custom_jsxs),
    ]))

    # Children view grids
    has_comment_children = any(c.get('output_type') == 'comments' for c in children_raw)
    has_list_children    = any(c.get('output_type') == 'list' for c in children_raw)
    grid_children        = [c for c in children_raw if c.get('output_type') not in ('list', 'comments')]
    col_fn_names         = [f"{c['property_name']}_columns" for c in grid_children]

    child_view_grids = []
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
                child_view_grids.append(
                    f"      <div>\n"
                    f"        <ListWrapper\n"
                    f"          items={{src.{prop}.map(f => ({{\n"
                    f"            id: f.id,\n"
                    f"            value: f.name,\n"
                    f"            label: f.name,\n"
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
        f"  const {safe_var_name(c['property_name'])}Columns: GridColDef[] = {c['property_name']}_columns(false);"
        for c in grid_children
    )

    return {
        'needs_datetime_wrapper': needs_datetime_wrapper,
        'needs_image_display':    needs_image_display,
        'has_comment_children':   has_comment_children,
        'has_list_children':      has_list_children,
        'has_grid_children':      bool(grid_children),
        'col_fn_names':           col_fn_names,
        'view_enum_ns_hooks':     '\n'.join(enum_ns_hooks),
        'view_enum_opt_setups':   '\n'.join(enum_opt_setups),
        'all_parent_fields':      all_parent_fields,
        'child_view_grids':       '\n'.join(child_view_grids),
        'column_variables':       column_variables,
        'custom_view_imports':    custom_view_imports,
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
    children_raw  = ctx['children_raw']
    can_delete    = ctx['can_delete']
    selection_targets = ctx['selection_targets']

    cats = ctx['field_categories']
    EXCLUDE = {'id', 'created_at', 'updated_at', 'creator_id'}

    text_props        = cats['text']
    number_props      = cats['number']
    date_time_props   = cats['date_time']
    image_props       = cats['image']
    boolean_props     = cats['boolean']
    enum_int_props    = cats['enum_integer']
    custom_upsert_props = cats['custom_upsert']

    rel_prop_names = {r['prop_name'] for r in parent_rels_raw}

    # ---- States / Refs ----
    text_refs = '\n'.join(f"  const {p}Ref = useRef<HTMLInputElement>(null);" for p in text_props)
    number_refs = '\n'.join(f"  const {p}Ref = useRef<HTMLInputElement>(null);" for p in number_props)
    parent_refs = '\n'.join(filter(None, [text_refs, number_refs]))

    def _setter(var_name: str) -> str:
        return to_pascal_case_from_var(var_name)

    dt_states = '\n'.join(
        f"  const [{safe_var_name(p)}, set{_setter(safe_var_name(p))}] = useState<Dayjs | null>(src.{p} ? dayjs(src.{p}) : null);"
        for p in date_time_props
    )
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
    rel_states = '\n'.join(
        f"  const [{safe_var_name(r['prop_name'])}, set{_setter(safe_var_name(r['prop_name']))}] = useState<string | null>(src.{r['prop_name']} || null);"
        for r in parent_rels_raw
    )
    custom_states = '\n'.join(
        f"  const [{safe_var_name(p)}, set{_setter(safe_var_name(p))}] = useState<string>(src.{p} ?? '');"
        for p in custom_upsert_props
    )
    all_states = '\n'.join(filter(None, [dt_states, img_states, bool_states, enum_states, rel_states, custom_states]))

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
        if min_len is not None or max_len is not None:
            constraints = []
            if min_len is not None: constraints.append(f'minLength: {min_len}')
            if max_len is not None: constraints.append(f'maxLength: {max_len}')
            slot_str = f"\n        slotProps={{ {{ htmlInput: {{ {', '.join(constraints)} }} }} }}"
        multiline = 'true' if p == 'description' else 'false'
        rows = '4' if p == 'description' else 'undefined'
        text_jsxs.append(
            f"      <TextField\n"
            f"        label={{tf('{fk}')}}\n"
            f"        inputRef={{{p}Ref}}\n"
            f"        defaultValue={{src.{p} || ''}}\n"
            f"        fullWidth\n"
            f"        margin=\"normal\"\n"
            f"        {'required' if req else ''}{slot_str}\n"
            f"        multiline={{{multiline}}}\n"
            f"        rows={{{rows}}}\n"
            f"      />"
        )

    # Relationship fields (Autocomplete)
    rel_jsxs = []
    for r in parent_rels_raw:
        prop_name   = r['prop_name']
        label_base  = prop_name.removesuffix('_id')
        label_fk    = _tf(label_base)
        state_name  = safe_var_name(prop_name)
        setter      = _setter(state_name)
        target_pascal = to_pascal_case(r['target'])
        opts_var    = f'{state_name}Options'
        rel_jsxs.append(
            f"      <Autocomplete\n"
            f"        options={{{opts_var}}}\n"
            f"        value={{{opts_var}.find((option) => option.id === {state_name}) || null}}\n"
            f"        onChange={{(_, newValue) => set{setter}(newValue?.id ?? null)}}\n"
            f"        renderInput={{(params) => (\n"
            f"          <TextField\n"
            f"            {{...params}}\n"
            f"            label={{tf('{label_fk}')}}\n"
            f"            margin=\"normal\"\n"
            f"            {'required' if r.get('required') else ''}\n"
            f"          />\n"
            f"        )}}\n"
            f"      />"
        )

    # Number fields
    num_jsxs = []
    for p in number_props:
        prop = filtered_props[p]
        fk   = _tf(p)
        mn   = prop.get('minimum', 0)
        mx   = prop.get('maximum', 1000000)
        num_jsxs.append(
            f"      <NumberField\n"
            f"        label={{tf('{fk}')}}\n"
            f"        inputRef={{{p}Ref}}\n"
            f"        defaultValue={{src.{p} || 0}}\n"
            f"        min={{{mn}}}\n"
            f"        max={{{mx}}}\n"
            f"      />"
        )

    # DateTime fields
    dt_jsxs = []
    for p in date_time_props:
        prop    = filtered_props[p]
        fk      = _tf(p)
        sn      = safe_var_name(p)
        setter  = _setter(sn)
        fmt     = prop.get('format')
        show_date_str = '\n        show_date={false}' if fmt == 'time' else ''
        show_time_str = '\n        show_time={false}' if fmt == 'date' else ''
        dt_jsxs.append(
            f"      <DateTimeWrapper\n"
            f"        label={{tf('{fk}')}} {show_date_str}{show_time_str}\n"
            f"        date_time={{{sn} ? {sn}.toDate() : null}}\n"
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
            f"      <FormControlLabel\n"
            f"        control={{<Checkbox checked={{{sn}}} onChange={{(e) => set{setter}(e.target.checked)}} />}}\n"
            f"        label={{tf('{fk}')}}\n"
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
        req       = p in (model_def.get('required') or [])

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

        enum_int_jsxs.append(
            f"      <Autocomplete\n"
            f"        options={{{opts_var}}}\n"
            f"        value={{{opts_var}.find((o) => o.value === {sn}) ?? null}}\n"
            f"        onChange={{(_, newValue) => set{setter}(newValue?.value ?? null)}}\n"
            f"        renderInput={{(params) => (\n"
            f"          <TextField\n"
            f"            {{...params}}\n"
            f"            label={{tf('{fk}')}}\n"
            f"            margin=\"normal\"\n"
            f"            {'required' if req else ''}\n"
            f"          />\n"
            f"        )}}\n"
            f"      />"
        )

    for r in parent_rels_raw:
        prop_name    = r['prop_name']
        target_pascal = to_pascal_case(r['target'])
        label_field  = r.get('labelField', 'name')
        sn           = safe_var_name(prop_name)
        opts_var     = f'{sn}Options'
        rel_opt_setups.append(
            f"  const {opts_var} = useMemo(() => {{\n"
            f"    return all{target_pascal}s.map((item) => ({{\n"
            f"      id: item.id,\n"
            f"      label: item.{label_field},\n"
            f"    }}));\n"
            f"  }}, [all{target_pascal}s]);"
        )

    # Custom upsert fields
    custom_jsxs = []
    for p in custom_upsert_props:
        comp  = to_pascal_case(p)
        sn    = safe_var_name(p)
        setter = _setter(sn)
        custom_jsxs.append(f"      <{comp} value={{{sn}}} onChange={{set{setter}}} isEdit={{isEdit}} />")

    all_parent_fields_jsx = '\n'.join(filter(None, [
        '\n'.join(text_jsxs),
        '\n'.join(rel_jsxs),
        '\n'.join(num_jsxs),
        '\n'.join(enum_int_jsxs),
        '\n'.join(bool_jsxs),
        '\n'.join(dt_jsxs),
        '\n'.join(img_jsxs),
        '\n'.join(custom_jsxs),
    ]))

    # ---- FormData sets ----
    text_ds  = '\n'.join(f"    formData.set('{p}', {p}Ref.current?.value || '');" for p in text_props)
    num_ds   = '\n'.join(f"    formData.set('{p}', {p}Ref.current?.value || '');" for p in number_props)
    dt_ds    = '\n'.join(f"    formData.set('{p}', {safe_var_name(p)}?.toISOString() || '');" for p in date_time_props)
    img_ds   = '\n'.join(f"    formData.set('{p}', {safe_var_name(p)});" for p in image_props)
    rel_ds   = '\n'.join(f"    formData.set('{r['prop_name']}', {safe_var_name(r['prop_name'])} || '');" for r in parent_rels_raw)
    bool_ds  = '\n'.join(f"    formData.set('{p}', {safe_var_name(p)}.toString());" for p in boolean_props)
    enum_ds  = '\n'.join(f"    formData.set('{p}', {safe_var_name(p)} !== null ? String({safe_var_name(p)}) : '');" for p in enum_int_props)
    cust_ds  = '\n'.join(f"    formData.set('{p}', {safe_var_name(p)});" for p in custom_upsert_props)
    parent_form_data_sets = '\n'.join(filter(None, [text_ds, rel_ds, num_ds, enum_ds, bool_ds, dt_ds, img_ds, cust_ds]))

    # ---- Children analysis ----
    non_comment_ch = [c for c in children_raw if c.get('output_type') != 'comments']
    comment_children = [c for c in children_raw if c.get('output_type') == 'comments']
    has_comment_children = bool(comment_children)
    has_children = bool(non_comment_ch)
    has_many_to_many = any((c.get('relationship') or {}).get('type') == 'many-to-many' for c in children_raw)
    has_many_to_one = bool(parent_rels_raw)

    # Column fn names (grid children only)
    col_fn_names = [
        f"{c['property_name']}_columns"
        for c in non_comment_ch
        if c.get('output_type') not in ('list', None) or c.get('output_type') is None
        if c.get('output_type') != 'list' and (c.get('relationship') or {}).get('type') != 'many-to-many'
    ]

    # Ordered children detection
    has_ordered_ch = any(
        'order' in (schema['definitions'].get(c['name'], {}).get('properties') or {})
        for c in non_comment_ch
    )
    has_list_ch = any(
        c.get('output_type') == 'list' or (c.get('relationship') or {}).get('type') == 'many-to-many'
        for c in non_comment_ch
    )
    has_ordered_list_ch = any(
        c.get('output_type') == 'list' and (c.get('relationship') or {}).get('type') != 'many-to-many'
        and 'order' in (schema['definitions'].get(c['name'], {}).get('properties') or {})
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
        child_imports_parts.append("import { GridRowsProp } from '@mui/x-data-grid';")
        dg_import = (
            "import FieldsDataGrid from '@/components/_standard/FieldsDataGrid';\n"
            "import OrderedFieldsDataGrid from '@/components/_standard/OrderedFieldsDataGrid';"
            if has_ordered_ch else
            "import FieldsDataGrid from '@/components/_standard/FieldsDataGrid';"
        )
        child_imports_parts.append(dg_import)
    if col_fn_names:
        child_imports_parts.append(f"import {{ {', '.join(col_fn_names)} }} from '../{parent}/column_def';")
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
        child_def  = schema['definitions'].get(child_name, {})
        child_props_dict = child_def.get('properties', {})
        is_m2m     = (c.get('relationship') or {}).get('type') == 'many-to-many'
        is_list    = c.get('output_type') == 'list'
        is_self    = child_name == model

        if is_m2m or (is_list and is_self):
            child_grid_setup_parts.append(
                f"  const [initial{child_pascal}] = useState<EditableListWrapperItem[]>(() => src.{prop_name}.map(f => ({{\n"
                f"    id: f.id || `temp-${{Date.now()}}-${{Math.random()}}`,\n"
                f"    value: f.id,\n"
                f"    label: f.name,\n"
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
                    f"  const [initial{child_pascal}] = useState<EditableListWrapperItem[]>(() => src.{prop_name}.map(f => ({{\n"
                    f"    id: f.id || `temp-${{Date.now()}}-${{Math.random()}}`,\n"
                    f"    value: f.path,\n"
                    f"    label: f.name,\n"
                    f"    originalId: f.id,{order_line}\n"
                    f"  }})));"
                )
            else:
                child_grid_setup_parts.append(
                    f"  const [initial{child_pascal}] = useState<EditableListWrapperItem[]>(() => src.{prop_name}.map(f => ({{\n"
                    f"    id: f.id || `temp-${{Date.now()}}-${{Math.random()}}`,\n"
                    f"    value: f.name,\n"
                    f"    label: f.name,\n"
                    f"    originalId: f.id,{order_line}\n"
                    f"  }})));"
                )
            continue

        # Grid child — exclude the back-reference to the parent entity
        child_rels = [r for r in get_parent_relationships(child_def) if r['target'] != model]
        rel_opt_args = ', '.join(f'{to_camel_case(r["prop_name"])}Options' for r in child_rels)
        rel_args_str = f', {rel_opt_args}' if rel_opt_args else ''

        exclude_in_create = {f'{model}_id', 'id', 'created_at', 'updated_at', 'creator_id'}
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
                return "''"
            if actual in ('integer', 'number'):
                return 'null' if nullable else '0'
            return 'null'

        create_body = '\n'.join(
            f"    {p}: {_new_prop_val(p, child_props_dict[p])},"
            for p in create_props
        )

        child_grid_setup_parts.append(
            f"  const {child_var}Columns = {prop_name}_columns(true{rel_args_str});\n\n"
            f"  const [initial{child_pascal}] = useState<GridRowsProp>(() => src.{prop_name}.map(f => ({{ ...f, id: f.id || `temp-${{Date.now()}}-${{Math.random()}}` }})));\n\n"
            f"  const createNew{child_pascal} = () => ({{\n"
            f"    id: `temp-${{Date.now()}}-${{Math.random()}}`,\n"
            f"{create_body}\n"
            f"    {model}_id: src.id,\n"
            f"  }});"
        )

    child_grid_setup = '\n'.join(child_grid_setup_parts)

    # Child entity rel option setups (for child grid many-to-one dropdowns)
    from helpers.schema_helpers import get_parent_relationships as _gpr
    all_child_rels = []
    for c in non_comment_ch:
        if c.get('output_type') == 'list' or (c.get('relationship') or {}).get('type') == 'many-to-many':
            continue
        cdef = schema['definitions'].get(c['name'], {})
        all_child_rels.extend(r for r in _gpr(cdef) if r['target'] != model)
    seen_rel = set()
    child_entity_rel_opt = []
    for r in all_child_rels:
        if r['prop_name'] in seen_rel:
            continue
        seen_rel.add(r['prop_name'])
        prop_camel   = to_camel_case(r['prop_name'])
        target_pascal = to_pascal_case(r['target'])
        label_field  = r.get('labelField', 'name')
        opts_var     = f'{prop_camel}Options'
        child_entity_rel_opt.append(
            f"  const {opts_var} = useMemo(() =>\n"
            f"    (all{target_pascal}s ?? []).map(item => ({{ value: item.id, label: item.{label_field} }})),\n"
            f"  [all{target_pascal}s]);"
        )
    child_entity_rel_option_setups = '\n'.join(child_entity_rel_opt)

    # Child form data handling
    child_fdh_parts = []
    for c in non_comment_ch:
        child_name = c['name']
        prop_name  = c['property_name']
        child_var  = safe_var_name(prop_name)
        form_key   = singularize(prop_name)
        child_def  = schema['definitions'].get(child_name, {})
        child_props_dict = child_def.get('properties', {})
        is_m2m = (c.get('relationship') or {}).get('type') == 'many-to-many'
        is_list = c.get('output_type') == 'list'
        is_self = child_name == model

        if is_m2m or (is_list and is_self):
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
        exclude_ser = {f'{model}_id', 'id', 'created_at', 'updated_at', 'creator_id'}
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

    # Child grid components (JSX)
    child_grid_components_parts = []
    for c in non_comment_ch:
        child_name  = c['name']
        prop_name   = c['property_name']
        child_var   = safe_var_name(prop_name)
        child_pascal = to_pascal_case(prop_name)
        child_camel  = to_camel_case(prop_name)
        child_title_label = ' '.join(w.capitalize() for w in prop_name.split('_'))
        child_def    = schema['definitions'].get(child_name, {})
        child_props_dict = child_def.get('properties', {})
        is_m2m = (c.get('relationship') or {}).get('type') == 'many-to-many'
        is_list = c.get('output_type') == 'list'
        is_self = child_name == model
        rel = c.get('relationship') or {}

        if is_m2m:
            target = rel['target']
            target_pascal = to_pascal_case(target)
            child_grid_components_parts.append(
                f"      <EditableListWrapper\n"
                f"        ref={{{child_var}Ref}}\n"
                f"        initialItems={{initial{child_pascal}}}\n"
                f"        itemType=\"autocomplete\"\n"
                f"        addButtonLabel=\"Add {child_title_label}\"\n"
                f"        showTitle={{true}}\n"
                f"        title={{tf('{child_camel}')}}\n"
                f"        textFieldLabel=\"Name\"\n"
                f"        textFieldPlaceholder=\"Enter name\"\n"
                f"        allAutocompleteOptions={{all{target_pascal}s.map(item => ({{\n"
                f"          id: item.id,\n"
                f"          label: item.name,\n"
                f"          value: item.id,\n"
                f"        }}))}}\n"
                f"        excludeOptionIds={{[src.id]}}\n"
                f"      />"
            )
            continue

        if is_list and is_self:
            target_pascal = to_pascal_case(parent)
            self_rel = next((r for r in parent_rels_raw if r['target'] == model), None)
            filter_logic = f'.filter(item => !item.{self_rel["prop_name"]} || item.{self_rel["prop_name"]} === src.id)' if self_rel else ''
            child_grid_components_parts.append(
                f"      <EditableListWrapper\n"
                f"        ref={{{child_var}Ref}}\n"
                f"        initialItems={{initial{child_pascal}}}\n"
                f"        itemType=\"autocomplete\"\n"
                f"        addButtonLabel=\"Add {child_title_label}\"\n"
                f"        showTitle={{true}}\n"
                f"        title={{tf('{child_camel}')}}\n"
                f"        textFieldLabel=\"Name\"\n"
                f"        textFieldPlaceholder=\"Enter name\"\n"
                f"        allAutocompleteOptions={{all{target_pascal}s{filter_logic}.map(item => ({{\n"
                f"          id: item.id,\n"
                f"          label: item.name,\n"
                f"          value: item.id,\n"
                f"        }}))}}\n"
                f"        excludeOptionIds={{[src.id]}}\n"
                f"      />"
            )
            continue

        if is_list:
            ft = c.get('file_type')
            has_order = 'order' in child_props_dict
            list_comp = 'OrderedEditableListWrapper' if has_order else 'EditableListWrapper'
            if ft:
                accepted = ('image/jpeg,image/png,image/gif,image/webp' if ft == 'image'
                            else '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip')
                child_grid_components_parts.append(
                    f"      <{list_comp}\n"
                    f"        ref={{{child_var}Ref}}\n"
                    f"        initialItems={{initial{child_pascal}}}\n"
                    f"        itemType=\"file\"\n"
                    f"        fileVariant=\"{ft}\"\n"
                    f"        acceptedFileTypes=\"{accepted}\"\n"
                    f"        addButtonLabel=\"Add {child_title_label}\"\n"
                    f"        showTitle={{true}}\n"
                    f"        title={{tf('{child_camel}')}}\n"
                    f"      />"
                )
            else:
                child_grid_components_parts.append(
                    f"      <{list_comp}\n"
                    f"        ref={{{child_var}Ref}}\n"
                    f"        initialItems={{initial{child_pascal}}}\n"
                    f"        itemType=\"text\"\n"
                    f"        addButtonLabel=\"Add {child_title_label}\"\n"
                    f"        showTitle={{true}}\n"
                    f"        title={{tf('{child_camel}')}}\n"
                    f"        textFieldLabel=\"Name\"\n"
                    f"        textFieldPlaceholder=\"Enter name\"\n"
                    f"      />"
                )
            continue

        # Grid child
        has_order = 'order' in child_props_dict
        grid_comp = 'OrderedFieldsDataGrid' if has_order else 'FieldsDataGrid'
        child_grid_components_parts.append(
            f"      <{grid_comp}\n"
            f"        ref={{{child_var}Ref}}\n"
            f"        initialFields={{initial{child_pascal}}}\n"
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

    # FormUpsert params signature
    extra_default_props = ', '.join(f"all{to_pascal_case(t)}s = []" for t in selection_targets)
    sel_perm_props = ', '.join(f"{to_camel_case(t)}Permissions" for t in selection_targets)
    if extra_default_props or sel_perm_props or has_comment_children:
        form_upsert_params = (
            f"{{ src, isEdit, permissions"
            + (', currentUserId' if has_comment_children else '')
            + (f', {extra_default_props}' if extra_default_props else '')
            + (f', {sel_perm_props}' if sel_perm_props else '')
            + " }: FormUpsertProps"
        )
    else:
        form_upsert_params = "{ src, isEdit, permissions }: FormUpsertProps"

    # Validation call
    val_entries = '\n'.join(filter(None, [
        '    isEdit,',
        '    id: src.id,',
        '\n'.join(f"    {p}: {safe_var_name(p)}," for p in date_time_props),
        '\n'.join(f"    {r['prop_name']}: {safe_var_name(r['prop_name'])}," for r in parent_rels_raw),
        '\n'.join(f"    {p}: {safe_var_name(p)}," for p in boolean_props),
        '\n'.join(f"    {p}: {safe_var_name(p)}," for p in enum_int_props),
        '\n'.join(f"    {p}: {safe_var_name(p)}," for p in custom_upsert_props),
    ]))
    validation_call = f"  const validationError = useFormValidation({{\n{val_entries}\n  }});"

    # Comment children JSX
    comment_jsx_parts = []
    for c in comment_children:
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
            f"        />\n"
            f"      )}}"
        )

    custom_upsert_imports = '\n'.join(
        f"import {to_pascal_case(p)} from './{p}';" for p in custom_upsert_props
    )

    return {
        'parent_refs':              parent_refs,
        'all_states':               all_states,
        'all_parent_fields_jsx':    all_parent_fields_jsx,
        'parent_form_data_sets':    parent_form_data_sets,
        'child_variables':          child_variables,
        'child_imports':            child_imports,
        'child_grid_setup':         child_grid_setup,
        'child_form_data_handling': child_form_data_handling,
        'child_grid_components':    child_grid_components,
        'form_upsert_params':       form_upsert_params,
        'enum_ns_hooks':            '\n'.join(enum_ns_hooks),
        'enum_opt_setups':          '\n'.join(enum_opt_setups),
        'rel_opt_setups':           '\n'.join(rel_opt_setups),
        'child_entity_rel_opt':     child_entity_rel_option_setups,
        'validation_call':          validation_call,
        'comment_children_jsx':     '\n'.join(comment_jsx_parts),
        'custom_upsert_imports':    custom_upsert_imports,
        'has_children':             has_children,
        'has_comment_children':     has_comment_children,
        'has_many_to_one':          has_many_to_one or bool(enum_int_props),
        'has_datetime_props':       bool(date_time_props),
        'has_image_props':          bool(image_props),
        'has_number_props':         bool(number_props),
        'has_boolean_props':        bool(boolean_props),
    }
