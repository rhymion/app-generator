"""
build_context.py — Central context builder.

Every generator calls build_context(entity, schema) and gets back a single
dict with all pre-computed values.  Templates only iterate / conditionally
render; they do not do string arithmetic.
"""

from helpers.naming import (
    to_camel_case, to_pascal_case, to_pascal_case_from_var,
    to_title_case, safe_var_name, singularize,
)
from helpers.type_mapping import get_ts_type
from helpers.schema_helpers import (
    filter_fields, get_parent_relationships, get_detail_relation_name,
    is_optional_fk_to_parent, get_parent_fk_props, get_one_to_one_rels,
    get_detail_ref_rels, get_flatten_rels,
)
import copy

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_EXCLUDE_FIELDS = {'created_at', 'updated_at'}
_EXCLUDE_ID_TS  = {'id', 'created_at', 'updated_at', 'creator_id'}


def _get_actual_type(defn: dict) -> str | None:
    t = defn.get('type')
    if isinstance(t, list):
        return next((x for x in t if x != 'null'), None)
    return t


def _is_nullable(defn: dict) -> bool:
    t = defn.get('type')
    return isinstance(t, list) and 'null' in t


def _normalize_kind(defn: dict) -> str:
    actual = _get_actual_type(defn)
    fmt = defn.get('format')
    if actual == 'string' and fmt in ('date', 'date-time', 'time'):
        return 'date'
    if actual in ('integer', 'number'):
        return 'number'
    if actual == 'boolean':
        return 'boolean'
    if actual == 'string':
        return 'string'
    return 'other'


def _is_date_field(defn: dict) -> bool:
    return _get_actual_type(defn) == 'string' and defn.get('format') in ('date', 'date-time', 'time')


def _dedupe_ordered(items):
    seen = set()
    result = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


# ---------------------------------------------------------------------------
# Form data extraction  (actions.ts / api routes)
# ---------------------------------------------------------------------------

def _build_form_data_gets(prop_infos: list[dict]) -> str:
    lines = []
    for p in prop_infos:
        prop     = p['prop']
        var_name = p['var_name']
        defn     = p['def']
        actual   = _get_actual_type(defn)
        nullable = _is_nullable(defn)
        fmt      = defn.get('format')
        pattern  = defn.get('pattern')

        if actual == 'string' and fmt in ('date', 'date-time', 'time'):
            if nullable:
                lines.append(
                    f"  const {var_name}Str = data.get('{prop}') as string | null;\n"
                    f"  const {var_name} = {var_name}Str ? new Date({var_name}Str) : null;"
                )
            else:
                lines.append(
                    f"  const {var_name}Str = data.get('{prop}') as string;\n"
                    f"  const {var_name} = new Date({var_name}Str);"
                )
        elif actual == 'boolean':
            lines.append(f"  const {var_name} = data.get('{prop}') === 'true';")
        elif actual in ('integer', 'number'):
            lines.append(f"  const {var_name} = Number(data.get('{prop}'));")
        elif actual == 'string' and pattern == '^c[a-z0-9]{24,}$' and nullable:
            lines.append(f"  const {var_name} = (data.get('{prop}') as string | null) || null;")
        else:
            suffix = ' | null' if nullable else ''
            lines.append(f"  const {var_name} = data.get('{prop}') as string{suffix};")
    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# Child data analysis
# ---------------------------------------------------------------------------

def _get_child_parent_id_props(child_name: str, model: str, parent_rels_raw: list[dict],
                               schema: dict) -> set[str]:
    """What FK props in the child definition point back to the parent?

    For self-referential children, uses the parent's own many-to-one rels to itself.
    Otherwise scans the child's x-relationship annotations via get_parent_fk_props,
    falling back to the '{model}_id' convention if no annotated FK is found.
    """
    if child_name == model:
        return {r['prop_name'] for r in parent_rels_raw if r['target'] == model}
    child_def = schema.get('definitions', {}).get(child_name, {})
    return get_parent_fk_props(child_def, model)


def _build_child_data(children_raw: list[dict], model: str, schema: dict,
                      parent_rels_raw: list[dict]) -> list[dict]:
    result = []
    for child_raw in children_raw:
        child_name   = child_raw['name']
        prop_name    = child_raw['property_name']
        output_type  = child_raw.get('output_type')
        relationship = child_raw.get('relationship') or {}

        is_many_to_many = relationship.get('type') == 'many-to-many'

        child_def  = schema['definitions'].get(child_name, {})

        # Optional FK list: non-m2m list child whose FK to parent is nullable.
        # Treat like m2m (connect/set) — add/remove existing entities, no inline create.
        is_optional_fk_list = (
            output_type == 'list' and not is_many_to_many
            and is_optional_fk_to_parent(child_def, model)
        )
        use_connect = is_many_to_many or child_name == model or is_optional_fk_list
        # Independent list child: has its own _detail definition with x-generate.
        # These are managed on their own pages; the parent form shows them read-only.
        is_independent = (
            output_type == 'list' and not is_many_to_many
            and bool(schema['definitions'].get(f'{child_name}_detail', {}).get('x-generate'))
        )
        child_props_dict = child_def.get('properties', {})

        parent_id_props = _get_child_parent_id_props(child_name, model, parent_rels_raw, schema)

        # Fields WITHOUT id (for create body)
        props_no_id = [
            k for k in child_props_dict
            if k not in parent_id_props and k not in _EXCLUDE_ID_TS and k != 'id'
        ]
        # Fields WITH id (for update body)
        props_with_id = [
            k for k in child_props_dict
            if k not in parent_id_props and k not in _EXCLUDE_ID_TS
        ]

        field_type = (
            '{ ' +
            '; '.join(f'{p}: {get_ts_type(child_props_dict[p])}' for p in props_no_id) +
            ' }'
        ) if props_no_id else '{}'

        field_type_with_id = (
            '{ ' +
            '; '.join(
                f'{p.replace("id", "id?") if p == "id" else p}: {get_ts_type(child_props_dict[p])}'
                for p in props_with_id
            ) +
            ' }'
        ) if props_with_id else '{}'

        def _is_nullable_cuid(defn: dict) -> bool:
            t = defn.get('type')
            return (isinstance(t, list) and 'null' in t
                    and defn.get('pattern') == '^c[a-z0-9]{24,}$')

        field_map_create = '\n'.join(
            f'          {p}: f.{p} || null,'
            if _is_nullable_cuid(child_props_dict.get(p, {}))
            else f'          {p}: f.{p},'
            for p in props_no_id
        )

        child_var    = safe_var_name(prop_name)
        child_pascal = to_pascal_case(prop_name)
        form_key     = singularize(prop_name)

        result.append({
            **child_raw,
            'child_var':        child_var,
            'child_pascal':     child_pascal,
            'form_key':         form_key,
            'is_many_to_many':  is_many_to_many,
            'use_connect':      use_connect,
            'is_independent':   is_independent,
            'output_type':      output_type,
            'props_no_id':      props_no_id,
            'props_with_id':    props_with_id,
            'field_type':       field_type,
            'field_type_with_id': field_type_with_id,
            'field_map_create': field_map_create,
        })
    return result


def _build_child_form_data_extractions(children_data: list[dict]) -> str:
    lines = []
    for c in children_data:
        child_var = c['child_var']
        form_key  = c['form_key']
        if c['use_connect']:
            item_var  = singularize(child_var)
            item_id   = f'{item_var}Id'
            lines.append(
                f"  const {child_var}Raw = data.getAll('{form_key}[]') as string[];\n"
                f"  const {child_var}Items = {child_var}Raw.map(f => JSON.parse(f) as {{ id?: string; name?: string }});\n"
                f"  const {child_var}Ids = {child_var}Items\n"
                f"    .map(({item_var}) => {item_var}.id)\n"
                f"    .filter(({item_id}): {item_id} is string => Boolean({item_id}));"
            )
        else:
            lines.append(
                f"  const {child_var}Raw = data.getAll('{form_key}[]') as string[];\n"
                f"  const {child_var}Items = {child_var}Raw.map(f => JSON.parse(f) as {c['field_type_with_id']});"
            )
    return '\n'.join(lines)


def _build_child_nested_create(children_data: list[dict]) -> str:
    lines = []
    for c in children_data:
        pn  = c['property_name']
        cv  = c['child_var']
        fmc = c['field_map_create']
        if c['use_connect']:
            lines.append(f"      {pn}: {{\n        connect: {cv}Ids.map((id) => ({{ id }})),\n      }},")
        else:
            lines.append(f"      {pn}: {{\n        create: {cv}Items.map(f => ({{\n{fmc}\n        }})),\n      }},")
    return '\n'.join(lines)


def _build_child_nested_update(children_data: list[dict]) -> str:
    lines = []
    for c in children_data:
        pn  = c['property_name']
        cv  = c['child_var']
        fmc = c['field_map_create']
        if c['use_connect']:
            lines.append(f"      {pn}: {{\n        set: {cv}Ids.map((id) => ({{ id }})),\n      }},")
        else:
            lines.append(f"      {pn}: {{\n        deleteMany: {{}},\n        create: {cv}Items.map(f => ({{\n{fmc}\n        }})),\n      }},")
    return '\n'.join(lines)


def _build_comment_actions(comment_children: list[dict], parent: str, model: str) -> str:
    parent_pascal = to_pascal_case(parent)
    lines = []
    for c in comment_children:
        child_model   = c['name']
        parent_id_prop = f'{model}_id'
        lines.append(f"""
export async function add{parent_pascal}Comment({parent_id_prop}: string, message: string): Promise<void> {{
  const userId = await getSessionUserIdOrThrow();
  await prisma.{child_model}.create({{
    data: {{ message, {parent_id_prop}, creator_id: userId }},
  }});
  revalidatePath('/{parent}');
}}

export async function update{parent_pascal}Comment(commentId: string, message: string): Promise<void> {{
  const userId = await getSessionUserIdOrThrow();
  const comment = await prisma.{child_model}.findUnique({{ where: {{ id: commentId }}, select: {{ creator_id: true }} }});
  if (!comment || comment.creator_id !== userId) {{
    throw new Error('Not authorized to edit this comment');
  }}
  await prisma.{child_model}.update({{ where: {{ id: commentId }}, data: {{ message }} }});
  revalidatePath('/{parent}');
}}

export async function delete{parent_pascal}Comment(commentId: string): Promise<void> {{
  const userId = await getSessionUserIdOrThrow();
  const comment = await prisma.{child_model}.findUnique({{ where: {{ id: commentId }}, select: {{ creator_id: true }} }});
  if (!comment) return;
  if (comment.creator_id !== userId) {{
    await requirePermission('{parent}', 'delete');
  }}
  await prisma.{child_model}.delete({{ where: {{ id: commentId }} }});
  revalidatePath('/{parent}');
}}""")
    return '\n'.join(lines)


def _build_comment_actions_bridge(parent: str, model: str) -> str:
    """Generate comment actions using the shared commentable bridge (single comment table)."""
    parent_pascal = to_pascal_case(parent)
    return f"""
export async function add{parent_pascal}Comment(commentable_id: string, message: string): Promise<void> {{
  const userId = await getSessionUserIdOrThrow();
  await prisma.comment.create({{
    data: {{ message, commentable_id, creator_id: userId }},
  }});
  revalidatePath('/{parent}');
}}

export async function update{parent_pascal}Comment(commentId: string, message: string): Promise<void> {{
  const userId = await getSessionUserIdOrThrow();
  const comment = await prisma.comment.findUnique({{ where: {{ id: commentId }}, select: {{ creator_id: true }} }});
  if (!comment || comment.creator_id !== userId) {{
    throw new Error('Not authorized to edit this comment');
  }}
  await prisma.comment.update({{ where: {{ id: commentId }}, data: {{ message }} }});
  revalidatePath('/{parent}');
}}

export async function delete{parent_pascal}Comment(commentId: string): Promise<void> {{
  const userId = await getSessionUserIdOrThrow();
  const comment = await prisma.comment.findUnique({{ where: {{ id: commentId }}, select: {{ creator_id: true }} }});
  if (!comment) return;
  if (comment.creator_id !== userId) {{
    await requirePermission('{parent}', 'delete');
  }}
  await prisma.comment.delete({{ where: {{ id: commentId }} }});
  revalidatePath('/{parent}');
}}"""


# ---------------------------------------------------------------------------
# Selection targets (page_new, page_edit)
# ---------------------------------------------------------------------------

def _get_selection_targets(children_raw: list[dict], parent_rels_raw: list[dict],
                           schema: dict, model: str = '') -> list[str]:
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
    many_to_one_targets = [r['target'] for r in parent_rels_raw]

    child_entity_rel_targets = []
    for child_raw in children_raw:
        output_type  = child_raw.get('output_type')
        relationship = child_raw.get('relationship') or {}
        if output_type in ('list', 'comments') or relationship.get('type') == 'many-to-many':
            continue
        child_def = schema['definitions'].get(child_raw['name'], {})
        if child_def.get('properties'):
            parent_fk_props = get_parent_fk_props(child_def, model)
            child_entity_rel_targets.extend(
                r['target'] for r in get_parent_relationships(child_def)
                if r['prop_name'] not in parent_fk_props  # exclude only the actual parent FK column(s)
            )

    return _dedupe_ordered([*m2m_targets, *optional_fk_list_targets, *many_to_one_targets, *child_entity_rel_targets])


# ---------------------------------------------------------------------------
# Page list helpers
# ---------------------------------------------------------------------------

def _has_string_labels(enum_values: list) -> bool:
    return any(isinstance(v, str) and not str(v).lstrip('-').isdigit() for v in enum_values)


def _int_enum_option(v, i: int) -> str:
    if isinstance(v, (int, float)):
        return f"{{ value: {int(v)}, label: '{v}' }}"
    n = str(v)
    try:
        float(n)
        return f"{{ value: {n}, label: '{v}' }}"
    except ValueError:
        return f"{{ value: {i}, label: '{v}' }}"


# ---------------------------------------------------------------------------
# FormUpsert field categorisation
# ---------------------------------------------------------------------------

def _categorize_form_fields(filtered_props: dict, parent_rels_raw: list[dict],
                            generate_config: dict,
                            one_to_one_fk_props: set | None = None) -> dict:
    rel_prop_names = {r['prop_name'] for r in parent_rels_raw}
    _oto_fk = one_to_one_fk_props or set()
    parent_props = [
        k for k in filtered_props
        if k not in _EXCLUDE_ID_TS and k != 'id' and k not in rel_prop_names and k not in _oto_fk
    ]

    custom_upsert = []
    date_time     = []
    number        = []
    enum_integer  = []
    image         = []
    boolean       = []
    entity_select = []
    text          = []

    for p in parent_props:
        defn   = filtered_props[p]
        actual = _get_actual_type(defn)
        fmt    = defn.get('format')
        xc     = defn.get('x-custom-component', {})
        if isinstance(xc, dict) and isinstance(xc.get('target'), list) and 'upsert' in xc['target']:
            custom_upsert.append(p)
            continue
        if actual == 'string' and fmt in ('date', 'date-time', 'time'):
            date_time.append(p)
        elif actual in ('integer', 'number') and isinstance(defn.get('enum'), list):
            enum_integer.append(p)
        elif actual in ('integer', 'number'):
            number.append(p)
        elif actual == 'boolean':
            boolean.append(p)
        elif actual == 'string' and fmt == 'uri':
            image.append(p)
        elif actual == 'string' and defn.get('x-entity-select'):
            entity_select.append(p)
        else:
            text.append(p)

    return {
        'custom_upsert': custom_upsert,
        'date_time': date_time,
        'number': number,
        'enum_integer': enum_integer,
        'image': image,
        'boolean': boolean,
        'entity_select': entity_select,
        'text': text,
    }


# ---------------------------------------------------------------------------
# Entity select options helper
# ---------------------------------------------------------------------------

def _get_entity_options(schema: dict) -> list[dict]:
    """Returns list of {value, label} for all schema entities that have pages."""
    from generate_types import extract_entities
    options = []
    seen = set()
    for e in extract_entities(schema):
        parent = e['parent']
        if parent not in seen:
            seen.add(parent)
            options.append({'value': parent, 'label': to_title_case(parent)})
    return options


# ---------------------------------------------------------------------------
# Main builder
# ---------------------------------------------------------------------------

def build_context(entity: dict, schema: dict) -> dict:
    parent      = entity['parent']
    model       = entity['model']
    def_key     = entity['definition_key']
    gen_cfg     = entity.get('generate_config', {})
    children_raw = entity.get('children', [])

    parent_pascal = to_pascal_case(parent)
    parent_camel  = to_camel_case(parent)

    model_def      = schema['definitions'].get(model, {})
    filtered_props = filter_fields(model_def.get('properties', {}), gen_cfg.get('fields'))

    # Config flags
    can_create = gen_cfg.get('new',    True) is not False
    can_update = gen_cfg.get('edit',   True) is not False
    can_delete = gen_cfg.get('delete', True) is not False
    can_list   = gen_cfg.get('list',   True) is not False
    can_view   = gen_cfg.get('view',   True) is not False

    # Parent relationships (many-to-one) — all of them, not deduplicated by target
    merged_def    = {**model_def, 'properties': filtered_props}
    parent_rels_raw = get_parent_relationships(merged_def, schema)
    # relationship_targets: deduplicated by target for import / type purposes
    seen: dict[str, dict] = {}
    for r in parent_rels_raw:
        seen.setdefault(r['target'], r)
    relationship_targets = list(seen.values())

    # parent_rels: all rels with relation_name derived from prop_name directly
    parent_rels = [
        {
            **r,
            'relation_name': r['prop_name'].removesuffix('_id'),
        }
        for r in parent_rels_raw
    ]

    has_org_rel          = any(r['target'] == 'organization' for r in parent_rels)
    should_filter_by_org = has_org_rel and model not in ('organization', 'user_account')

    has_assignee_id   = 'assignee_id' in filtered_props
    item_context_select = (
        f'{{ id: true, creator_id: true{", assignee_id: true" if has_assignee_id else ""} }}'
    )

    # One-to-one outbound FK rels (FK is on this model)
    one_to_one_rels = get_one_to_one_rels(merged_def, schema)
    auto_create_oto_rels = [r for r in one_to_one_rels if not r['is_selector']]
    selector_oto_rels    = [r for r in one_to_one_rels if r['is_selector']]

    # Reverse one-to-one rels (FK is in the target, pointing back to this model)
    # e.g. pre_check.checkup_id → checkup; defined as plain $ref in the _detail extension
    reverse_oto_rels = get_detail_ref_rels(parent, merged_def, schema)

    # Flatten rels (x-outputType: flatten on non-array $ref properties in _detail)
    flatten_rels = get_flatten_rels(parent, merged_def, schema)
    # FK props in the parent model for m2o flatten rels — shown as accordion, not plain TextField
    flatten_m2o_fk_props = {f'{r["prop_name"]}_id' for r in flatten_rels if r['is_m2o']}

    # For m2o flatten rels with FK fields in their target: upgrade the simple 'rel: true' include
    # to 'rel: { include: { nested_rel: true } }' so the nested labels are fetchable in detail
    _flatten_m2o_nested: dict[str, str] = {}
    for _fr in flatten_rels:
        if not _fr['is_m2o']:
            continue
        _nested_fk = [f for f in _fr['fields'] if f.get('is_fk')]
        if _nested_fk:
            _parts = ', '.join(f"{f['relation_name']}: true" for f in _nested_fk)
            _flatten_m2o_nested[_fr['relation_name']] = f'{{ include: {{ {_parts} }} }}'

    # Non-m2o flatten rel include entries (FK is in target; add to detail query)
    flatten_non_m2o_include_entries: list[str] = []
    for _fr in flatten_rels:
        if _fr['is_m2o']:
            continue
        _nested_fk = [f for f in _fr['fields'] if f.get('is_fk')]
        if _nested_fk:
            _parts = ', '.join(f"{f['relation_name']}: true" for f in _nested_fk)
            flatten_non_m2o_include_entries.append(
                f"{_fr['relation_name']}: {{ include: {{ {_parts} }} }}"
            )
        else:
            flatten_non_m2o_include_entries.append(f"{_fr['relation_name']}: true")

    # auto-create FK props are excluded from service params (pre-created in transaction)
    auto_create_oto_fk_props = {r['prop_name'] for r in auto_create_oto_rels}
    # all OTO FK props are excluded from field categorisation (never treated as plain text fields)
    all_oto_fk_props = {r['prop_name'] for r in one_to_one_rels}

    # Parent prop infos: exclude id, timestamps, and auto-create OTO FK props
    # Selector OTO FK props ARE included — they flow through the form as autocomplete values
    parent_props = [k for k in filtered_props if k not in _EXCLUDE_ID_TS and k not in auto_create_oto_fk_props]
    parent_prop_infos = [
        {'prop': p, 'var_name': safe_var_name(p), 'def': filtered_props[p]}
        for p in parent_props
    ]
    parent_params = ', '.join(p['var_name'] for p in parent_prop_infos)
    parent_params_with_types = ', '.join(
        f"{p['var_name']}: {get_ts_type(p['def'])}" for p in parent_prop_infos
    )
    _base_data_lines = [f"        {p['prop']}: {p['var_name']}," for p in parent_prop_infos]
    # Explicit pre-create statements for auto-create OTO targets (e.g. const approvable = await tx.approvable.create({ data: {} });)
    one_to_one_pre_creates = '\n'.join(
        f"    const {r['relation_name']} = await tx.{r['target']}.create({{ data: {{}} }});"
        for r in auto_create_oto_rels
    )
    # FK data lines for auto-create OTO targets (e.g. approvable_id: approvable.id,)
    one_to_one_fk_data_lines = '\n'.join(
        f"        {r['prop_name']}: {r['relation_name']}.id,"
        for r in auto_create_oto_rels
    )
    parent_data_obj = '\n'.join(
        _base_data_lines + ([one_to_one_fk_data_lines] if one_to_one_fk_data_lines else [])
    )
    parent_data_obj_update = '\n'.join(_base_data_lines)
    validation_data_obj  = '\n'.join(f"      {p['prop']}: {p['var_name']}," for p in parent_prop_infos)
    # Synthetic object spreading created record with nested auto-create OTO stubs for afterCreate
    one_to_one_spread = ', '.join(
        f"{r['relation_name']}: {{ id: created.{r['prop_name']} }}"
        for r in auto_create_oto_rels
    )
    one_to_one_include = ''  # not used with explicit creation approach

    # Snapshot
    snapshot_field_mappings = '\n'.join(
        f"    {p['prop']}: normalizeValue(safeSnapshot.{p['prop']}, '{_normalize_kind(p['def'])}'),"
        for p in parent_prop_infos
    )

    # Form data gets (for actions / API POST)
    form_data_gets = _build_form_data_gets(parent_prop_infos)

    # Children (full analysis)
    children_data    = _build_child_data(children_raw, model, schema, parent_rels_raw)
    non_comment_ch   = [c for c in children_data if c.get('output_type') != 'comments']
    # Detect bridge-based comments via one-to-one rel to 'commentable'
    commentable_rel = next((r for r in one_to_one_rels if r['target'] == 'commentable'), None)
    if commentable_rel:
        comment_children = [{'bridge': True, 'property_name': commentable_rel['relation_name'], 'name': 'comment'}]
    else:
        comment_children = [c for c in children_data if c.get('output_type') == 'comments']
    # Embedded children: exclude independent list children (have own pages; shown read-only here).
    # Non-independent mandatory-FK list children (no own page) are embedded with full CRUD.
    # Many-to-many and optional-FK list children (use_connect=True) use connect/set.
    embedded_ch      = [c for c in non_comment_ch if c['use_connect'] or c.get('output_type') != 'list' or not c['is_independent']]

    child_form_data_extractions = _build_child_form_data_extractions(embedded_ch)

    child_params_for_add    = ', '.join(
        f"{c['child_var']}Ids: string[]" if c['use_connect'] else f"{c['child_var']}Items: {c['field_type']}[]"
        for c in embedded_ch
    )
    child_params_for_update = ', '.join(
        f"{c['child_var']}Ids: string[]" if c['use_connect'] else f"{c['child_var']}Items: {c['field_type_with_id']}[]"
        for c in embedded_ch
    )
    child_args_for_call = ', '.join(
        f"{c['child_var']}Ids" if c['use_connect'] else f"{c['child_var']}Items"
        for c in embedded_ch
    )

    child_nested_create = _build_child_nested_create(embedded_ch)
    child_nested_update = _build_child_nested_update(embedded_ch)

    # Self-parent relationship (for tree structures)
    self_parent_rel  = next((r for r in parent_rels_raw if r['target'] == model), None)
    self_parent_prop = self_parent_rel['prop_name'] if self_parent_rel else None

    # Comment actions code
    if commentable_rel:
        comment_actions_code = _build_comment_actions_bridge(parent, model)
    else:
        comment_actions_code = _build_comment_actions(comment_children, parent, model)

    # Snapshot child mappings (for service)
    snapshot_child_mappings = '\n'.join(
        f"    {c['property_name']}: normalizeChildRefs(safeSnapshot.{c['property_name']}),"
        for c in embedded_ch
    )
    snapshot_include_props = (
        ',\n    include: {\n      ' +
        ',\n      '.join(f"{c['property_name']}: {{ select: {{ id: true }} }}" for c in embedded_ch) +
        '\n    }'
        if embedded_ch else ''
    )

    # Selection targets (page_new, page_edit)
    selection_targets = _get_selection_targets(children_raw, parent_rels_raw, schema, model)

    # Field categorisation (for FormUpsert / FormView)
    # Use all_oto_fk_props to exclude BOTH auto-create and selector OTO FK props from plain field treatment
    field_categories = _categorize_form_fields(filtered_props, parent_rels_raw, gen_cfg, all_oto_fk_props)

    # Default props (page_new)
    def _default_value(k: str, defn: dict) -> str:
        actual = _get_actual_type(defn)
        fmt    = defn.get('format')
        is_req = k in (model_def.get('required') or [])
        is_null = _is_nullable(defn)
        if actual == 'string' and fmt in ('date', 'date-time', 'time'):
            return 'null'
        if actual in ('integer', 'number'):
            return 'null'
        if actual == 'string':
            return "''"
        if actual == 'boolean':
            return 'false'
        return 'null'

    parent_default_props = '\n'.join(
        f"    {k}: {_default_value(k, defn)},"
        for k, defn in filtered_props.items()
        if k not in _EXCLUDE_ID_TS and k != 'id' and k not in auto_create_oto_fk_props
    )

    # Chart config
    xdisplay    = (model_def or {}).get('x-display') or {}
    chart_cfg   = xdisplay.get('chart') if isinstance(xdisplay, dict) else None

    # x-display table config
    xdisplay_table_raw = None
    if isinstance(xdisplay, list):
        xdisplay_table_raw = xdisplay
    elif isinstance(xdisplay, dict) and isinstance(xdisplay.get('table'), list):
        xdisplay_table_raw = xdisplay['table']
    has_chart = bool(chart_cfg)

    # Detail def for custom component
    detail_def = schema['definitions'].get(def_key, {})
    _xcc = detail_def.get('x-custom-component') or {}
    _xcc_name = _xcc.get('name')
    _xcc_path = _xcc.get('path')  # optional explicit import path; defaults to './ComponentName'
    _xcc_target = _xcc.get('target') or ['list']  # default: list only (backward compat)
    # entity_custom_component: shown on list page (no target specified, or 'list' in target)
    entity_custom_component = _xcc_name if ('list' in _xcc_target) else None
    # entity_view_component / entity_edit_component: shown in FormView / FormUpsert
    entity_view_component = _xcc_name if (_xcc_name and 'view' in _xcc_target) else None
    entity_edit_component = _xcc_name if (_xcc_name and 'edit' in _xcc_target) else None
    # import path for view/edit components (explicit path overrides default ./ relative import)
    entity_view_component_path = _xcc_path if (entity_view_component and _xcc_path) else None
    entity_edit_component_path = _xcc_path if (entity_edit_component and _xcc_path) else None

    # Service args helpers
    parent_service_args = ', '.join(
        f"{p['var_name']} ?? null" if _is_nullable(p['def']) else p['var_name']
        for p in parent_prop_infos
    )
    child_service_args = ', '.join(
        f"{c['child_var']}_ids ?? []" if c['use_connect'] else f"{c['property_name']} ?? []"
        for c in embedded_ch
    )

    # Getters: include entries (list page)
    include_entries_list = [f"{r['relation_name']}: true" for r in parent_rels]
    # Selector OTO rels are included in list so the relation column can be displayed
    include_entries_list.extend(f"{r['relation_name']}: true" for r in selector_oto_rels)
    include_props_list   = ', '.join(include_entries_list)

    child_include_entries = []
    for c in children_raw:
        cn       = c['name']
        prop     = c['property_name']
        out_type = c.get('output_type')
        cdef     = schema['definitions'].get(cn, {})
        if out_type == 'comments':
            child_include_entries.append(
                f"{prop}: {{ include: {{ creator: {{ select: {{ id: true, name: true, avatar: true }} }} }}, orderBy: {{ created_at: 'asc' }} }}"
            )
        elif not cdef.get('properties'):
            child_include_entries.append(f"{prop}: true")
        else:
            child_rels = get_parent_relationships(cdef)
            if not child_rels:
                child_include_entries.append(f"{prop}: true")
            else:
                child_includes = ', '.join(
                    f"{r['prop_name'].removesuffix('_id')}: true" for r in child_rels
                )
                child_include_entries.append(f"{prop}: {{ include: {{ {child_includes} }} }}")

    # Include entries for auto-create one-to-one rels with their nested children
    one_to_one_include_entries = []
    for r in auto_create_oto_rels:
        if not r['children']:
            one_to_one_include_entries.append(f"{r['relation_name']}: true")
        else:
            nested_parts = []
            for c in r['children']:
                # Exclude back-ref to the one-to-one parent (avoid circular include)
                forward_rels = [cr for cr in c['child_rels'] if cr['target'] != r['target']]
                if forward_rels:
                    sub_parts = []
                    for cr in forward_rels:
                        rel_name = cr['prop_name'].removesuffix('_id')
                        sub_target_def = schema['definitions'].get(cr['target'], {})
                        sub_target_rels = get_parent_relationships(sub_target_def)
                        if sub_target_rels:
                            sub_sub = ', '.join(
                                f"{sr['prop_name'].removesuffix('_id')}: true"
                                for sr in sub_target_rels
                            )
                            sub_parts.append(f"{rel_name}: {{ include: {{ {sub_sub} }} }}")
                        else:
                            sub_parts.append(f"{rel_name}: true")
                    # approval_request always carries approval_histories and approval_flow.preceded_by
                    if c.get('child_name') == 'approval_request':
                        # Inject preceded_by into the approval_flow include
                        for i, part in enumerate(sub_parts):
                            if part.startswith('approval_flow:'):
                                sub_parts[i] = (
                                    "approval_flow: { include: { requestor_role: true, approver_role: true,"
                                    " preceded_by: { select: { id: true } } } }"
                                )
                                break
                        sub_parts.append(
                            "approval_histories: { include: { creator: { select: { id: true, name: true } } },"
                            " orderBy: { created_at: 'asc' } }"
                        )
                    # comment children always carry creator + orderBy (no FK rels defined in schema)
                    if c.get('child_name') == 'comment':
                        nested_parts.append(
                            f"comments: {{ include: {{ creator: {{ select: {{ id: true, name: true, avatar: true }} }} }},"
                            f" orderBy: {{ created_at: 'asc' }} }}"
                        )
                    else:
                        nested_parts.append(f"{c['property_name']}: {{ include: {{ {', '.join(sub_parts)} }} }}")
                else:
                    # comment child has no FK rels in schema — emit include + orderBy directly
                    if c.get('child_name') == 'comment':
                        nested_parts.append(
                            f"comments: {{ include: {{ creator: {{ select: {{ id: true, name: true, avatar: true }} }} }},"
                            f" orderBy: {{ created_at: 'asc' }} }}"
                        )
                    else:
                        nested_parts.append(f"{c['property_name']}: true")
            nested = ', '.join(nested_parts)
            one_to_one_include_entries.append(
                f"{r['relation_name']}: {{ include: {{ {nested} }} }}"
            )

    # Selector OTO rels included simply — they are independent entities with their own pages
    selector_oto_include_entries = [f"{r['relation_name']}: true" for r in selector_oto_rels]

    # Reverse OTO rels included simply (no FK in this model); use relation_name for Prisma key
    reverse_oto_include_entries = [f"{r['relation_name']}: true" for r in reverse_oto_rels]

    include_entries_detail = [
        *child_include_entries,
        # Use nested includes for m2o flatten rels that have FK fields (need label resolution)
        *[f"{r['relation_name']}: {_flatten_m2o_nested.get(r['relation_name'], 'true')}" for r in parent_rels],
        *one_to_one_include_entries,
        *selector_oto_include_entries,
        *reverse_oto_include_entries,
        *flatten_non_m2o_include_entries,
        "creator: { select: { id: true, name: true } }",
        "updater: { select: { id: true, name: true } }",
    ]
    include_props_detail = ', '.join(include_entries_detail)
    creator_filtered_props = copy.deepcopy(filtered_props)
    creator_filtered_props['creator_id'] = {'type': 'string'}

    parent_mapping = '\n'.join(
        f"    {k}: {parent_camel}.{k},"
        for k in creator_filtered_props
        if k not in _EXCLUDE_FIELDS
    )
    relationship_mapping = '\n'.join(
        f"    {r['relation_name']}: {parent_camel}.{r['relation_name']},"
        for r in parent_rels
    ) + (
        '\n' + '\n'.join(
            f"    {r['relation_name']}: {parent_camel}.{r['relation_name']},"
            for r in selector_oto_rels
        ) if selector_oto_rels else ''
    )
    # Note: reverse_oto_rels are NOT in relationship_mapping because they are not included in
    # the list query. They are fetched only in the detail query and auto-spread via { ...entity }.
    child_mappings = '\n'.join(
        f"    {c['property_name']}: {parent_camel}.{c['property_name']},"
        for c in children_raw
    )

    # All body fields for API routes
    all_body_fields_create = ', '.join([
        *(p['prop'] if p['prop'] == p['var_name'] else f"{p['prop']}: {p['var_name']}"
          for p in parent_prop_infos),
        *(f"{c['child_var']}_ids" if c['use_connect'] else c['property_name']
          for c in embedded_ch),
    ])
    service_args_for_create = f"userId, {parent_service_args}" + (
        f", {child_service_args}" if child_service_args else ""
    )
    # Null placeholders for flatten rel update params (API routes don't edit flatten rels)
    _flatten_null_args = ', '.join(
        'null'
        for r in flatten_rels
        if not r['is_m2o'] and any(not f.get('is_fk') for f in r['fields'])
    )
    service_args_for_update = f"userId, id, {parent_service_args}" + (
        f", {child_service_args}" if child_service_args else ""
    ) + (f", {_flatten_null_args}" if _flatten_null_args else "")

    return dict(
        # Naming
        parent=parent,
        model=model,
        def_key=def_key,
        parent_pascal=parent_pascal,
        parent_camel=parent_camel,
        # Schema / config
        filtered_props=filtered_props,
        model_def=model_def,
        gen_cfg=gen_cfg,
        can_create=can_create,
        can_update=can_update,
        can_delete=can_delete,
        can_list=can_list,
        can_view=can_view,
        # Relationships
        parent_rels=parent_rels,
        parent_rels_raw=parent_rels_raw,
        relationship_targets=relationship_targets,
        should_filter_by_org=should_filter_by_org,
        has_assignee_id=has_assignee_id,
        item_context_select=item_context_select,
        self_parent_prop=self_parent_prop,
        # Props
        parent_prop_infos=parent_prop_infos,
        parent_params=parent_params,
        parent_params_with_types=parent_params_with_types,
        parent_data_obj=parent_data_obj,
        parent_data_obj_update=parent_data_obj_update,
        validation_data_obj=validation_data_obj,
        parent_default_props=parent_default_props,
        parent_mapping=parent_mapping,
        relationship_mapping=relationship_mapping,
        # Children
        children_raw=children_raw,
        children_data=children_data,
        non_comment_ch=embedded_ch,
        comment_children=comment_children,
        has_commentable=bool(commentable_rel),
        commentable_rel_name=commentable_rel['relation_name'] if commentable_rel else None,
        child_mappings=child_mappings,
        child_form_data_extractions=child_form_data_extractions,
        child_params_for_add=child_params_for_add,
        child_params_for_update=child_params_for_update,
        child_args_for_call=child_args_for_call,
        child_nested_create=child_nested_create,
        child_nested_update=child_nested_update,
        comment_actions_code=comment_actions_code,
        # FormData
        form_data_gets=form_data_gets,
        # Service / snapshots
        snapshot_field_mappings=snapshot_field_mappings,
        snapshot_child_mappings=snapshot_child_mappings,
        snapshot_include_props=snapshot_include_props,
        # Getters
        include_props_list=include_props_list,
        include_props_detail=include_props_detail,
        include_entries_detail=include_entries_detail,
        # Selection targets (page_new / page_edit)
        selection_targets=selection_targets,
        # API routes
        all_body_fields_create=all_body_fields_create,
        service_args_for_create=service_args_for_create,
        service_args_for_update=service_args_for_update,
        # Field categories (FormUpsert / FormView)
        field_categories=field_categories,
        entity_select_options=_get_entity_options(schema),
        # Chart
        chart_cfg=chart_cfg,
        has_chart=has_chart,
        xdisplay=xdisplay,
        xdisplay_table=xdisplay_table_raw,
        # One-to-one outbound FK rels
        one_to_one_rels=auto_create_oto_rels,      # auto-create OTO only (for types/service templates)
        selector_oto_rels=selector_oto_rels,        # selector OTO (autocomplete UI, filtered getters)
        reverse_oto_rels=reverse_oto_rels,          # reverse OTO: FK in target pointing back to this model
        flatten_rels=flatten_rels,                  # flatten rels: shown as accordion in detail view
        flatten_m2o_fk_props=flatten_m2o_fk_props, # FK prop names in parent for m2o flatten rels
        one_to_one_pre_creates=one_to_one_pre_creates,
        one_to_one_spread=one_to_one_spread,
        one_to_one_include=one_to_one_include,
        # Page list / view / edit custom components
        entity_custom_component=entity_custom_component,
        entity_view_component=entity_view_component,
        entity_edit_component=entity_edit_component,
        entity_view_component_path=entity_view_component_path,
        entity_edit_component_path=entity_edit_component_path,
        # Helpers exposed for templates
        to_camel_case=to_camel_case,
        to_pascal_case=to_pascal_case,
        to_pascal_case_from_var=to_pascal_case_from_var,
        to_title_case=to_title_case,
        safe_var_name=safe_var_name,
        singularize=singularize,
        get_ts_type=get_ts_type,
        has_string_labels=_has_string_labels,
        int_enum_option=_int_enum_option,
        normalize_kind=_normalize_kind,
        is_date_field=_is_date_field,
        get_actual_type=_get_actual_type,
        is_nullable=_is_nullable,
    )
